import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCustomSpawnRunout } from '../skier-terrain-contact.v2.js';

const normalForDownhillZ = {x:0,y:Math.cos(Math.PI/6),z:Math.sin(Math.PI/6)};

test('custom spawn accepts a 3m clear run along its saved heading',()=>{
  const checked=[];
  const result=evaluateCustomSpawnRunout({
    x:10,z:20,headingYaw:Math.PI,normal:normalForDownhillZ,
    hasGroundAt:(x,z)=>{checked.push([x,z]);return z<=23.1; }
  });
  assert.equal(result.usable,true);
  assert.equal(result.clearance,3);
  assert.equal(result.direction,'heading');
  assert.equal(checked.length,3);
});

test('custom spawn falls back to the gravity direction when the authored facing line has no ground',()=>{
  const result=evaluateCustomSpawnRunout({
    x:0,z:0,headingYaw:0,normal:normalForDownhillZ,
    hasGroundAt:(x,z)=>x===0&&z>0&&z<=3.1
  });
  assert.equal(result.usable,true);
  assert.equal(result.clearance,3);
  assert.equal(result.direction,'downhill');
});

test('custom spawn is rejected when neither direction has a 3m run-out',()=>{
  const result=evaluateCustomSpawnRunout({
    x:0,z:0,headingYaw:Math.PI,normal:normalForDownhillZ,
    hasGroundAt:()=>false
  });
  assert.equal(result.usable,false);
  assert.equal(result.clearance,0);
  assert.equal(result.reason,'no-runout');
});
