import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_TERRAIN_NORMAL_Y,
  normalizeUpwardNormal,
  selectGroundContactCandidate,
  blendGroundNormal
} from '../skier-terrain-contact.v1.js';

const candidate=(surface,y,normal={x:0,y:1,z:0})=>({
  surface,
  point:{x:0,y,z:0},
  normal
});

test('overlapping piste and terrain choose the surface continuous with the skier height',()=>{
  const piste=candidate('Slopes_Stage1',102.4,{x:0.1,y:0.995,z:0});
  const terrain=candidate('Terrain',102.05,{x:0,y:1,z:0});
  assert.equal(selectGroundContactCandidate([piste,terrain],{
    referenceY:102.1,maxVerticalDelta:5,referenceNormal:{x:0,y:1,z:0}
  }),terrain);
  assert.equal(selectGroundContactCandidate([terrain,piste]),piste);
});

test('a distant lower surface is not snapped to while the skier is still grounded',()=>{
  const distantTerrain=candidate('Terrain',90);
  assert.equal(selectGroundContactCandidate([distantTerrain],{
    referenceY:102,maxVerticalDelta:6
  }),null);
  assert.equal(selectGroundContactCandidate([distantTerrain]),distantTerrain);
});

test('near-vertical wall normals are rejected as skiable ground',()=>{
  assert.equal(normalizeUpwardNormal({x:1,y:0,z:0}),null);
  assert.ok(normalizeUpwardNormal({x:0.5,y:0.866,z:0}));
  assert.ok(MIN_TERRAIN_NORMAL_Y>0.1&&MIN_TERRAIN_NORMAL_Y<0.2);
});

test('ground normal changes are rate-limited and remain finite and normalized',()=>{
  const current={x:0,y:1,z:0};
  const target={x:0.7,y:0.714142842,z:0};
  const first=blendGroundNormal(current,target,1/60,3.6);
  const length=Math.hypot(first.x,first.y,first.z);
  assert.ok(Math.abs(length-1)<1e-9);
  assert.ok(first.y>0.99);
  const fullyBlended=blendGroundNormal(first,target,2,3.6);
  assert.ok(Math.abs(Math.hypot(fullyBlended.x,fullyBlended.y,fullyBlended.z)-1)<1e-9);
  assert.ok(fullyBlended.x>0.69);
});
