import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_PLAYERS,MAX_IDLE_MS,MAX_MESSAGE_CHARS,MAX_MESSAGES_PER_SECOND,normalizeState,sanitizeName} from '../src/protocol.js';

test('the shared resort is a single two-person session',()=>{
  assert.equal(MAX_PLAYERS,2);
  assert.equal(MAX_IDLE_MS,30000);
  assert.equal(MAX_MESSAGE_CHARS,4096);
  assert.equal(MAX_MESSAGES_PER_SECOND,12);
});
test('display names are bounded and sanitized',()=>{
  assert.equal(sanitizeName('  Павел  '),'Павел');
  assert.equal(sanitizeName('<b>Client</b>'),'bClient/b');
  assert.equal(Array.from(sanitizeName('Л'.repeat(60))).length,20);
  assert.equal(sanitizeName(''),'Лыжник');
});
test('skier transforms and 12 articulated joints are preserved',()=>{
  const pose=new Array(72).fill(0);pose[4]=-0.22;
  const state=normalizeState({mode:'skier',p:[120,35,-480],q:[0,0.70710678,0,0.70710678],v:[12,1.1,-3],pose});
  assert.ok(state);assert.equal(state.mode,'skier');assert.equal(state.p[0],120);
  assert.ok(Math.abs(Math.hypot(...state.q)-1)<1e-6);assert.equal(state.pose.length,72);
});
test('drone and overview transforms do not require skier pose',()=>{
  for(const mode of ['drone','overview']){
    const state=normalizeState({mode,p:[0,20,0],q:[0,0,0,1],v:[0,0,0]});
    assert.equal(state.mode,mode);assert.deepEqual(state.pose,[]);
  }
});
test('malformed and non-finite transforms are rejected',()=>{
  assert.equal(normalizeState({mode:'unknown',p:[0,0,0],q:[0,0,0,1],v:[0,0,0]}),null);
  assert.equal(normalizeState({mode:'skier',p:[0,0],q:[0,0,0,1],v:[0,0,0]}),null);
  assert.equal(normalizeState({mode:'drone',p:[0,0,0],q:[0,0,0,0],v:[0,0,0]}),null);
  assert.equal(normalizeState({mode:'drone',p:[Infinity,0,0],q:[0,0,0,1],v:[0,0,0]}),null);
  assert.equal(normalizeState({mode:'skier',p:[0,0,0],q:[0,0,0,1],v:[0,0,0],pose:[0,1]}),null);
});
