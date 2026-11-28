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
    const end = Math.min(drawEnd, (Number(group.start) || 0) + Math.max(0, Number(group.count) || 0));
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
  index.triangleCount++;
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

  const meshes = [];
  root.traverseVisible(object => {
    if (object.isMesh && object.geometry?.attributes?.position && isObjectVisible(object)) meshes.push(object);
  });
  for (const mesh of meshes) {
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    if (position.count < 3) continue;
    mesh.updateWorldMatrix(true, false);
    const elementCount = geometry.index?.count ?? position.count;
    const ranges = materialRanges(mesh, geometry);
    if (!ranges.length) continue;
    stats.meshCount++;
    for (const range of ranges) {
      const end = Math.min(elementCount, range.end);
      for (let offset = range.start; offset + 2 < end; offset += 3) {
        const ia = geometry.index ? geometry.index.getX(offset) : offset;
        const ib = geometry.index ? geometry.index.getX(offset + 1) : offset + 1;
        const ic = geometry.index ? geometry.index.getX(offset + 2) : offset + 2;
        addTriangle(range.kind, ia, ib, ic, mesh);
        if (processed > 0 && processed % Math.max(1, yieldEveryTriangles) === 0) await yieldControl();
      }
    }
  }

  for (const kind of ['slopes', 'angled']) {
    const index = byKind[kind];
    stats.byKind[kind] = {
      triangles: index.triangleCount,
      largeTriangles: index.large.length,
      cells: index.cells.size,
      meshes: index.meshIds.size
    };
    stats.triangleCount += index.triangleCount;
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

export function selectHSafetyFenceCurves(curves) {
  return (Array.isArray(curves) ? curves : []).filter(curve => {
    const label = [curve?.name, curve?.id, curve?.sourcePath].filter(Boolean).join(' ');
    return /(^|[^a-z0-9])h[0-9]+([^a-z0-9]|$)/i.test(label);
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
      if (misses > bridgeGapSamples) return i - direction * misses;
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
  const dx = after[0] - before[0], dy = after[1] - before[1], dz = after[2] - before[2];
  const horizontalLength = Math.hypot(dx, dz);
  const length = Math.hypot(dx, dy, dz);
  return horizontalLength > 1e-7 && length > 1e-7
    ? { x: dx / horizontalLength, z: dz / horizontalLength,
        tx: dx / length, ty: dy / length, tz: dz / length, before, after }
    : null;
}

function pointAtEdgeDistance(samples, distance) {
  if (!samples.length) return null;
  if (distance <= samples[0].distance) return samples[0];
  const last = samples[samples.length - 1];
  if (distance >= last.distance) return last;
  let lo = 0, hi = samples.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].distance < distance) lo = mid;
    else hi = mid;
  }
  const a = samples[lo], b = samples[hi];
  const span = b.distance - a.distance;
  const t = span > 1e-8 ? (distance - a.distance) / span : 0;
  return {
    distance,
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    nx: Number.isFinite(a.nx) && Number.isFinite(b.nx) ? a.nx + (b.nx - a.nx) * t : undefined,
    nz: Number.isFinite(a.nz) && Number.isFinite(b.nz) ? a.nz + (b.nz - a.nz) * t : undefined
  };
}

function edgeTangentAtDistance(samples, distance, radius, fallback) {
  if (samples.length < 2) return fallback;
  const before = pointAtEdgeDistance(samples, distance - radius);
  const after = pointAtEdgeDistance(samples, distance + radius);
  if (!before || !after) return fallback;
  const dx = after.x - before.x, dy = after.y - before.y, dz = after.z - before.z;
  const horizontalLength = Math.hypot(dx, dz);
  const length = Math.hypot(dx, dy, dz);
  if (horizontalLength < 1e-7 || length < 1e-7) return fallback;
  return {
    tx: dx / length,
    ty: dy / length,
    tz: dz / length
  };
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
  panelTangentWindowMeters = 4.5,
  fenceInsetMeters = 1.25,
  coverageMode = 'hazards',
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
  const edgeSamples = { left: [], right: [] };
  const pendingPlacements = [];

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
    // Build a sampled path for each real Stage 1 piste edge. Panel orientation
    // follows this edge path (including its Y grade), not a smoothed centreline.
    edgeSamples.left.push({ distance, x: span.maxEdge.x, y: span.maxEdge.y, z: span.maxEdge.z, nx: normal.x, nz: normal.z });
    edgeSamples.right.push({ distance, x: span.minEdge.x, y: span.minEdge.y, z: span.minEdge.z, nx: -normal.x, nz: -normal.z });

    // Full test coverage: connect each consecutive pair of measured Stage1
    // edge samples. This makes a continuous chain without overlapping panels
    // generated from a smoothed six-metre window.
    if (coverageMode === 'full') {
      for (const sideName of ['left', 'right']) {
        const samples = edgeSamples[sideName];
        if (samples.length < 2) continue;
        const a = samples[samples.length - 2];
        const b = samples[samples.length - 1];
        const stationDelta = b.distance - a.distance;
        if (stationDelta < stationSpacing * 0.65 || stationDelta > stationSpacing * 1.65) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const edgeLength = Math.hypot(dx, dz);
        if (edgeLength < stationSpacing * 0.45 || edgeLength > stationSpacing * 1.65) continue;
        const tangentDot = (dx * tangent.x + dz * tangent.z) / Math.max(1e-8, edgeLength);
        if (tangentDot < 0.55) continue;
        const normalDot = a.nx * b.nx + a.nz * b.nz;
        if (normalDot < 0.35) continue;
        const verticalDelta = Math.abs(b.y - a.y);
        if (verticalDelta > Math.max(8, edgeLength * 1.5)) continue;
        pendingPlacements.push({
          position: {
            x: (a.x + b.x) * 0.5,
            y: (a.y + b.y) * 0.5,
            z: (a.z + b.z) * 0.5,
            width: Math.hypot(dx, b.y - a.y, dz),
            height: panelHeight,
            tint: deterministicTint((a.x + b.x) * 0.5, (a.z + b.z) * 0.5),
            reason: 'continuous-test',
            curveName: diagnostics.curveName
          },
          side: sideName,
          distance: (a.distance + b.distance) * 0.5,
          fallback: tangent,
          edgeStart: a,
          edgeEnd: b
        });
        if (pendingPlacements.length >= maxPanels) break;
      }
      if (pendingPlacements.length >= maxPanels) break;
      if (diagnostics.sampledStations % Math.max(1, yieldEveryStations) === 0) await yieldControl();
      continue;
    }

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
        x: side.edge.x,
        y: side.edge.y,
        z: side.edge.z,
        width: panelWidth,
        height: panelHeight,
        tint: deterministicTint(side.edge.x, side.edge.z),
        reason: forTurn ? 'turn' : (forSteepEdge ? 'steep-edge' : 'steep-route'),
        curveName: diagnostics.curveName
      };
      pendingPlacements.push({ position, side: side.side, distance, fallback: tangent });
      if (side.side === 'left') lastLeftPlacement = distance;
      else lastRightPlacement = distance;
      if (forTurn) diagnostics.placedForTurns++;
      else if (forSteepEdge) diagnostics.placedForSteepEdges++;
      else diagnostics.placedForSteepRoutes++;
      if (pendingPlacements.length >= maxPanels) break;
    }
    if (pendingPlacements.length >= maxPanels) break;
    if (diagnostics.sampledStations % Math.max(1, yieldEveryStations) === 0) await yieldControl();
  }
  const tangentWindow = Math.max(1.5, Math.min(8, Number(panelTangentWindowMeters) || 4.5));
  const inset = Math.max(0, Math.min(3, Number(fenceInsetMeters) || 0));
  for (const pending of pendingPlacements) {
    const samples = edgeSamples[pending.side];
    const halfWidth = pending.position.width * 0.5;
    let edgeA = pending.edgeStart || pointAtEdgeDistance(samples, pending.distance - halfWidth);
    let edgeB = pending.edgeEnd || pointAtEdgeDistance(samples, pending.distance + halfWidth);

    // Hazard-mode panels may interpolate a local run. Continuous-test panels
    // use consecutive sampled edge vertices and are never bridged across gaps.
    if (!pending.edgeStart || !pending.edgeEnd) {
      const localA = samples.reduce((best, sample) =>
        Math.abs(sample.distance - (pending.distance - halfWidth)) < Math.abs((best?.distance ?? Infinity) - (pending.distance - halfWidth)) ? sample : best, null);
      const localB = samples.reduce((best, sample) =>
        Math.abs(sample.distance - (pending.distance + halfWidth)) < Math.abs((best?.distance ?? Infinity) - (pending.distance + halfWidth)) ? sample : best, null);
      if (!edgeA || !edgeB || !localA || !localB ||
          Math.abs(localA.distance - (pending.distance - halfWidth)) > stationSpacing * 1.6 ||
          Math.abs(localB.distance - (pending.distance + halfWidth)) > stationSpacing * 1.6) {
        const edgeTangent = edgeTangentAtDistance(samples, pending.distance, tangentWindow, pending.fallback);
        const dx = edgeTangent.tx, dy = edgeTangent.ty, dz = edgeTangent.tz;
        edgeA = { x: pending.position.x - dx * halfWidth, y: pending.position.y - dy * halfWidth, z: pending.position.z - dz * halfWidth };
        edgeB = { x: pending.position.x + dx * halfWidth, y: pending.position.y + dy * halfWidth, z: pending.position.z + dz * halfWidth };
      }
    }

    const normalA = Number.isFinite(edgeA.nx) && Number.isFinite(edgeA.nz)
      ? Math.hypot(edgeA.nx, edgeA.nz) > 1e-7 ? [edgeA.nx / Math.hypot(edgeA.nx, edgeA.nz), edgeA.nz / Math.hypot(edgeA.nx, edgeA.nz)] : [0, 0]
      : [0, 0];
    const normalB = Number.isFinite(edgeB.nx) && Number.isFinite(edgeB.nz)
      ? Math.hypot(edgeB.nx, edgeB.nz) > 1e-7 ? [edgeB.nx / Math.hypot(edgeB.nx, edgeB.nz), edgeB.nz / Math.hypot(edgeB.nx, edgeB.nz)] : [0, 0]
      : [0, 0];

    const ax = edgeA.x - normalA[0] * inset;
    const az = edgeA.z - normalA[1] * inset;
    const bx = edgeB.x - normalB[0] * inset;
    const bz = edgeB.z - normalB[1] * inset;
    const sampledA = sampleStageOneSurfaceHeight(surface, ax, az);
    const sampledB = sampleStageOneSurfaceHeight(surface, bx, bz);
    if (coverageMode === 'full' && (!Number.isFinite(sampledA) || !Number.isFinite(sampledB))) continue;
    const ay = (Number.isFinite(sampledA) ? sampledA : edgeA.y) + 0.02;
    const by = (Number.isFinite(sampledB) ? sampledB : edgeB.y) + 0.02;
    const width = Math.hypot(bx - ax, by - ay, bz - az);
    if (width < pending.position.width * 0.55) continue;

    placements.push({
      ...pending.position,
      x: (ax + bx) * 0.5,
      y: (ay + by) * 0.5,
      z: (az + bz) * 0.5,
      ax, ay, az, bx, by, bz,
      width,
      side: pending.side
    });
  }
  diagnostics.surfaceHitRatio = diagnostics.sampledStations
    ? diagnostics.surfaceHits / diagnostics.sampledStations : 0;
  diagnostics.panelCount = placements.length;
  return { placements, diagnostics };
}


/**
 * Transform basis for one safety-net panel.
 *
 * The panel width follows the actual Stage 1 piste-edge tangent in 3D.
 * Its vertical axis remains world-up, so the top and bottom edges inherit
 * the piste grade while the fence posts stay vertical. This is deliberately
 * an affine (sheared) basis on longitudinal slopes, not a yaw-only rotation.
 */
export function computeSafetyFencePanelBasis(panel) {
  const height = Math.max(0, Number(panel?.height) || 0);
  let widthAxis;
  let position;
  if ([panel?.ax, panel?.ay, panel?.az, panel?.bx, panel?.by, panel?.bz].every(Number.isFinite)) {
    widthAxis = [
      panel.bx - panel.ax,
      panel.by - panel.ay,
      panel.bz - panel.az
    ];
    position = [
      (panel.ax + panel.bx) * 0.5,
      (panel.ay + panel.by) * 0.5 + height * 0.5,
      (panel.az + panel.bz) * 0.5
    ];
  } else {
    let tx = Number(panel?.tx), ty = Number(panel?.ty), tz = Number(panel?.tz);
    if (!Number.isFinite(ty)) ty = 0;
    if (!Number.isFinite(tx)) tx = 0;
    if (!Number.isFinite(tz)) tz = 0;
    let length = Math.hypot(tx, ty, tz);
    if (length < 1e-8) { tx = 1; ty = 0; tz = 0; length = 1; }
    tx /= length; ty /= length; tz /= length;
    const width = Math.max(0, Number(panel?.width) || 0);
    widthAxis = [tx * width, ty * width, tz * width];
    position = [
      Number(panel?.x) || 0,
      (Number(panel?.y) || 0) + height * 0.5,
      Number(panel?.z) || 0
    ];
  }
  const heightAxis = [0, height, 0];
  let normalAxis = [
    widthAxis[1] * heightAxis[2] - widthAxis[2] * heightAxis[1],
    widthAxis[2] * heightAxis[0] - widthAxis[0] * heightAxis[2],
    widthAxis[0] * heightAxis[1] - widthAxis[1] * heightAxis[0]
  ];
  const normalLength = Math.hypot(...normalAxis);
  if (normalLength > 1e-8) normalAxis = normalAxis.map(value => value / normalLength);
  else normalAxis = [0, 0, 1];
  return { widthAxis, heightAxis, normalAxis, position };
}

export function buildSafetyFenceGroup(THREE, placements, texture, { visible = true } = {}) {
  if (!Array.isArray(placements) || !placements.length || !texture) return { group: null, count: 0 };
  const group = new THREE.Group();
  group.name = 'Piste_Safety_Fences';
  group.visible = !!visible;
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({
    map: texture, color: 0xffffff, transparent: true, alphaTest: 0.16,
    side: THREE.DoubleSide, depthWrite: false, toneMapped: false
  });
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  mesh.name = 'Instanced_Orange_Safety_Nets';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  const matrix = new THREE.Matrix4();
  const widthAxis = new THREE.Vector3();
  const heightAxis = new THREE.Vector3();
  const normalAxis = new THREE.Vector3();
  const tint = new THREE.Color();
  placements.forEach((panel, index) => {
    const basis = computeSafetyFencePanelBasis(panel);
    widthAxis.set(...basis.widthAxis);
    heightAxis.set(...basis.heightAxis);
    normalAxis.set(...basis.normalAxis);
    matrix.makeBasis(widthAxis, heightAxis, normalAxis);
    matrix.setPosition(...basis.position);
    mesh.setMatrixAt(index, matrix);
    const brightness = panel.tint || 1;
    tint.setRGB(1, 0.94 * brightness, 0.84 * brightness);
    mesh.setColorAt(index, tint);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.renderOrder = 7;
  group.add(mesh);
  return { group, count: placements.length };
}


/**
 * Remove near-identical panel segments generated by overlapping / merging H pistes.
 * Adjacent panels on one fence remain separate because their midpoints are farther
 * apart than the tolerance; intersecting segments with different directions remain.
 */
export function dedupeSafetyFencePlacements(placements, {
  endpointToleranceMeters = 2.0,
  midpointToleranceMeters = 1.9,
  parallelDotMinimum = 0.82,
  cellSize = 3.0
} = {}) {
  if (!Array.isArray(placements) || placements.length < 2) return Array.isArray(placements) ? placements.slice() : [];
  const tolerance = Math.max(0.1, Number(endpointToleranceMeters) || 2);
  const midpointTolerance = Math.max(0.1, Number(midpointToleranceMeters) || 1.9);
  const cell = Math.max(0.5, Number(cellSize) || 3);
  const buckets = new Map();
  const kept = [];
  const endpointOf = (panel, start) => start
    ? [Number(panel.ax), Number(panel.ay), Number(panel.az)]
    : [Number(panel.bx), Number(panel.by), Number(panel.bz)];
  const midpoint = panel => [
    (Number(panel.ax) + Number(panel.bx)) * 0.5,
    (Number(panel.ay) + Number(panel.by)) * 0.5,
    (Number(panel.az) + Number(panel.bz)) * 0.5
  ];
  const valid = panel => [panel?.ax,panel?.ay,panel?.az,panel?.bx,panel?.by,panel?.bz].every(Number.isFinite);
  const key = (x,z) => Math.floor(x/cell)+','+Math.floor(z/cell);
  const distance3 = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
  for (const panel of placements) {
    if (!valid(panel)) { kept.push(panel); continue; }
    const mid = midpoint(panel);
    const a = endpointOf(panel,true), b = endpointOf(panel,false);
    const dx = b[0]-a[0], dz = b[2]-a[2], len = Math.hypot(dx,dz);
    if (len < 1e-7) continue;
    const direction = [dx/len,dz/len];
    const gx = Math.floor(mid[0]/cell), gz = Math.floor(mid[2]/cell);
    let duplicate = false;
    for (let ox=-1;ox<=1&&!duplicate;ox++) for(let oz=-1;oz<=1&&!duplicate;oz++) {
      const bucket = buckets.get(key((gx+ox)*cell,(gz+oz)*cell));
      if (!bucket) continue;
      for (const other of bucket) {
        const om = midpoint(other), oa = endpointOf(other,true), ob = endpointOf(other,false);
        if (distance3(mid,om) > midpointTolerance) continue;
        const odx=ob[0]-oa[0], odz=ob[2]-oa[2], olen=Math.hypot(odx,odz);
        if (olen < 1e-7) continue;
        const parallel=Math.abs(direction[0]*(odx/olen)+direction[1]*(odz/olen));
        if (parallel < parallelDotMinimum) continue;
        const direct=Math.max(distance3(a,oa),distance3(b,ob));
        const reverse=Math.max(distance3(a,ob),distance3(b,oa));
        if (Math.min(direct,reverse) <= tolerance) { duplicate=true; break; }
      }
    }
    if (duplicate) continue;
    kept.push(panel);
    const bucketKey=key(gx*cell,gz*cell);
    if(!buckets.has(bucketKey))buckets.set(bucketKey,[]);
    buckets.get(bucketKey).push(panel);
  }
  return kept;
}
