import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_PLAYERS,MAX_IDLE_MS,MAX_MESSAGE_CHARS,MAX_MESSAGES_PER_SECOND,MAX_MARKERS_PER_PLAYER,MAX_SHARED_MARKERS,appendSharedMarker,normalizeMarker,normalizeState,sanitizeClientId,sanitizeName} from '../src/protocol.js';

test('the shared resort is a single four-person session',()=>{
  assert.equal(MAX_PLAYERS,4);
  assert.equal(MAX_IDLE_MS,60000);
  assert.equal(MAX_MESSAGE_CHARS,4096);
  assert.equal(MAX_MESSAGES_PER_SECOND,45);
});
test('multiplayer session IDs accept UUIDs only',()=>{
  assert.equal(sanitizeClientId('550e8400-e29b-41d4-a716-446655440000'),'550e8400-e29b-41d4-a716-446655440000');
  assert.equal(sanitizeClientId('not-a-session-id'),'');
  assert.equal(sanitizeClientId('<script>'),'');
});

test('shared overview flags validate UUIDs, positions, owner identity and per-player cap',()=>{
  assert.equal(MAX_SHARED_MARKERS,50);
  assert.equal(MAX_MARKERS_PER_PLAYER,3);
  const ownerId='4dd69fea-b96d-42c4-9c4b-2ca5e8a50d90';
  const marker=normalizeMarker({
    id:'550e8400-e29b-41d4-a716-446655440000',
    p:[125.5,42,-810]
  },'  Pavel  ',ownerId);
  assert.ok(marker);
  assert.equal(marker.id,'550e8400-e29b-41d4-a716-446655440000');
  assert.equal(marker.owner,'Pavel');
  assert.equal(marker.ownerId,ownerId);
  assert.deepEqual(marker.p,[125.5,42,-810]);
  assert.equal(normalizeMarker({id:'bad-id',p:[0,0,0]},'Pavel',ownerId),null);
  assert.equal(normalizeMarker({id:'550e8400-e29b-41d4-a716-446655440000',p:[Infinity,0,0]},'Pavel',ownerId),null);
  assert.equal(normalizeMarker({id:'550e8400-e29b-41d4-a716-446655440000',p:[50001,0,0]},'Pavel',ownerId),null);
  assert.equal(normalizeMarker({id:'550e8400-e29b-41d4-a716-446655440000',p:[0,0,0]},'Pavel','invalid-owner'),null);
});

test('each participant keeps only their three newest shared flags',()=>{
  const ownerA='4dd69fea-b96d-42c4-9c4b-2ca5e8a50d90';
  const ownerB='54395181-3418-4593-af6c-1bd9f4a2173c';
  const make=(suffix,owner,name)=>normalizeMarker({
    id:'550e8400-e29b-41d4-a716-'+suffix,
    p:[Number(suffix.slice(-1)),0,0]
  },name,owner);
  let markers=[];
  for(const suffix of ['000001','000002','000003','000004']){
    const result=appendSharedMarker(markers,make(suffix,ownerA,'Pavel'));
    markers=result.markers;
    if(suffix==='000004')assert.deepEqual(result.removedMarkers.map(item=>item.id),['550e8400-e29b-41d4-a716-000001']);
  }
  assert.deepEqual(markers.filter(item=>item.ownerId===ownerA).map(item=>item.id),[
    '550e8400-e29b-41d4-a716-000002',
    '550e8400-e29b-41d4-a716-000003',
    '550e8400-e29b-41d4-a716-000004'
  ]);
  for(const suffix of ['000005','000006','000007','000008']){
    const result=appendSharedMarker(markers,make(suffix,ownerB,'Skier B'));
    markers=result.markers;
    if(suffix==='000008')assert.deepEqual(result.removedMarkers.map(item=>item.id),['550e8400-e29b-41d4-a716-000005']);
  }
  assert.equal(markers.filter(item=>item.ownerId===ownerA).length,3);
  assert.equal(markers.filter(item=>item.ownerId===ownerB).length,3);
});

test('legacy flags are migrated and counted against the three-flag limit',()=>{
  const ownerId='4dd69fea-b96d-42c4-9c4b-2ca5e8a50d90';
  const legacy=['000001','000002','000003'].map((suffix,index)=>({
    id:'550e8400-e29b-41d4-a716-'+suffix,owner:'Pavel',p:[index,0,0],createdAt:index+1
  }));
  const next=normalizeMarker({id:'550e8400-e29b-41d4-a716-000004',p:[4,0,0]},'Pavel',ownerId);
  const result=appendSharedMarker(legacy,next);
  assert.deepEqual(result.removedMarkers.map(item=>item.id),['550e8400-e29b-41d4-a716-000001']);
  assert.equal(result.markers.length,3);
  assert.ok(result.markers.every(item=>item.ownerId===ownerId));
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
