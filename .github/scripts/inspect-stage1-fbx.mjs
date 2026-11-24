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
    realTerrainBoundsMeters: terrainBounds.isEmpty() ? null : {
      min: terrainBounds.min.toArray(),
      max: terrainBounds.max.toArray(),
      size: terrainSize.toArray()
    },
    stageOneTerrainHorizontalOverlapMeters: horizontalOverlap,
    restoredStageOneSharesTerrainFrame
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
