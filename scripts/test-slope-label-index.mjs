import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSlopeAngleSpatialIndex, forEachSlopeAngleSpatialCandidate } from '../slope-label-index.v1.js';

test('spatial index preserves negative and positive world coordinates',()=>{
  const records=[{id:'west',x:-15,z:-20},{id:'center',x:15,z:20},{id:'east',x:225,z:20},{id:'far',x:1200,z:900}];
  const index=buildSlopeAngleSpatialIndex(records,100);
  assert.equal(index.recordCount,4);
  assert.equal(index.cells.size,4);
  const found=[];
  forEachSlopeAngleSpatialCandidate(index,0,0,100,record=>found.push(record.id));
  assert.deepEqual(found.sort(),['center','west']);
});

test('broad phase includes every in-radius point across cell boundaries',()=>{
  const records=[{id:'a',x:95,z:0},{id:'b',x:105,z:0},{id:'c',x:-5,z:0},{id:'d',x:310,z:0}];
  const index=buildSlopeAngleSpatialIndex(records,100);
  const candidates=new Set();
  forEachSlopeAngleSpatialCandidate(index,100,0,120,record=>candidates.add(record.id));
  assert.ok(candidates.has('a'));
  assert.ok(candidates.has('b'));
  assert.ok(candidates.has('c'));
  assert.ok(!candidates.has('d'));
});

test('invalid cell sizes fall back and non-finite records are ignored',()=>{
  const index=buildSlopeAngleSpatialIndex([{id:'valid',x:1,z:2},{id:'bad',x:NaN,z:2},{id:'missing',z:3}],0);
  assert.equal(index.cellSize,200);
  assert.equal(index.recordCount,1);
});
