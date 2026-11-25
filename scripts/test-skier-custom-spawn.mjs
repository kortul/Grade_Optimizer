import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCustomSpawnRunout } from '../skier-terrain-contact.v3.js';

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

import { isCustomSpawnSlopeAllowed } from '../skier-terrain-contact.v3.js';

test('custom spawn accepts flat and almost-flat staging surfaces',()=>{
  for(const slope of [0,0.1,0.5,1,3.99,4,55]){
    assert.equal(isCustomSpawnSlopeAllowed(slope),true,'expected '+slope+' degrees to be allowed');
  }
});

test('custom spawn still rejects slopes above 55 degrees and invalid values',()=>{
  for(const slope of [55.01,60,90,-0.01,NaN,Infinity]){
    assert.equal(isCustomSpawnSlopeAllowed(slope),false,'expected '+slope+' degrees to be rejected');
  }
});
