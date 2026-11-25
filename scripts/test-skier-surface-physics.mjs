import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePhysicsContactNormal } from '../skier-terrain-contact.v4.js';

test('Terrain and piste use the same geometry-derived normal for the same face',()=>{
  const geometricFace={x:0.28,y:0.92,z:0.27};
  const terrainContact=resolvePhysicsContactNormal({...geometricFace});
  const pisteContact=resolvePhysicsContactNormal({...geometricFace});
  assert.deepEqual(terrainContact,pisteContact);
  assert.ok(Math.abs(Math.hypot(terrainContact.x,terrainContact.y,terrainContact.z)-1)<1e-12);
});

test('geometric normals are normalized and near-vertical collision faces are rejected',()=>{
  const normal=resolvePhysicsContactNormal({x:1,y:1,z:0});
  assert.ok(normal);
  assert.ok(Math.abs(Math.hypot(normal.x,normal.y,normal.z)-1)<1e-12);
  assert.equal(resolvePhysicsContactNormal({x:1,y:0,z:0}),null);
});
