import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const batchCache = new WeakMap();

function visibleInHierarchy(object, root) {
  for (let node = object; node; node = node.parent) {
    if (node.visible === false) return false;
    if (node === root) break;
  }
  return true;
}

function attributeLayout(geometry) {
  const attributes = Object.keys(geometry.attributes || {}).sort();
  const layout = attributes.map(name => {
    const attribute = geometry.attributes[name];
    if (!attribute || attribute.isInterleavedBufferAttribute) return null;
    return [
      name,
      attribute.itemSize,
      attribute.normalized ? 1 : 0,
      attribute.array?.constructor?.name || '',
      attribute.gpuType || ''
    ].join(':');
  });
  if (layout.some(value => value === null)) return null;
  const indexType = geometry.index?.array?.constructor?.name || 'non-indexed';
  return indexType + '|' + layout.join('|');
}

function sourceSignature(root) {
  root.updateWorldMatrix(true, true);
  const rows = [];
  root.traverse(object => {
    if (!object.isMesh || !object.geometry?.attributes?.position) return;
    const material = Array.isArray(object.material) ? object.material.map(item => item?.uuid).join(',') : object.material?.uuid;
    rows.push([
      object.uuid,
      object.geometry.uuid,
      object.geometry.attributes.position.version,
      material || '',
      object.visible ? 1 : 0,
      object.matrixWorld.elements.map(value => Number(value.toFixed(5))).join(',')
    ].join(':'));
  });
  return rows.join(';');
}

function isFullGeometryDrawRange(geometry) {
  const elementCount = geometry.index?.count ?? geometry.attributes.position.count;
  const range = geometry.drawRange || { start: 0, count: Infinity };
  return range.start === 0 && (!Number.isFinite(range.count) || range.count >= elementCount);
}

function disposeRecord(record) {
  if (!record) return;
  record.sources.forEach(({ mesh, visible }) => {
    if (!mesh.parent && mesh.visible === false) mesh.visible = visible;
    if (mesh.userData) delete mesh.userData.goSkierBatchHidden;
  });
  record.group.traverse(object => {
    if (object.isMesh) object.geometry?.dispose();
  });
  record.group.clear();
}

function buildBatch(root, signature) {
  root.updateWorldMatrix(true, true);
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map();
  let sourceMeshCount = 0;
  let skippedMeshCount = 0;

  root.traverse(object => {
    if (!object.isMesh || !object.geometry?.attributes?.position) return;
    if (!visibleInHierarchy(object, root)) return;
    sourceMeshCount++;

    const geometry = object.geometry;
    const material = Array.isArray(object.material)
      ? (object.material.length === 1 ? object.material[0] : null)
      : object.material;

    const groupCount = geometry.groups?.length || 0;
    const elementCount = geometry.index?.count ?? geometry.attributes.position.count;
    const singleFullGroup = groupCount === 0 || (
      groupCount === 1 &&
      geometry.groups[0].start === 0 &&
      geometry.groups[0].count >= elementCount &&
      geometry.groups[0].materialIndex === 0
    );
    const layout = attributeLayout(geometry);

    if (
      !material ||
      object.isSkinnedMesh ||
      object.isInstancedMesh ||
      object.morphTargetInfluences?.length ||
      Object.values(geometry.morphAttributes || {}).some(items => items?.length) ||
      !singleFullGroup ||
      !isFullGeometryDrawRange(geometry) ||
      !layout ||
      geometry.drawMode && geometry.drawMode !== THREE.TrianglesDrawMode
    ) {
      skippedMeshCount++;
      return;
    }

    const localMatrix = new THREE.Matrix4().copy(rootInverse).multiply(object.matrixWorld);
    // Negative determinant reverses triangle winding; leave these rare meshes
    // untouched rather than changing front-face / normal behavior.
    if (localMatrix.determinant() <= 0) {
      skippedMeshCount++;
      return;
    }

    const key = [
      material.uuid,
      layout,
      object.renderOrder || 0,
      object.layers?.mask ?? 1
    ].join('|');
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        material,
        renderOrder: object.renderOrder || 0,
        layersMask: object.layers?.mask ?? 1,
        geometries: [],
        sources: []
      };
      buckets.set(key, bucket);
    }

    const copy = geometry.clone();
    copy.clearGroups();
    copy.applyMatrix4(localMatrix);
    bucket.geometries.push(copy);
    bucket.sources.push({
      mesh: object,
      visible: object.visible,
      castShadow: object.castShadow,
      receiveShadow: object.receiveShadow
    });
  });

  const group = new THREE.Group();
  group.name = 'GO_SkierStage1RenderBatch';
  group.visible = false;
  group.userData = { gradeOptimizerInternal: true, physicsCollision: false };
  const sources = [];
  let batchMeshCount = 0;
  let failedBatchCount = 0;

  for (const bucket of buckets.values()) {
    if (!bucket.geometries.length) continue;
    let merged = null;
    try {
      merged = bucket.geometries.length === 1
        ? bucket.geometries[0]
        : mergeGeometries(bucket.geometries, false);
    } catch (error) {
      console.warn('[Grade Optimizer] Stage1 batch merge failed; keeping source meshes visible.', error);
    }
    if (!merged) {
      bucket.geometries.forEach(geometry => geometry.dispose());
      failedBatchCount++;
      continue;
    }
    bucket.geometries.forEach(geometry => {
      if (geometry !== merged) geometry.dispose();
    });
    merged.clearGroups();
    merged.computeBoundingBox();
    merged.computeBoundingSphere();

    const mesh = new THREE.Mesh(merged, bucket.material);
    mesh.name = 'GO_SkierStage1Batch_' + String(batchMeshCount + 1).padStart(2, '0');
    mesh.renderOrder = bucket.renderOrder;
    mesh.layers.mask = bucket.layersMask;
    mesh.castShadow = bucket.sources.some(source => source.castShadow);
    mesh.receiveShadow = bucket.sources.some(source => source.receiveShadow);
    mesh.userData = { gradeOptimizerInternal: true, physicsCollision: false };
    group.add(mesh);
    sources.push(...bucket.sources);
    batchMeshCount++;
  }

  if (!batchMeshCount) {
    group.clear();
    return {
      signature,
      group: null,
      sources: [],
      stats: { sourceMeshCount, batchedSourceMeshCount: 0, batchMeshCount: 0, skippedMeshCount, failedBatchCount }
    };
  }

  return {
    signature,
    group,
    sources,
    stats: {
      sourceMeshCount,
      batchedSourceMeshCount: sources.length,
      batchMeshCount,
      skippedMeshCount,
      failedBatchCount,
      estimatedDrawCallsBefore: sources.length,
      estimatedDrawCallsAfter: batchMeshCount
    }
  };
}

export function setStageOneSkierRenderBatch(root, enabled) {
  if (!root?.isObject3D) return null;
  let record = batchCache.get(root);

  if (enabled) {
    if (record?.group?.parent === root) return { ...record.stats, active: true };
    const signature = sourceSignature(root);
    if (record && record.signature !== signature) {
      disposeRecord(record);
      batchCache.delete(root);
      record = null;
    }
    if (!record) {
      record = buildBatch(root, signature);
      batchCache.set(root, record);
    }
    if (!record.group) return { ...record.stats, active: false };
    root.add(record.group);
    record.group.visible = true;
    record.sources.forEach(({ mesh }) => {
      mesh.userData = mesh.userData || {};
      mesh.userData.goSkierBatchHidden = true;
      mesh.visible = false;
    });
    root.updateWorldMatrix(true, true);
    return { ...record.stats, active: true };
  }

  if (!record) return null;
  record.group && (record.group.visible = false);
  if (record.group?.parent === root) root.remove(record.group);
  record.sources.forEach(({ mesh, visible }) => {
    mesh.visible = visible;
    if (mesh.userData) delete mesh.userData.goSkierBatchHidden;
  });
  root.updateWorldMatrix(true, true);
  return { ...record.stats, active: false };
}
