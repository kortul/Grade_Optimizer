import { readFileSync } from 'node:fs';
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
if (!root) throw new Error('FBXLoader returned no root object');

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
  fbxUnitScaleFactor: root.userData?.unitScaleFactor ?? null,
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
    }
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
