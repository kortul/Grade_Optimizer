import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_PLAYERS,MAX_IDLE_MS,MAX_MESSAGE_CHARS,MAX_MESSAGES_PER_SECOND,MAX_MARKERS_PER_PLAYER,MAX_SHARED_MARKERS,appendSharedMarker,normalizeMarker,normalizeMeasurement,normalizeState,pruneOrphanedSharedMarkers,pruneSharedMarkers,renumberSharedMarkers,sanitizeClientId,sanitizeName,syncSharedMarkers} from '../src/protocol.v2.js';

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
  assert.equal(MAX_SHARED_MARKERS,40);
  assert.equal(MAX_MARKERS_PER_PLAYER,10);
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

test('each participant keeps only their ten newest shared flags',()=>{
  const ownerA='4dd69fea-b96d-42c4-9c4b-2ca5e8a50d90';
  const ownerB='54395181-3418-4593-af6c-1bd9f4a2173c';
  const makeId=number=>'550e8400-e29b-41d4-a716-'+String(number).padStart(12,'0');
  const make=(number,owner,name)=>normalizeMarker({
    id:makeId(number),
    p:[number,0,0]
  },name,owner);
  let markers=[];
  for(const number of Array.from({length:11},(_,index)=>index+1)){
    const result=appendSharedMarker(markers,make(number,ownerA,'Pavel'));
    markers=result.markers;
    if(number===11)assert.deepEqual(result.removedMarkers.map(item=>item.id),[makeId(1)]);
  }
  assert.deepEqual(markers.filter(item=>item.ownerId===ownerA).map(item=>item.id),
    Array.from({length:10},(_,index)=>makeId(index+2))
  );
  for(const number of Array.from({length:11},(_,index)=>index+12)){
    const result=appendSharedMarker(markers,make(number,ownerB,'Skier B'));
    markers=result.markers;
    if(number===22)assert.deepEqual(result.removedMarkers.map(item=>item.id),[makeId(12)]);
  }
  assert.equal(markers.filter(item=>item.ownerId===ownerA).length,10);
  assert.equal(markers.filter(item=>item.ownerId===ownerB).length,10);
});

test('flags owned by disconnected sessions are pruned on the next join',()=>{
  const ownerA='4dd69fea-b96d-42c4-9c4b-2ca5e8a50d90';
  const ownerB='54395181-3418-4593-af6c-1bd9f4a2173c';
  const makeId=number=>'550e8400-e29b-41d4-a716-'+String(number).padStart(12,'0');
  const stored=[
    normalizeMarker({id:makeId(1),p:[1,0,0],createdAt:1},'Pavel',ownerA),
    normalizeMarker({id:makeId(2),p:[2,0,0],createdAt:2},'Visitor B',ownerB),
    {id:makeId(3),owner:'Pavel',ownerId:'legacy:Pavel',p:[3,0,0],createdAt:3},
    {id:makeId(4),owner:'Old visitor',ownerId:'legacy:Old visitor',p:[4,0,0],createdAt:4}
  ];
  const update=pruneOrphanedSharedMarkers(stored,[{id:ownerA,name:'Pavel'}]);
  assert.deepEqual(update.markers.map(marker=>marker.id),[makeId(1),makeId(3)]);
  assert.ok(update.markers.every(marker=>marker.ownerId===ownerA));
  assert.deepEqual(update.markers.map(marker=>marker.number),[1,2]);
  assert.deepEqual(update.removedMarkers.map(marker=>marker.id),[makeId(2),makeId(4)]);
  assert.deepEqual(pruneOrphanedSharedMarkers(update.markers,[]).markers,[]);
});

test('legacy flags are migrated and counted against the ten-flag limit',()=>{
  const ownerId='4dd69fea-b96d-42c4-9c4b-2ca5e8a50d90';
  const makeId=number=>'550e8400-e29b-41d4-a716-'+String(number).padStart(12,'0');
  const legacy=Array.from({length:10},(_,index)=>index+1).map((number,index)=>({
    id:makeId(number),owner:'Pavel',p:[index,0,0],createdAt:index+1
  }));
  const next=normalizeMarker({id:makeId(11),p:[11,0,0]},'Pavel',ownerId);
  const result=appendSharedMarker(legacy,next);
  assert.deepEqual(result.removedMarkers.map(item=>item.id),[makeId(1)]);
  assert.equal(result.markers.length,10);
  assert.ok(result.markers.every(item=>item.ownerId===ownerId));
});

test('legacy flags are pruned to ten on connection, before placing another flag',()=>{
  const makeId=number=>'550e8400-e29b-41d4-a716-'+String(number).padStart(12,'0');
  const legacy=Array.from({length:12},(_,index)=>index+1).map(number=>({
    id:makeId(number),owner:'Old visitor',p:[number,0,0],createdAt:number
  }));
  const result=pruneSharedMarkers(legacy);
  assert.deepEqual(result.removedMarkers.map(item=>item.id),[makeId(1),makeId(2)]);
  assert.deepEqual(result.markers.map(item=>item.id),Array.from({length:10},(_,index)=>makeId(index+3)));
  assert.ok(result.markers.every(item=>item.ownerId==='legacy:Old visitor'));
});

test('marker sync replaces only the sender set and broadcasts server-authoritative additions/removals',()=>{
  const ownerA='4dd69fea-b96d-42c4-9c4b-2ca5e8a50d90';
  const ownerB='54395181-3418-4593-af6c-1bd9f4a2173c';
  const makeId=number=>'550e8400-e29b-41d4-a716-'+String(number).padStart(12,'0');
  const make=(number,owner,name)=>normalizeMarker({id:makeId(number),p:[number,0,0]},name,owner);
  const initial=[make(1,ownerA,'Pavel'),make(2,ownerA,'Pavel'),make(3,ownerB,'Skier B')];
  const replacement=syncSharedMarkers(initial,[{id:makeId(4),p:[4,0,0]},{id:makeId(5),p:[5,0,0]}],'Pavel',ownerA);
  assert.deepEqual(replacement.markers.map(item=>item.id),[makeId(3),makeId(4),makeId(5)]);
  assert.deepEqual(replacement.removedMarkers.map(item=>item.id),[makeId(1),makeId(2)]);
  assert.deepEqual(replacement.addedMarkers.map(item=>item.id),[makeId(4),makeId(5)]);
  const cleared=syncSharedMarkers(replacement.markers,[],'Pavel',ownerA);
  assert.deepEqual(cleared.markers.map(item=>item.id),[makeId(3)]);
  assert.deepEqual(cleared.removedMarkers.map(item=>item.id),[makeId(4),makeId(5)]);
});
test('marker sync keeps newest ten flags and enforces global cap',()=>{
  const owner='4dd69fea-b96d-42c4-9c4b-2ca5e8a50d90';
  const makeId=number=>'550e8400-e29b-41d4-a716-'+String(number).padStart(12,'0');
  const makeOwnerId=number=>'40000000-0000-4000-8000-'+String(number).padStart(12,'0');
  const others=Array.from({length:MAX_SHARED_MARKERS},(_,index)=>normalizeMarker(
    {id:makeId(index+1),p:[index,0,0]},'Other '+index,makeOwnerId(index+1)
  ));
  const update=syncSharedMarkers(others,Array.from({length:12},(_,index)=>index+1).map(number=>({id:makeId(50+number),p:[number,0,0]})),'Pavel',owner);
  assert.equal(update.addedMarkers.length,10);
  assert.equal(update.markers.length,MAX_SHARED_MARKERS);
  assert.deepEqual(update.addedMarkers.map(item=>item.id),Array.from({length:10},(_,index)=>makeId(index+53)));
  assert.equal(update.removedMarkers.length,10);
});

test('shared flags receive sequential numbers independently per participant and renumber after removal',()=>{
  const ownerA='4dd69fea-b96d-42c4-9c4b-2ca5e8a50d90';
  const ownerB='54395181-3418-4593-af6c-1bd9f4a2173c';
  const makeId=number=>'550e8400-e29b-41d4-a716-'+String(number).padStart(12,'0');
  const source=[
    normalizeMarker({id:makeId(1),p:[1,0,0]},'A',ownerA),
    normalizeMarker({id:makeId(2),p:[2,0,0]},'B',ownerB),
    normalizeMarker({id:makeId(3),p:[3,0,0]},'A',ownerA),
    normalizeMarker({id:makeId(4),p:[4,0,0]},'B',ownerB),
    normalizeMarker({id:makeId(5),p:[5,0,0]},'A',ownerA)
  ];
  const numbered=renumberSharedMarkers(source);
  assert.deepEqual(numbered.map(marker=>marker.number),[1,1,2,2,3]);
  const compacted=renumberSharedMarkers(numbered.filter(marker=>marker.id!==makeId(3)));
  assert.deepEqual(compacted.map(marker=>marker.number),[1,1,2,2]);
});

test('shared ruler measurements validate one or two world-space points',()=>{
  const ownerId='4dd69fea-b96d-42c4-9c4b-2ca5e8a50d90';
  const measurement=normalizeMeasurement({
    id:'550e8400-e29b-41d4-a716-446655440000',
    points:[[125.5,42,-810],[140,51,-822]]
  },'  Pavel  ',ownerId);
  assert.ok(measurement);
  assert.equal(measurement.id,'550e8400-e29b-41d4-a716-446655440000');
  assert.equal(measurement.owner,'Pavel');
  assert.equal(measurement.ownerId,ownerId);
  assert.deepEqual(measurement.points,[[125.5,42,-810],[140,51,-822]]);
  assert.equal(normalizeMeasurement({id:'bad-id',points:[[0,0,0]]},'Pavel',ownerId),null);
  assert.equal(normalizeMeasurement({id:'550e8400-e29b-41d4-a716-446655440000',points:[]},'Pavel',ownerId),null);
  assert.equal(normalizeMeasurement({id:'550e8400-e29b-41d4-a716-446655440000',points:[[0,0,0],[1,1,1],[2,2,2]]},'Pavel',ownerId),null);
  assert.equal(normalizeMeasurement({id:'550e8400-e29b-41d4-a716-446655440000',points:[[Infinity,0,0]]},'Pavel',ownerId),null);
  assert.equal(normalizeMeasurement({id:'550e8400-e29b-41d4-a716-446655440000',points:[[50001,0,0]]},'Pavel',ownerId),null);
  assert.equal(normalizeMeasurement({id:'550e8400-e29b-41d4-a716-446655440000',points:[[0,0,0]]},'Pavel','invalid-owner'),null);
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
