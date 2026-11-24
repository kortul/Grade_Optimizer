import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { Box3, Vector3 } from 'three';

const file = 'clients/alpine-resort/models/slopes_stage1.fbx';
const manifestFile = 'clients/alpine-resort/scene.json';
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
const asset = manifest.assets?.find(item => item.id === 'slopes_stage1');
if (!asset) throw new Error('slopes_stage1 entry is missing from scene.json');

const bytes = readFileSync(file);
const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const root = new FBXLoader().parse(arrayBuffer, '');

function restoreCadBridgeWorkingCoordinates(rootObject, mayaExport) {
  const bridge = mayaExport?.cadBridge;
  if (bridge?.inverseApplied !== true) return null;
  const record = (bridge.workingGroups || []).find(item =>
    Array.isArray(item?.originalOffset) && item.originalOffset.length === 3 &&
    Number.isFinite(Number(item?.originalScale)) && Number(item.originalScale) > 0
  );
  if (!record) throw new Error('Stage1 inverseApplied=true but CAD Bridge offset / scale are missing');
  const offset = record.originalOffset.map(Number);
  const scale = Number(record.originalScale);
  const geometries = new Set();
  let meshCount = 0, vertexCount = 0;
  rootObject.traverse(object => {
    if (!object.isMesh || !object.geometry || geometries.has(object.geometry)) return;
    const geometry = object.geometry;
    const position = geometry.attributes?.position;
    if (!position || position.count < 3) return;
    geometries.add(geometry);
    const transform = (attribute, relative = false) => {
      for (let i = 0; i < attribute.count; i++) {
        const x = attribute.getX(i), y = attribute.getY(i), z = attribute.getZ(i);
        attribute.setXYZ(i,
          relative ? x * scale : (x - offset[0]) * scale,
          relative ? y * scale : (y - offset[1]) * scale,
          relative ? z * scale : (z - offset[2]) * scale
        );
      }
      attribute.needsUpdate = true;
      vertexCount += attribute.count;
    };
    transform(position);
    for (const morphPosition of geometry.morphAttributes?.position || []) {
      transform(morphPosition, geometry.morphTargetsRelative === true);
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    meshCount++;
  });
  if (!meshCount) throw new Error('CAD Bridge restoration found no Stage1 polygon meshes');
  rootObject.updateMatrixWorld(true, true);
  return { offset, scale, meshCount, vertexCount };
}

const previousBytes = execFileSync('git', [
  'show',
  '6851eb9ba3566b9f283dd961d7519ed3623bf9d9:clients/alpine-resort/models/slopes_stage1.fbx'
], { maxBuffer: 20 * 1024 * 1024 });
const previousBuffer = previousBytes.buffer.slice(
  previousBytes.byteOffset,
  previousBytes.byteOffset + previousBytes.byteLength
);
const previousRoot = new FBXLoader().parse(previousBuffer, '');
const previousRootInitial = {
  name: previousRoot.name,
  position: previousRoot.position.toArray(),
  scale: previousRoot.scale.toArray()
};
previousRoot.position.fromArray(asset.transform?.position || [0, 0, 0]);
previousRoot.rotation.fromArray(asset.transform?.rotation || [0, 0, 0]);
previousRoot.scale.fromArray(asset.transform?.scale || [1, 1, 1]);
previousRoot.updateMatrixWorld(true);
const previousBounds = new Box3().setFromObject(previousRoot);
const previousSize = previousBounds.getSize(new Vector3());
let previousMeshCount = 0, previousVertexCount = 0;
previousRoot.traverse(object => {
  if (object.isMesh && object.geometry?.attributes?.position) {
    previousMeshCount++;
    previousVertexCount += object.geometry.attributes.position.count;
  }
});
if (!root) throw new Error('FBXLoader returned no root object');

const exportedBounds = new Box3().setFromObject(root);
const cadBridgeRestoration = restoreCadBridgeWorkingCoordinates(root, asset.mayaExport);
const scale = asset.transform?.scale;
if (Array.isArray(scale) && scale.length === 3) root.scale.fromArray(scale);
root.updateWorldMatrix(true, true);

const meshes = [];
let vertexCount = 0;
let visibleMeshCount = 0;
root.traverse(object => {
  if (!object.isMesh || !object.geometry?.attributes?.position) return;
  const positions = object.geometry.attributes.position;
  if (positions.count < 3) return;
  let visible = true;
  for (let node = object; node; node = node.parent) {
    if (node.visible === false) visible = false;
  }
  if (visible) visibleMeshCount++;
  vertexCount += positions.count;
  const bounds = new Box3().setFromObject(object);
  meshes.push({
    name: object.name || '(unnamed)',
    visible,
    vertices: positions.count,
    triangles: object.geometry.index
      ? Math.floor(object.geometry.index.count / 3)
      : Math.floor(positions.count / 3),
    min: bounds.min.toArray(),
    max: bounds.max.toArray(),
    materialCount: Array.isArray(object.material) ? object.material.length : (object.material ? 1 : 0)
  });
});

const bounds = new Box3().setFromObject(root);
const size = bounds.getSize(new Vector3());

const realTerrainManifest = JSON.parse(readFileSync('assets/real-terrain.json', 'utf8'));
const terrainBytes = readFileSync('assets/real-terrain.fbx');
const terrainBuffer = terrainBytes.buffer.slice(terrainBytes.byteOffset, terrainBytes.byteOffset + terrainBytes.byteLength);
const terrainRoot = new FBXLoader().parse(terrainBuffer, '');
const terrainScale = Number(realTerrainManifest.mayaExport?.metersPerUnit) || 0.01;
terrainRoot.scale.multiplyScalar(terrainScale);
terrainRoot.updateMatrixWorld(true);
const terrainBounds = new Box3().setFromObject(terrainRoot);
const terrainSize = terrainBounds.getSize(new Vector3());
const terrainHeightLookup = buildTerrainHeightLookup(terrainRoot, terrainBounds, 25);
const terrainGeometryDiagnostics = inspectTerrainGeometry(terrainRoot, terrainScale);
const terrainHeightComparison = {
  triangleCount: terrainHeightLookup.triangleCount,
  cellSizeMeters: terrainHeightLookup.cellSize,
  perMesh: [],
  allMeshes: []
};
const allHeightDeltas = [];
root.updateWorldMatrix(true, true);
root.traverseVisible(mesh => {
  if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return;
  mesh.updateWorldMatrix(true, false);
  const positions = mesh.geometry.attributes.position;
  const step = Math.max(1, Math.floor(positions.count / 1500));
  const deltas = [];
  let tested = 0, outsideTerrain = 0;
  const point = new Vector3();
  for (let index = 0; index < positions.count; index += step) {
    point.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld);
    tested++;
    const terrainY = sampleTerrainHeight(point.x, point.z, terrainHeightLookup);
    if (terrainY === null) { outsideTerrain++; continue; }
    deltas.push(point.y - terrainY);
  }
  allHeightDeltas.push(...deltas);
  terrainHeightComparison.perMesh.push({
    name: mesh.name || '(unnamed)',
    testedVertices: tested,
    outsideTerrain,
    stageAboveTerrainMeters: summarizeValues(deltas)
  });
});
terrainHeightComparison.allMeshes = {
  testedMeshes: terrainHeightComparison.perMesh.length,
  samples: allHeightDeltas.length,
  stageAboveTerrainMeters: summarizeValues(allHeightDeltas)
};
const horizontalOverlap = terrainBounds.isEmpty() || bounds.isEmpty() ? [0, 0] : [
  Math.max(0, Math.min(bounds.max.x, terrainBounds.max.x) - Math.max(bounds.min.x, terrainBounds.min.x)),
  Math.max(0, Math.min(bounds.max.z, terrainBounds.max.z) - Math.max(bounds.min.z, terrainBounds.min.z))
];
const restoredStageOneSharesTerrainFrame = horizontalOverlap[0] > 0 && horizontalOverlap[1] > 0;

function measure(rootObject) {
  rootObject.updateWorldMatrix(true, true);
  const box = new Box3().setFromObject(rootObject);
  const dimensions = box.getSize(new Vector3());
  return box.isEmpty() ? null : {
    min: box.min.toArray(),
    max: box.max.toArray(),
    size: dimensions.toArray()
  };
}


function inspectTerrainGeometry(rootObject, metersPerUnit) {
  rootObject.updateWorldMatrix(true, true);
  const meshes = [];
  const aggregate = {
    triangles: 0,
    duplicateTriangleGroupsAt1mm: 0,
    duplicateTrianglesAt1mm: 0,
    duplicateTriangleGroupsAt1cm: 0,
    duplicateTrianglesAt1cm: 0,
    degenerateBelow1e8m2: 0,
    tinyBelow1e6m2: 0,
    smallBelow1e4m2: 0,
    repeatedIndexFaces: 0,
    nonManifoldEdges: 0,
    boundaryEdges: 0
  };
  const p = [new Vector3(), new Vector3(), new Vector3()];
  const edgeMap = new Map();
  const q = (value, tolerance) => Math.round(value / tolerance);
  const pointKey = (point, tolerance) =>
    q(point.x, tolerance) + ',' + q(point.y, tolerance) + ',' + q(point.z, tolerance);
  const edgeKey = (a, b) => a < b ? a + '|' + b : b + '|' + a;
  const faceKey = keys => keys.slice().sort().join('|');

  rootObject.traverseVisible(mesh => {
    if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return;
    mesh.updateWorldMatrix(true, false);
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    const index = geometry.index;
    const count = index ? index.count : position.count;
    const duplicateFaces1mm = new Map();
    const duplicateFaces1cm = new Map();
    let triangles = 0;
    let degenerateBelow1e8m2 = 0, tinyBelow1e6m2 = 0, smallBelow1e4m2 = 0;
    let repeatedIndexFaces = 0;
    let minArea = Infinity, maxArea = 0;
    let sumArea = 0;
    let maxAbsLocal = [0, 0, 0];

    for (let vertex = 0; vertex < position.count; vertex++) {
      maxAbsLocal[0] = Math.max(maxAbsLocal[0], Math.abs(position.getX(vertex)));
      maxAbsLocal[1] = Math.max(maxAbsLocal[1], Math.abs(position.getY(vertex)));
      maxAbsLocal[2] = Math.max(maxAbsLocal[2], Math.abs(position.getZ(vertex)));
    }

    for (let offset = 0; offset + 2 < count; offset += 3) {
      const ids = [
        index ? index.getX(offset) : offset,
        index ? index.getX(offset + 1) : offset + 1,
        index ? index.getX(offset + 2) : offset + 2
      ];
      if (ids[0] === ids[1] || ids[1] === ids[2] || ids[2] === ids[0]) {
        repeatedIndexFaces++;
      }
      for (let corner = 0; corner < 3; corner++) {
        p[corner].fromBufferAttribute(position, ids[corner]).applyMatrix4(mesh.matrixWorld);
      }
      const ab = p[1].clone().sub(p[0]);
      const ac = p[2].clone().sub(p[0]);
      const area = ab.cross(ac).length() * 0.5;
      triangles++;
      minArea = Math.min(minArea, area);
      maxArea = Math.max(maxArea, area);
      sumArea += area;
      if (area < 1e-8) degenerateBelow1e8m2++;
      if (area < 1e-6) tinyBelow1e6m2++;
      if (area < 1e-4) smallBelow1e4m2++;

      const keys1mm = p.map(point => pointKey(point, 0.001));
      const keys1cm = p.map(point => pointKey(point, 0.01));
      const key1mm = faceKey(keys1mm);
      const key1cm = faceKey(keys1cm);
      duplicateFaces1mm.set(key1mm, (duplicateFaces1mm.get(key1mm) || 0) + 1);
      duplicateFaces1cm.set(key1cm, (duplicateFaces1cm.get(key1cm) || 0) + 1);

      const exactEdgeKeys = keys1mm;
      for (let edge = 0; edge < 3; edge++) {
        const key = edgeKey(exactEdgeKeys[edge], exactEdgeKeys[(edge + 1) % 3]);
        edgeMap.set(key, (edgeMap.get(key) || 0) + 1);
      }
    }

    const duplicateGroups1mm = [...duplicateFaces1mm.values()].filter(value => value > 1);
    const duplicateGroups1cm = [...duplicateFaces1cm.values()].filter(value => value > 1);
    const duplicateTriangles1mm = duplicateGroups1mm.reduce((sum, count) => sum + count - 1, 0);
    const duplicateTriangles1cm = duplicateGroups1cm.reduce((sum, count) => sum + count - 1, 0);
    const float32UlpMeters = maxAbsLocal.map(value => {
      if (!value) return 0;
      return Math.pow(2, Math.floor(Math.log2(value)) - 23) * metersPerUnit;
    });
    const bounds = new Box3().setFromObject(mesh);
    const geometryInfo = {
      name: mesh.name || '(unnamed)',
      indexed: !!index,
      vertices: position.count,
      triangles,
      groups: geometry.groups?.length || 0,
      attributes: Object.keys(geometry.attributes || {}),
      localBounds: geometry.boundingBox ? {
        min: geometry.boundingBox.min.toArray(),
        max: geometry.boundingBox.max.toArray()
      } : null,
      worldBounds: bounds.isEmpty() ? null : {
        min: bounds.min.toArray(),
        max: bounds.max.toArray()
      },
      sourceFloat32MaxAbs: maxAbsLocal,
      estimatedFloat32UlpMeters: float32UlpMeters,
      triangleAreaM2: {
        min: Number.isFinite(minArea) ? minArea : null,
        mean: triangles ? sumArea / triangles : null,
        max: maxArea || null
      },
      repeatedIndexFaces,
      degenerateBelow1e8m2,
      tinyBelow1e6m2,
      smallBelow1e4m2,
      duplicateTriangleGroupsAt1mm: duplicateGroups1mm.length,
      duplicateTrianglesAt1mm: duplicateTriangles1mm,
      duplicateTriangleGroupsAt1cm: duplicateGroups1cm.length,
      duplicateTrianglesAt1cm: duplicateTriangles1cm
    };
    meshes.push(geometryInfo);
    aggregate.triangles += triangles;
    aggregate.duplicateTriangleGroupsAt1mm += duplicateGroups1mm.length;
    aggregate.duplicateTrianglesAt1mm += duplicateTriangles1mm;
    aggregate.duplicateTriangleGroupsAt1cm += duplicateGroups1cm.length;
    aggregate.duplicateTrianglesAt1cm += duplicateTriangles1cm;
    aggregate.degenerateBelow1e8m2 += degenerateBelow1e8m2;
    aggregate.tinyBelow1e6m2 += tinyBelow1e6m2;
    aggregate.smallBelow1e4m2 += smallBelow1e4m2;
    aggregate.repeatedIndexFaces += repeatedIndexFaces;
  });

  for (const adjacentFaces of edgeMap.values()) {
    if (adjacentFaces === 1) aggregate.boundaryEdges++;
    else if (adjacentFaces > 2) aggregate.nonManifoldEdges++;
  }
  return {
    coordinateScaleToMeters: metersPerUnit,
    meshCount: meshes.length,
    meshes,
    aggregate: { ...aggregate, uniquePositionEdges: edgeMap.size }
  };
}

function buildTerrainHeightLookup(terrainRoot, bounds, cellSize = 25) {
  const size = bounds.getSize(new Vector3());
  const cols = Math.max(1, Math.ceil(size.x / cellSize));
  const rows = Math.max(1, Math.ceil(size.z / cellSize));
  const cells = new Map();
  const large = [];
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  let triangleCount = 0;

  const insert = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(denominator) < 1e-10) return;
    const triangle = {ax, ay, az, bx, by, bz, cx, cy, cz, denominator};
    const ix0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - bounds.min.x) / cellSize));
    const ix1 = Math.min(cols - 1, Math.floor((Math.max(ax, bx, cx) - bounds.min.x) / cellSize));
    const iz0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - bounds.min.z) / cellSize));
    const iz1 = Math.min(rows - 1, Math.floor((Math.max(az, bz, cz) - bounds.min.z) / cellSize));
    if (ix1 < ix0 || iz1 < iz0) return;
    const cellCount = (ix1 - ix0 + 1) * (iz1 - iz0 + 1);
    if (cellCount > 256) {
      large.push(triangle);
    } else {
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const key = iz * cols + ix;
          let bucket = cells.get(key);
          if (!bucket) { bucket = []; cells.set(key, bucket); }
          bucket.push(triangle);
        }
      }
    }
    triangleCount++;
  };

  terrainRoot.updateWorldMatrix(true, true);
  terrainRoot.traverseVisible(mesh => {
    if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return;
    mesh.updateWorldMatrix(true, false);
    const geometry = mesh.geometry;
    const positions = geometry.attributes.position;
    const index = geometry.index;
    const count = index ? index.count : positions.count;
    for (let offset = 0; offset + 2 < count; offset += 3) {
      const ia = index ? index.getX(offset) : offset;
      const ib = index ? index.getX(offset + 1) : offset + 1;
      const ic = index ? index.getX(offset + 2) : offset + 2;
      a.fromBufferAttribute(positions, ia).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(positions, ib).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(positions, ic).applyMatrix4(mesh.matrixWorld);
      insert(a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z);
    }
  });
  return {originX:bounds.min.x,originZ:bounds.min.z,cellSize,cols,rows,cells,large,triangleCount};
}

function sampleTerrainHeight(x, z, lookup) {
  const ix = Math.floor((x - lookup.originX) / lookup.cellSize);
  const iz = Math.floor((z - lookup.originZ) / lookup.cellSize);
  if (ix < 0 || iz < 0 || ix >= lookup.cols || iz >= lookup.rows) return null;
  const candidates = [
    ...(lookup.cells.get(iz * lookup.cols + ix) || []),
    ...lookup.large
  ];
  for (const t of candidates) {
    const wa = ((t.bz - t.cz) * (x - t.cx) + (t.cx - t.bx) * (z - t.cz)) / t.denominator;
    const wb = ((t.cz - t.az) * (x - t.cx) + (t.ax - t.cx) * (z - t.cz)) / t.denominator;
    const wc = 1 - wa - wb;
    if (wa >= -1e-5 && wb >= -1e-5 && wc >= -1e-5) {
      return wa * t.ay + wb * t.by + wc * t.cy;
    }
  }
  return null;
}

function summarizeValues(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a,b)=>a-b);
  const percentile = p => sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*p))];
  const mean = values.reduce((sum,value)=>sum+value,0)/values.length;
  return {
    samples: values.length,
    min: sorted[0],
    p05: percentile(0.05),
    median: percentile(0.5),
    mean,
    p95: percentile(0.95),
    max: sorted[sorted.length-1],
    within0_5m: values.filter(value=>Math.abs(value)<=0.5).length,
    within2m: values.filter(value=>Math.abs(value)<=2).length,
    within5m: values.filter(value=>Math.abs(value)<=5).length
  };
}

const rebaseTest = root.clone(true);
const allDescendantScalesReset = root.clone(true);
allDescendantScalesReset.position.fromArray(asset.transform?.position || [0, 0, 0]);
allDescendantScalesReset.rotation.fromArray(asset.transform?.rotation || [0, 0, 0]);
allDescendantScalesReset.scale.fromArray(scale || [1, 1, 1]);
allDescendantScalesReset.traverse(node => {
  if (node !== allDescendantScalesReset) node.scale.set(1, 1, 1);
});
const allScalesResetBounds = measure(allDescendantScalesReset);
const allDescendantGroupsReset = root.clone(true);
allDescendantGroupsReset.position.fromArray(asset.transform?.position || [0, 0, 0]);
allDescendantGroupsReset.rotation.fromArray(asset.transform?.rotation || [0, 0, 0]);
allDescendantGroupsReset.scale.fromArray(scale || [1, 1, 1]);
const scaledNodes = [];
allDescendantGroupsReset.traverse(node => {
  if (node === allDescendantGroupsReset) return;
  const current = node.scale.toArray();
  if (current.some(v => Math.abs(v - 1) > 1e-4)) {
    scaledNodes.push({name: node.name, oldScale: current});
    node.scale.set(1, 1, 1);
  }
});
const groupsResetBounds = measure(allDescendantGroupsReset);
const normalizedHierarchy = root.clone(true);
normalizedHierarchy.position.fromArray(asset.transform?.position || [0, 0, 0]);
normalizedHierarchy.rotation.fromArray(asset.transform?.rotation || [0, 0, 0]);
normalizedHierarchy.scale.fromArray(scale || [1, 1, 1]);
let sketchfabGroupInfo = null;
normalizedHierarchy.traverse(node => {
  if (node !== normalizedHierarchy) node.scale.set(1, 1, 1);
  if (node.name === 'ToSketchfab') {
    sketchfabGroupInfo = { originalPosition: node.position.toArray(), originalRotation: [node.rotation.x, node.rotation.y, node.rotation.z] };
    node.position.set(0, 0, 0);
  }
});
const normalizedHierarchyBounds = measure(normalizedHierarchy);
const sceneRootNode = rebaseTest.getObjectByName('MAYA_WORKING_SCENE_001');
const rebaseBefore = measure(rebaseTest);
let sceneRootTransform = null;
let boundsAfterRootOffsetRemoved = null;
if (sceneRootNode) {
  sceneRootTransform = {
    name: sceneRootNode.name,
    position: sceneRootNode.position.toArray(),
    scale: sceneRootNode.scale.toArray(),
    matrixAutoUpdate: sceneRootNode.matrixAutoUpdate
  };
  sceneRootNode.position.set(0, 0, 0);
  boundsAfterRootOffsetRemoved = measure(rebaseTest);
}
const rootTransform = {
  name: root.name || '(unnamed)',
  position: root.position.toArray(),
  scale: root.scale.toArray(),
  matrixAutoUpdate: root.matrixAutoUpdate,
  matrix: root.matrix.toArray()
};

const hierarchy = [];
for (let node = meshes.length ? root.getObjectByName(meshes.find(item => item.name === 'G1Slope_Mesh_30m')?.name) : null; node; node = node.parent) {
  hierarchy.push({
    name: node.name || '(unnamed)',
    position: node.position.toArray(),
    rotation: [node.rotation.x, node.rotation.y, node.rotation.z],
    scale: node.scale.toArray()
  });
}

console.log(JSON.stringify({
  file,
  bytes: bytes.byteLength,
  previousKnownGood: {
    commit: '6851eb9ba3566b9f283dd961d7519ed3623bf9d9',
    bytes: previousBytes.byteLength,
    rootBeforeTransform: previousRootInitial,
    meshCount: previousMeshCount,
    vertexCount: previousVertexCount,
    bounds: previousBounds.isEmpty() ? null : {
      min: previousBounds.min.toArray(),
      max: previousBounds.max.toArray(),
      size: previousSize.toArray()
    }
  },
  fbxUnitScaleFactor: root.userData?.unitScaleFactor ?? null,
  cadBridgeRestoration,
  exportedBoundsBeforeCadRestoration: exportedBounds.isEmpty() ? null : {
    min: exportedBounds.min.toArray(), max: exportedBounds.max.toArray()
  },
  manifestScale: scale ?? null,
  meshCount: meshes.length,
  visibleMeshCount,
  vertexCount,
  boundsEmpty: bounds.isEmpty(),
  bounds: bounds.isEmpty() ? null : { min: bounds.min.toArray(), max: bounds.max.toArray(), size: size.toArray() },
  terrainComparison: {
    sourceScene: realTerrainManifest.mayaExport?.sourceScene,
    realTerrainManifestBoundsCm: realTerrainManifest.mayaExport?.worldBounds ?? null,
    realTerrainScale: terrainScale,
    terrainGeometryDiagnostics,
    realTerrainBoundsMeters: terrainBounds.isEmpty() ? null : {
      min: terrainBounds.min.toArray(),
      max: terrainBounds.max.toArray(),
      size: terrainSize.toArray()
    },
    stageOneTerrainHorizontalOverlapMeters: horizontalOverlap,
    restoredStageOneSharesTerrainFrame,
    stageOneTerrainHeightComparison: terrainHeightComparison
  },
  rootTransform,
  rebaseTest: { before: rebaseBefore, sceneRootTransform, afterRemovingSceneRootTranslation: boundsAfterRootOffsetRemoved },
  scaleTests: {
    allDescendantScalesReset: allScalesResetBounds,
    descendantsWhoseScaleWasChanged: scaledNodes,
    allNonRootGroupsScaleReset: groupsResetBounds,
    normalizedWithoutToSketchfabOffset: normalizedHierarchyBounds,
    toSketchfabGroup: sketchfabGroupInfo
  },
  targetMeshHierarchy: hierarchy,
  meshes
}, null, 2));

if (!meshes.length || !vertexCount || bounds.isEmpty()) {
  throw new Error('Three.js FBXLoader found no usable mesh geometry.');
}
if (!visibleMeshCount) {
  throw new Error('Three.js FBXLoader found meshes, but all are hidden in the FBX hierarchy.');
}
if (asset.mayaExport?.cadBridge?.inverseApplied === true && !restoredStageOneSharesTerrainFrame) {
  throw new Error('Stage1 geometry does not overlap canonical Terrain after CAD Bridge restoration.');
}
