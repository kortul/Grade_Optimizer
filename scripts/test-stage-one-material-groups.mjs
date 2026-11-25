import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { compactStageOneMaterialGroups } from '../stage-one-material-groups.v1.js';

test('thousands of alternating face groups collapse to one contiguous group per material', () => {
  const groupCount = 2624;
  const positions = new Float32Array(groupCount * 9);
  const normals = new Float32Array(groupCount * 9);
  for (let i = 0; i < groupCount * 3; i++) {
    positions[i * 3] = i;
    positions[i * 3 + 1] = i % 7;
    positions[i * 3 + 2] = i % 11;
    normals[i * 3 + 1] = 1;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  for (let i = 0; i < groupCount; i++) geometry.addGroup(i * 3, 3, i % 2);
  const materialA = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const materialB = new THREE.MeshStandardMaterial({ color: 0x383838 });
  const mesh = new THREE.Mesh(geometry, [materialA, materialB]);

  const result = compactStageOneMaterialGroups(THREE, mesh);
  assert.equal(result.changed, true);
  assert.equal(result.groupsBefore, 2624);
  assert.equal(result.groupsAfter, 2);
  assert.equal(result.materialsAfter, 2);
  assert.equal(mesh.geometry.groups[0].count + mesh.geometry.groups[1].count, groupCount * 3);
  assert.equal(mesh.geometry.attributes.position.count, groupCount * 3);
  assert.equal(mesh.geometry.attributes.normal.count, groupCount * 3);
  assert.equal(mesh.geometry.index, null);
  assert.equal(Math.floor(mesh.geometry.attributes.position.count / 3), groupCount);
  assert.equal(mesh.material.length, 2);
});

test('indexed geometry and duplicate material references are preserved while groups compact', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0,0,0, 1,0,0, 0,1,0, 1,1,0, 2,1,0, 2,0,0
  ], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([
    0,0,1, 0,0,1, 0,0,1, 0,0,1, 0,0,1, 0,0,1
  ], 3));
  geometry.setIndex([0,1,2, 2,1,3, 3,4,5]);
  geometry.addGroup(0, 3, 0);
  geometry.addGroup(3, 3, 1);
  geometry.addGroup(6, 3, 2);
  const material = new THREE.MeshStandardMaterial();
  const other = new THREE.MeshStandardMaterial({ color: 0x333333 });
  const mesh = new THREE.Mesh(geometry, [material, other, material]);

  const result = compactStageOneMaterialGroups(THREE, mesh);
  assert.equal(result.changed, true);
  assert.equal(result.groupsAfter, 2);
  assert.deepEqual(mesh.material, [material, other]);
  assert.equal(mesh.geometry.attributes.position.count, 9);
  assert.equal(mesh.geometry.groups[0].count, 6);
  assert.equal(mesh.geometry.groups[1].count, 3);
});

test('real Stage1 FBX collapses its two excessive material-group meshes to four total groups', () => {
  const file = 'clients/alpine-resort/models/slopes_stage1.fbx';
  const bytes = readFileSync(file);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const root = new FBXLoader().parse(arrayBuffer, '');
  const meshes = [];
  root.traverse(object => {
    if (object.isMesh && object.geometry?.attributes?.position) meshes.push(object);
  });
  assert.equal(meshes.length, 22);

  const originalTriangles = meshes.reduce((sum, mesh) => {
    const count = mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count;
    return sum + Math.floor(count / 3);
  }, 0);
  const originalGroups = meshes.reduce((sum, mesh) => sum + (mesh.geometry.groups?.length || 0), 0);
  const heavyMeshes = meshes.filter(mesh => (mesh.geometry.groups?.length || 0) > 1);
  assert.deepEqual(heavyMeshes.map(mesh => mesh.geometry.groups.length).sort((a,b)=>a-b), [1281,1323]);

  const results = meshes.map(mesh => compactStageOneMaterialGroups(THREE, mesh));
  const compactedGroups = meshes.reduce((sum, mesh) => sum + (mesh.geometry.groups?.length || 0), 0);
  const compactedTriangles = meshes.reduce((sum, mesh) => {
    const count = mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count;
    return sum + Math.floor(count / 3);
  }, 0);
  assert.equal(originalGroups, 2604);
  assert.equal(compactedGroups, 4);
  assert.equal(compactedTriangles, originalTriangles);
  assert.equal(results.filter(result => result.changed).length, 2);
  assert.equal(meshes.length, 22);
});
