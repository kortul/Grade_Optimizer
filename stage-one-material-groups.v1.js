export function compactStageOneMaterialGroups(THREE, mesh) {
  const geometry = mesh?.geometry;
  const originalGroups = geometry?.groups || [];
  if (!mesh?.isMesh || originalGroups.length <= 1) {
    return { changed: false, groupsBefore: originalGroups.length, groupsAfter: originalGroups.length };
  }
  if (
    mesh.isSkinnedMesh ||
    mesh.isInstancedMesh ||
    mesh.morphTargetInfluences?.length ||
    Object.values(geometry.morphAttributes || {}).some(items => items?.length)
  ) {
    return { changed: false, groupsBefore: originalGroups.length, groupsAfter: originalGroups.length, reason: 'deforming-mesh' };
  }

  const attributes = Object.entries(geometry.attributes || {});
  if (!attributes.length || attributes.some(([, attribute]) =>
    !attribute?.array || attribute.isInterleavedBufferAttribute || attribute.isInstancedBufferAttribute
  )) {
    return { changed: false, groupsBefore: originalGroups.length, groupsAfter: originalGroups.length, reason: 'unsupported-attributes' };
  }

  const position = geometry.attributes.position;
  if (!position || position.itemSize < 3) {
    return { changed: false, groupsBefore: originalGroups.length, groupsAfter: originalGroups.length, reason: 'missing-position' };
  }

  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (!materials.length || materials.some(material => !material)) {
    return { changed: false, groupsBefore: originalGroups.length, groupsAfter: originalGroups.length, reason: 'missing-material' };
  }

  const elementCount = geometry.index?.count ?? position.count;
  const drawRange = geometry.drawRange || { start: 0, count: Infinity };
  if (drawRange.start !== 0 || (Number.isFinite(drawRange.count) && drawRange.count < elementCount)) {
    return { changed: false, groupsBefore: originalGroups.length, groupsAfter: originalGroups.length, reason: 'partial-draw-range' };
  }

  const buckets = new Map();
  let sourceElementCount = 0;
  for (const group of originalGroups) {
    const start = Number(group.start);
    const count = Number(group.count);
    const material = materials[group.materialIndex ?? 0] || materials[0];
    if (
      !Number.isInteger(start) || !Number.isInteger(count) ||
      start < 0 || count <= 0 || start + count > elementCount ||
      count % 3 !== 0 || !material
    ) {
      return { changed: false, groupsBefore: originalGroups.length, groupsAfter: originalGroups.length, reason: 'invalid-group-range' };
    }

    const key = material.uuid || String(material.id);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { material, values: new Map(), elementCount: 0 };
      for (const [name] of attributes) bucket.values.set(name, []);
      buckets.set(key, bucket);
    }

    for (let element = start; element < start + count; element++) {
      const vertexIndex = geometry.index ? geometry.index.getX(element) : element;
      if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= position.count) {
        return { changed: false, groupsBefore: originalGroups.length, groupsAfter: originalGroups.length, reason: 'invalid-vertex-index' };
      }
      for (const [name, attribute] of attributes) {
        if (vertexIndex >= attribute.count) {
          return { changed: false, groupsBefore: originalGroups.length, groupsAfter: originalGroups.length, reason: 'attribute-count-mismatch' };
        }
        const output = bucket.values.get(name);
        const offset = vertexIndex * attribute.itemSize;
        for (let component = 0; component < attribute.itemSize; component++) {
          output.push(attribute.array[offset + component]);
        }
      }
      bucket.elementCount++;
    }
    sourceElementCount += count;
  }

  if (!buckets.size || sourceElementCount === 0) {
    return { changed: false, groupsBefore: originalGroups.length, groupsAfter: originalGroups.length, reason: 'empty-groups' };
  }

  const compactGeometry = new THREE.BufferGeometry();
  compactGeometry.name = geometry.name || '';
  compactGeometry.userData = { ...(geometry.userData || {}) };
  let cursor = 0;
  const compactMaterials = [];
  const compactBuckets = [...buckets.values()];

  for (const bucket of compactBuckets) {
    const materialIndex = compactMaterials.length;
    compactMaterials.push(bucket.material);
    compactGeometry.addGroup(cursor, bucket.elementCount, materialIndex);
    cursor += bucket.elementCount;
  }

  for (const [name, sourceAttribute] of attributes) {
    const length = compactBuckets.reduce(
      (sum, bucket) => sum + bucket.values.get(name).length,
      0
    );
    const packed = new sourceAttribute.array.constructor(length);
    let offset = 0;
    for (const bucket of compactBuckets) {
      const values = bucket.values.get(name);
      packed.set(values, offset);
      offset += values.length;
    }
    const attribute = new THREE.BufferAttribute(
      packed,
      sourceAttribute.itemSize,
      sourceAttribute.normalized
    );
    attribute.name = sourceAttribute.name || '';
    if (sourceAttribute.usage !== undefined && attribute.setUsage) {
      attribute.setUsage(sourceAttribute.usage);
    }
    if (sourceAttribute.gpuType !== undefined) attribute.gpuType = sourceAttribute.gpuType;
    compactGeometry.setAttribute(name, attribute);
  }

  compactGeometry.setDrawRange(0, cursor);
  compactGeometry.computeBoundingBox();
  compactGeometry.computeBoundingSphere();

  const previousTriangleCount = Math.floor(sourceElementCount / 3);
  mesh.geometry = compactGeometry;
  mesh.material = compactMaterials.length === 1 ? compactMaterials[0] : compactMaterials;

  return {
    changed: true,
    groupsBefore: originalGroups.length,
    groupsAfter: compactGeometry.groups.length,
    materialsBefore: materials.length,
    materialsAfter: compactMaterials.length,
    elementsBefore: sourceElementCount,
    elementsAfter: cursor,
    trianglesPreserved: previousTriangleCount
  };
}
