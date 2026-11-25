import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSkierViewFov } from '../skier-view-presentation.v1.js';

test('first-person FOV is exactly 31.25 percent wider than the scene FOV',()=>{
  assert.equal(resolveSkierViewFov(55,0,1.3125),72.1875);
  assert.equal(resolveSkierViewFov(60,0,1.3125),78.75);
});

test('third-person returns to the scene FOV and transition blends smoothly',()=>{
  assert.equal(resolveSkierViewFov(55,1,1.3125),55);
  assert.equal(resolveSkierViewFov(55,0.5,1.3125),63.59375);
});

test('invalid FOV inputs never produce a camera projection value',()=>{
  assert.equal(resolveSkierViewFov(0,0,1.3125),null);
  assert.equal(resolveSkierViewFov(NaN,0,1.3125),null);
});
