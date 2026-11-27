import { classifyStageOneSurfaceKind } from './stage-one-materials.v1.js';

const yieldFrame = () => new Promise(resolve => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
  else setTimeout(resolve, 0);
});

function isObjectVisible(object) {
  for (let node = object; node; node = node.parent) {
    if (node.visible === false || node.userData?.physicsCollision === false) return false;
  }
  return true;
}

function emptySurfaceIndex(cellSize) {
  return { cellSize, cells: new Map(), large: [], triangleCount: 0, meshIds: new Set() };
}

function materialRanges(mesh, geometry) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const groups = geometry.groups || [];
  const count = geometry.index?.count ?? geometry.attributes.position.count;
  const drawStart = Math.max(0, geometry.drawRange?.start || 0);
  const drawEnd = Math.min(count, Number.isFinite(geometry.drawRange?.count)
    ? drawStart + geometry.drawRange.count : count);
  if (!groups.length) {
    const kind = classifyStageOneSurfaceKind(materials[0]?.userData?.gradeOptimizerStageOneSurfaceKind) ||
      classifyStageOneSurfaceKind(materials[0]?.userData?.gradeOptimizerFbxSourceMaterialName) ||
      classifyStageOneSurfaceKind(materials[0]?.name);
    return kind ? [{ start: drawStart, end: drawEnd, kind }] : [];
  }
  const ranges = [];
  for (const group of groups) {
    const start = Math.max(drawStart, Number(group.start) || 0);
    const end = Math.min(drawEnd, start + Math.max(0, Number(group.count) || 0));
    if (end - start < 3) continue;
    const material = materials[group.materialIndex ?? 0] || materials[0];
    const kind = classifyStageOneSurfaceKind(material?.userData?.gradeOptimizerStageOneSurfaceKind) ||
      classifyStageOneSurfaceKind(material?.userData?.gradeOptimizerFbxSourceMaterialName) ||
      classifyStageOneSurfaceKind(material?.name);
    if (kind === 'slopes' || kind === 'angled') ranges.push({ start, end, kind });
  }
  return ranges;
}

function insertTriangle(index, triangle) {
  const size = index.cellSize;
  const ix0 = Math.floor(triangle.minX / size);
  const ix1 = Math.floor(triangle.maxX / size);
  const iz0 = Math.floor(triangle.minZ / size);
  const iz1 = Math.floor(triangle.maxZ / size);
  const cellCount = (ix1 - ix0 + 1) * (iz1 - iz0 + 1);
  if (!Number.isFinite(cellCount) || cellCount <= 0) return;
  if (cellCount > 196) {
    index.large.push(triangle);
    return;
  }
  for (let iz = iz0; iz <= iz1; iz++) {
    for (let ix = ix0; ix <= ix1; ix++) {
      const key = ix + ',' + iz;
      let bucket = index.cells.get(key);
      if (!bucket) {
        bucket = [];
        index.cells.set(key, bucket);
      }
      bucket.push(triangle);
    }
  }
  index.triangleCount++;
}

export async function buildStageOneSlopeSurfaceLookup(THREE, root, {
  cellSize = 3.0,
  yieldEveryTriangles = 12000,
  yieldControl = yieldFrame
} = {}) {
  if (!root) return null;
  root.updateWorldMatrix(true, true);
  const byKind = {
    slopes: emptySurfaceIndex(cellSize),
    angled: emptySurfaceIndex(cellSize)
  };
  const stats = { meshCount: 0, triangleCount: 0, byKind: {} };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let processed = 0;
  const addTriangle = (kind, ia, ib, ic, mesh) => {
    const index = byKind[kind];
    if (!index) return;
    const position = mesh.geometry.attributes.position;
    a.fromBufferAttribute(position, ia).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(position, ib).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(position, ic).applyMatrix4(mesh.matrixWorld);
    const den = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    if (Math.abs(den) < 1e-9) return;
    const triangle = {
      ax: a.x, ay: a.y, az: a.z,
      bx: b.x, by: b.y, bz: b.z,
      cx: c.x, cy: c.y, cz: c.z,
      den,
      minX: Math.min(a.x, b.x, c.x), maxX: Math.max(a.x, b.x, c.x),
      minZ: Math.min(a.z, b.z, c.z), maxZ: Math.max(a.z, b.z, c.z)
    };
    insertTriangle(index, triangle);
    index.meshIds.add(mesh.uuid || mesh.id || mesh.name || 'mesh');
    processed++;
  };

  const visit = mesh => {
    if (!mesh?.isMesh || !mesh.geometry?.attributes?.position || !isObjectVisible(mesh)) return;
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    if (position.count < 3) return;
    mesh.updateWorldMatrix(true, false);
    const elementCount = geometry.index?.count ?? position.count;
    const ranges = materialRanges(mesh, geometry);
    if (!ranges.length) return;
    stats.meshCount++;
    for (const range of ranges) {
      const end = Math.min(elementCount, range.end);
      for (let offset = range.start; offset + 2 < end; offset += 3) {
        const ia = geometry.index ? geometry.index.getX(offset) : offset;
        const ib = geometry.index ? geometry.index.getX(offset + 1) : offset + 1;
        const ic = geometry.index ? geometry.index.getX(offset + 2) : offset + 2;
        addTriangle(range.kind, ia, ib, ic, mesh);
        if (processed > 0 && processed % Math.max(1, yieldEveryTriangles) === 0) {
          // The visitor itself stays synchronous; yielding is handled by the async traversal below.
          return { yield: true };
        }
      }
    }
    return null;
  };

  const meshes = [];
  root.traverseVisible(object => {
    if (object.isMesh && object.geometry?.attributes?.position && isObjectVisible(object)) meshes.push(object);
  });
  for (const mesh of meshes) {
    // Process one mesh at a time. Typical Stage 1 FBX contains only a few dozen meshes.
    const result = visit(mesh);
    if (result?.yield) await yieldControl();
  }

  for (const kind of ['slopes', 'angled']) {
    const index = byKind[kind];
    stats.byKind[kind] = {
      triangles: index.triangleCount,
      largeTriangles: index.large.length,
      cells: index.cells.size,
      meshes: index.meshIds.size
    };
    stats.triangleCount += index.triangleCount + index.large.length;
  }
  return { byKind, stats };
}

function triangleContains(triangle, x, z) {
  if (x < triangle.minX - 1e-5 || x > triangle.maxX + 1e-5 ||
      z < triangle.minZ - 1e-5 || z > triangle.maxZ + 1e-5) return null;
  const wa = ((triangle.bz - triangle.cz) * (x - triangle.cx) +
    (triangle.cx - triangle.bx) * (z - triangle.cz)) / triangle.den;
  const wb = ((triangle.cz - triangle.az) * (x - triangle.cx) +
    (triangle.ax - triangle.cx) * (z - triangle.cz)) / triangle.den;
  const wc = 1 - wa - wb;
  if (wa < -1e-5 || wb < -1e-5 || wc < -1e-5) return null;
  const y = wa * triangle.ay + wb * triangle.by + wc * triangle.cy;
  return Number.isFinite(y) ? y : null;
}

export function sampleStageOneSurfaceHeight(index, x, z) {
  if (!index?.cells) return null;
  const key = Math.floor(x / index.cellSize) + ',' + Math.floor(z / index.cellSize);
  const bucket = index.cells.get(key) || [];
  let best = null;
  for (const triangle of bucket) {
    const height = triangleContains(triangle, x, z);
    if (height !== null && (best === null || height > best)) best = height;
  }
  for (const triangle of index.large || []) {
    const height = triangleContains(triangle, x, z);
    if (height !== null && (best === null || height > best)) best = height;
  }
  return best;
}

export function selectH3SafetyFenceCurves(curves) {
  return (Array.isArray(curves) ? curves : []).filter(curve => {
    const label = [curve?.name, curve?.id, curve?.sourcePath].filter(Boolean).join(' ');
    return /(^|[^a-z0-9])h3([^a-z0-9]|$)/i.test(label);
  });
}

function normalizeCurvePoints(points) {
  return (Array.isArray(points) ? points : [])
    .filter(point => Array.isArray(point) && point.length >= 3 &&
      point.slice(0, 3).every(value => Number.isFinite(Number(value))))
    .map(point => [Number(point[0]), Number(point[1]), Number(point[2])]);
}

function buildHorizontalDistances(points) {
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    distances.push(distances[i - 1] + Math.hypot(
      points[i][0] - points[i - 1][0],
      points[i][2] - points[i - 1][2]
    ));
  }
  return distances;
}

function pointAtDistance(points, distances, distance) {
  const total = distances[distances.length - 1] || 0;
  const target = Math.max(0, Math.min(total, distance));
  let lo = 0, hi = distances.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (distances[mid] < target) lo = mid;
    else hi = mid;
  }
  const span = distances[hi] - distances[lo];
  const t = span > 1e-8 ? (target - distances[lo]) / span : 0;
  return [
    points[lo][0] + (points[hi][0] - points[lo][0]) * t,
    points[lo][1] + (points[hi][1] - points[lo][1]) * t,
    points[lo][2] + (points[hi][2] - points[lo][2]) * t
  ];
}

function scanCrossSection(surface, center, normal, {
  halfWidth = 64,
  step = 1.25,
  maximumCenterOffset = 14,
  bridgeGapSamples = 1
} = {}) {
  const samples = [];
  const count = Math.floor(halfWidth * 2 / step);
  let nearest = -1, nearestDistance = Infinity;
  for (let i = 0; i <= count; i++) {
    const offset = -halfWidth + i * step;
    const x = center[0] + normal[0] * offset;
    const z = center[2] + normal[1] * offset;
    const y = sampleStageOneSurfaceHeight(surface, x, z);
    const hit = Number.isFinite(y);
    samples.push({ offset, x, y, z, hit });
    if (hit && Math.abs(offset) < nearestDistance) {
      nearest = i;
      nearestDistance = Math.abs(offset);
    }
  }
  if (nearest < 0 || nearestDistance > maximumCenterOffset) return null;

  const isNearRun = (index, direction) => {
    let misses = 0;
    for (let i = index + direction; i >= 0 && i < samples.length; i += direction) {
      if (samples[i].hit) {
        misses = 0;
        continue;
      }
      misses++;
      if (misses > bridgeGapSamples) return i - direction * (misses - 1);
    }
    return direction < 0 ? 0 : samples.length - 1;
  };
  const leftIndex = isNearRun(nearest, -1);
  const rightIndex = isNearRun(nearest, 1);
  const leftSample = samples[leftIndex];
  const rightSample = samples[rightIndex];
  if (!leftSample?.hit || !rightSample?.hit || rightSample.offset - leftSample.offset < 4) return null;
  return {
    minOffset: leftSample.offset,
    maxOffset: rightSample.offset,
    minEdge: { x: leftSample.x, y: leftSample.y, z: leftSample.z },
    maxEdge: { x: rightSample.x, y: rightSample.y, z: rightSample.z },
    centerOffset: samples[nearest].offset
  };
}

function tangentAt(points, distances, distance, radius) {
  const before = pointAtDistance(points, distances, Math.max(0, distance - radius));
  const after = pointAtDistance(points, distances, Math.min(distances[distances.length - 1], distance + radius));
  const dx = after[0] - before[0], dz = after[2] - before[2];
  const length = Math.hypot(dx, dz);
  return length > 1e-7 ? { x: dx / length, z: dz / length, before, after } : null;
}

function unitAngle(cross, dot) {
  return Math.atan2(cross, dot) * 180 / Math.PI;
}

function deterministicTint(x, z) {
  const value = Math.sin(x * 12.9898 + z * 78.233 + 31 * 37.719) * 43758.5453;
  return 0.94 + (value - Math.floor(value)) * 0.06;
}

export async function findCenterlineSafetyFencePlacements(curve, surface, sampleTerrainY, {
  stationSpacing = 4.5,
  panelSpacing = 6.5,
  panelWidth = 6.0,
  panelHeight = 1.4,
  maxPanels = 480,
  maxHalfWidth = 64,
  crossSectionStep = 1.25,
  turnWindowMeters = 8,
  minimumTurnDegrees = 20,
  minimumEdgeAngleDegrees = 16,
  edgeSampleDistance = 8,
  minimumRouteAngleDegrees = 27,
  yieldEveryStations = 24,
  yieldControl = yieldFrame
} = {}) {
  if (!curve || !surface?.cells || typeof sampleTerrainY !== 'function') {
    return { placements: [], diagnostics: { reason: 'missing-input', curveName: curve?.name || curve?.id || 'H3' } };
  }
  const points = normalizeCurvePoints(curve.points);
  if (points.length < 2) {
    return { placements: [], diagnostics: { reason: 'invalid-centerline', curveName: curve.name || curve.id || 'H3' } };
  }
  const distances = buildHorizontalDistances(points);
  const totalLength = distances[distances.length - 1] || 0;
  if (totalLength < stationSpacing * 2) {
    return { placements: [], diagnostics: { reason: 'centerline-too-short', curveName: curve.name || curve.id || 'H3', totalLength } };
  }

  const placements = [];
  const diagnostics = {
    curveName: String(curve.name || curve.id || 'H3'),
    totalLengthMeters: totalLength,
    sampledStations: 0,
    surfaceHits: 0,
    edgePairs: 0,
    turnStations: 0,
    steepRouteStations: 0,
    steepEdgeSides: 0,
    placedForTurns: 0,
    placedForSteepEdges: 0,
    placedForSteepRoutes: 0,
    materialKind: surface.kind || 'slopes'
  };
  let lastLeftPlacement = -Infinity, lastRightPlacement = -Infinity;

  for (let distance = Math.max(4, stationSpacing * 0.5);
    distance <= totalLength - Math.max(4, stationSpacing * 0.5);
    distance += stationSpacing) {
    diagnostics.sampledStations++;
    const center = pointAtDistance(points, distances, distance);
    const tangent = tangentAt(points, distances, distance, Math.max(3, turnWindowMeters));
    if (!tangent) continue;
    const normal = { x: -tangent.z, z: tangent.x };
    const span = scanCrossSection(surface, center, [normal.x, normal.z], {
      halfWidth: maxHalfWidth,
      step: crossSectionStep
    });
    if (!span) continue;
    diagnostics.surfaceHits++;
    diagnostics.edgePairs++;

    const beforeTangent = tangentAt(points, distances, distance - turnWindowMeters, turnWindowMeters * 0.6);
    const afterTangent = tangentAt(points, distances, distance + turnWindowMeters, turnWindowMeters * 0.6);
    let turnDegrees = 0;
    if (beforeTangent && afterTangent) {
      turnDegrees = unitAngle(
        beforeTangent.x * afterTangent.z - beforeTangent.z * afterTangent.x,
        beforeTangent.x * afterTangent.x + beforeTangent.z * afterTangent.z
      );
    }
    const isTurn = Math.abs(turnDegrees) >= minimumTurnDegrees;
    if (isTurn) diagnostics.turnStations++;

    const routeDx = tangent.after[0] - tangent.before[0];
    const routeDz = tangent.after[2] - tangent.before[2];
    const routeDy = tangent.after[1] - tangent.before[1];
    const routeHorizontal = Math.hypot(routeDx, routeDz);
    const routeAngle = routeHorizontal > 1e-6
      ? Math.atan2(Math.abs(routeDy), routeHorizontal) * 180 / Math.PI
      : 90;
    const steepRoute = routeAngle >= minimumRouteAngleDegrees;
    if (steepRoute) diagnostics.steepRouteStations++;

    const sides = [
      { side: 'left', edge: span.maxEdge, nx: normal.x, nz: normal.z, turnOuter: isTurn && turnDegrees < 0 },
      { side: 'right', edge: span.minEdge, nx: -normal.x, nz: -normal.z, turnOuter: isTurn && turnDegrees > 0 }
    ];
    const evaluated = [];
    for (const side of sides) {
      const outerX = side.edge.x + side.nx * edgeSampleDistance;
      const outerZ = side.edge.z + side.nz * edgeSampleDistance;
      const outerY = sampleTerrainY(outerX, outerZ);
      const drop = Number.isFinite(outerY) ? side.edge.y - outerY : null;
      const edgeAngle = Number.isFinite(drop) && drop > 0
        ? Math.atan2(drop, edgeSampleDistance) * 180 / Math.PI : 0;
      const steepEdge = Number.isFinite(drop) && edgeAngle >= minimumEdgeAngleDegrees;
      if (steepEdge) diagnostics.steepEdgeSides++;
      evaluated.push({ ...side, outerY, drop, edgeAngle, steepEdge });
    }

    // A sharp turn gets a barrier on its outside. On steep piste sections, favour
    // the lower outside terrain edge; a separate steep drop at either edge also qualifies.
    let steepRouteSide = null;
    if (steepRoute && evaluated.every(side => Number.isFinite(side.outerY))) {
      const difference = Math.abs(evaluated[0].outerY - evaluated[1].outerY);
      if (difference >= 0.75) steepRouteSide = evaluated[0].outerY < evaluated[1].outerY
        ? evaluated[0].side : evaluated[1].side;
    }

    for (const side of evaluated) {
      const forTurn = side.turnOuter;
      const forSteepEdge = side.steepEdge;
      const forSteepRoute = steepRouteSide === side.side;
      if (!forTurn && !forSteepEdge && !forSteepRoute) continue;
      const last = side.side === 'left' ? lastLeftPlacement : lastRightPlacement;
      if (distance - last < panelSpacing * 0.78) continue;
      const position = {
        x: side.edge.x + side.nx * 0.22,
        y: side.edge.y + 0.02,
        z: side.edge.z + side.nz * 0.22,
        tx: tangent.x,
        tz: tangent.z,
        width: panelWidth,
        height: panelHeight,
        tint: deterministicTint(side.edge.x, side.edge.z),
        reason: forTurn ? 'turn' : (forSteepEdge ? 'steep-edge' : 'steep-route'),
        curveName: diagnostics.curveName
      };
      placements.push(position);
      if (side.side === 'left') lastLeftPlacement = distance;
      else lastRightPlacement = distance;
      if (forTurn) diagnostics.placedForTurns++;
      else if (forSteepEdge) diagnostics.placedForSteepEdges++;
      else diagnostics.placedForSteepRoutes++;
      if (placements.length >= maxPanels) break;
    }
    if (placements.length >= maxPanels) break;
    if (diagnostics.sampledStations % Math.max(1, yieldEveryStations) === 0) await yieldControl();
  }
  diagnostics.surfaceHitRatio = diagnostics.sampledStations
    ? diagnostics.surfaceHits / diagnostics.sampledStations : 0;
  diagnostics.panelCount = placements.length;
  return { placements, diagnostics };
}
