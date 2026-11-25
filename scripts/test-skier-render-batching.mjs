import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { setStageOneSkierRenderBatch } from '../skier-render-batching.v1.js';

test('static Stage1 meshes sharing a material merge into one render mesh and restore cleanly', () => {
  const root = new THREE.Group();
  root.name = 'Slopes_Stage1';
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const first = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 2), material);
  const second = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  second.position.set(4, 0, 0);
  root.add(first, second);
  root.updateMatrixWorld(true);

  const active = setStageOneSkierRenderBatch(root, true);
  assert.equal(active.sourceMeshCount, 2);
  assert.equal(active.batchedSourceMeshCount, 2);
  assert.equal(active.batchMeshCount, 1);
  assert.equal(active.estimatedDrawCallsBefore, 2);
  assert.equal(active.estimatedDrawCallsAfter, 1);
  assert.equal(first.visible, false);
  assert.equal(second.visible, false);
  assert.equal(first.userData.goSkierBatchHidden, true);
  assert.equal(root.getObjectByName('GO_SkierStage1RenderBatch')?.visible, true);
  assert.equal(root.getObjectByName('GO_SkierStage1Batch_01')?.userData.physicsCollision, false);

  const disabled = setStageOneSkierRenderBatch(root, false);
  assert.equal(disabled.active, false);
  assert.equal(first.visible, true);
  assert.equal(second.visible, true);
  assert.equal(first.userData.goSkierBatchHidden, undefined);
  assert.equal(root.getObjectByName('GO_SkierStage1RenderBatch'), undefined);
});

test('meshes with negative transforms or multiple material groups are left untouched', () => {
  const root = new THREE.Group();
  const material = new THREE.MeshStandardMaterial();
  const mirrored = new THREE.Mesh(new THREE.BoxGeometry(), material);
  mirrored.scale.x = -1;
  const groupedGeometry = new THREE.BoxGeometry();
  groupedGeometry.clearGroups();
  groupedGeometry.addGroup(0, 12, 0);
  groupedGeometry.addGroup(12, 24, 1);
  const grouped = new THREE.Mesh(groupedGeometry, [material, material]);
  root.add(mirrored, grouped);
  root.updateMatrixWorld(true);

  const active = setStageOneSkierRenderBatch(root, true);
  assert.equal(active.batchedSourceMeshCount, 0);
  assert.equal(active.batchMeshCount, 0);
  assert.equal(mirrored.visible, true);
  assert.equal(grouped.visible, true);
  setStageOneSkierRenderBatch(root, false);
});
