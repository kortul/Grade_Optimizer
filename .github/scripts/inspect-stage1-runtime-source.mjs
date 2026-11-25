import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const project = 'alpine-resort';
const manifestPath = join(root, 'clients', project, 'scene.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const asset = (manifest.assets || []).find(item =>
  item.id === 'slopes_stage1' ||
  String(item.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').includes('slopes_stage1')
);

function summarizeGlb(path) {
  if (!existsSync(path)) return { exists: false };
  const buffer = readFileSync(path);
  if (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'glTF') {
    return { exists: true, bytes: buffer.length, error: 'invalid GLB header' };
  }
  const version = buffer.readUInt32LE(4);
  const declaredLength = buffer.readUInt32LE(8);
  let offset = 12, document = null, jsonBytes = 0;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const start = offset + 8, end = start + length;
    if (end > buffer.length) throw new Error('GLB chunk exceeds file length: ' + path);
    if (type === 0x4e4f534a) {
      jsonBytes = length;
      document = JSON.parse(buffer.toString('utf8', start, end).replace(/\0+$/g, '').trim());
      break;
    }
    offset = end;
  }
  if (!document) throw new Error('GLB JSON chunk is missing: ' + path);
  const nodes = document.nodes || [];
  const meshes = document.meshes || [];
  const accessors = document.accessors || [];
  const meshNodes = nodes.filter(node => Number.isInteger(node.mesh));
  let primitiveCount = 0, triangles = 0, materialSlots = 0, positionAccessors = 0;
  const perMesh = meshes.map((mesh, index) => {
    const primitives = mesh.primitives || [];
    primitiveCount += primitives.length;
    let meshTriangles = 0;
    for (const primitive of primitives) {
      const positionIndex = primitive.attributes?.POSITION;
      const position = Number.isInteger(positionIndex) ? accessors[positionIndex] : null;
      const elementAccessor = Number.isInteger(primitive.indices) ? accessors[primitive.indices] : position;
      const count = Number(elementAccessor?.count || 0);
      const mode = primitive.mode ?? 4;
      const primitiveTriangles = mode === 4 ? Math.floor(count / 3)
        : (mode === 5 || mode === 6) ? Math.max(0, count - 2) : 0;
      meshTriangles += primitiveTriangles;
      triangles += primitiveTriangles;
      if (position) positionAccessors++;
      if (Number.isInteger(primitive.material)) materialSlots++;
    }
    return { index, name: mesh.name || '', primitives: primitives.length, triangles: meshTriangles };
  });
  const sceneRoots = (document.scenes || []).flatMap(scene => scene.nodes || []);
  const hierarchy = [];
  const visit = (index, depth = 0) => {
    const node = nodes[index];
    if (!node || depth > 12) return;
    hierarchy.push({ depth, name: node.name || '(unnamed)', mesh: node.mesh ?? null, children: node.children?.length || 0 });
    (node.children || []).forEach(child => visit(child, depth + 1));
  };
  sceneRoots.forEach(index => visit(index));
  return {
    exists: true, bytes: buffer.length, version, declaredLength, jsonBytes,
    nodeCount: nodes.length, gltfMeshCount: meshes.length,
    renderableMeshNodes: meshNodes.length, primitiveCount, triangles,
    materialSlots, positionAccessors,
    perMesh: perMesh.slice(0, 40),
    hierarchy: hierarchy.slice(0, 80)
  };
}

const manifestAsset = asset ? {
  id: asset.id, name: asset.name, file: asset.file, sourceFile: asset.sourceFile,
  category: asset.category, visible: asset.visible,
  nodeVisibilityCount: asset.nodeVisibility?.length || 0,
  nodeMetadataCount: asset.nodeMetadata?.length || 0,
  mayaExportSource: asset.mayaExport?.sourceScene || null,
  inverseApplied: asset.mayaExport?.cadBridge?.inverseApplied ?? null
} : null;

const candidates = [
  'models/slopes_stage1.glb',
  'models/slopes_stage1.fbx'
];
const candidateStats = candidates.map(relative => {
  const path = join(root, 'clients', project, relative);
  if (relative.endsWith('.glb')) return { path: relative, ...summarizeGlb(path) };
  return { path: relative, exists: existsSync(path), bytes: existsSync(path) ? readFileSync(path).length : null };
});

let manifestFileStats = null;
if (asset?.file) {
  const path = join(root, 'clients', project, asset.file);
  manifestFileStats = asset.file.endsWith('.glb')
    ? { path: asset.file, ...summarizeGlb(path) }
    : { path: asset.file, exists: existsSync(path), bytes: existsSync(path) ? readFileSync(path).length : null };
}

console.log(JSON.stringify({
  project,
  manifestPath: 'clients/' + project + '/scene.json',
  manifestUpdatedAt: manifest.updatedAt || null,
  asset: manifestAsset,
  manifestFileStats,
  candidateStats
}, null, 2));
