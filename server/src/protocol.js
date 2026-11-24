export const MAX_PLAYERS = 4;
export const MAX_IDLE_MS = 60000;
export const MAX_MESSAGE_CHARS = 4096;
export const MAX_MESSAGES_PER_SECOND = 45;
export const MAX_MESSAGE_RATE = MAX_MESSAGES_PER_SECOND;
export const JOINT_FLOATS = 72;
export const MAX_SHARED_MARKERS = 50;
export const MAX_MARKERS_PER_PLAYER = 3;

export function sanitizeClientId(value) {
  const id=String(value??'').trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)?id:'';
}

export function sanitizeName(value) {
  const clean=Array.from(String(value??'').replace(/[\u0000-\u001f\u007f<>&"']/g,'').trim()).slice(0,20).join('');
  return clean||'Лыжник';
}

function finiteArray(value,length,maxAbs) {
  if(!Array.isArray(value)||value.length!==length)return null;
  const result=value.map(Number);
  return result.every(number=>Number.isFinite(number)&&Math.abs(number)<=maxAbs)?result:null;
}


export function normalizeMarker(input, owner, ownerId) {
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
  const id=sanitizeClientId(input.id);
  const cleanOwnerId=sanitizeClientId(ownerId);
  const p=finiteArray(input.p,3,50000);
  if(!id||!cleanOwnerId||!p)return null;
  return {id,owner:sanitizeName(owner),ownerId:cleanOwnerId,p,createdAt:Date.now()};
}

export function pruneSharedMarkers(inputMarkers) {
  const markers=Array.isArray(inputMarkers)?inputMarkers.slice():[];
  for(const existing of markers){
    if(existing&&!existing.ownerId)existing.ownerId='legacy:'+sanitizeName(existing.owner);
  }
  const removedMarkers=[];
  const ownerIds=new Set(markers.map(existing=>existing?.ownerId).filter(Boolean));
  for(const ownerId of ownerIds){
    const ownedMarkers=markers.filter(existing=>existing?.ownerId===ownerId);
    while(ownedMarkers.length>MAX_MARKERS_PER_PLAYER){
      const oldest=ownedMarkers.shift();
      const index=markers.findIndex(existing=>existing?.id===oldest?.id);
      if(index>=0)removedMarkers.push(markers.splice(index,1)[0]);
    }
  }
  while(markers.length>MAX_SHARED_MARKERS)removedMarkers.push(markers.shift());
  return {markers,removedMarkers};
}

export function appendSharedMarker(inputMarkers, marker) {
  const markers=Array.isArray(inputMarkers)?inputMarkers.slice():[];
  for(const existing of markers){
    if(existing&&!existing.ownerId)existing.ownerId='legacy:'+sanitizeName(existing.owner);
  }
  const legacyOwnerId='legacy:'+sanitizeName(marker.owner);
  for(const existing of markers){
    if(existing?.ownerId===legacyOwnerId)existing.ownerId=marker.ownerId;
  }
  const acceptedExisting=markers.find(existing=>existing?.id===marker.id);
  if(acceptedExisting){
    const update=pruneSharedMarkers(markers);
    return {...update,acceptedMarker:acceptedExisting};
  }
  markers.push(marker);
  const update=pruneSharedMarkers(markers);
  return {...update,acceptedMarker:marker};
}

export function syncSharedMarkers(inputMarkers, inputDesiredMarkers, owner, ownerId) {
  const cleanOwnerId=sanitizeClientId(ownerId);
  const current=Array.isArray(inputMarkers)?inputMarkers.slice():[];
  if(!cleanOwnerId)return {markers:current,addedMarkers:[],removedMarkers:[]};
  for(const existing of current){
    if(existing&&!existing.ownerId)existing.ownerId='legacy:'+sanitizeName(existing.owner);
  }
  const desired=[],seen=new Set();
  const candidates=Array.isArray(inputDesiredMarkers)?inputDesiredMarkers:[];
  for(const input of candidates){
    const marker=normalizeMarker(input,owner,cleanOwnerId);
    if(!marker||seen.has(marker.id))continue;
    seen.add(marker.id);
    desired.push(marker);
  }
  const limitedDesired=desired.slice(-MAX_MARKERS_PER_PLAYER);
  const otherOwners=current.filter(marker=>marker?.ownerId!==cleanOwnerId);
  const update=pruneSharedMarkers([...otherOwners,...limitedDesired]);
  const retainedIds=new Set(update.markers.map(marker=>marker?.id).filter(Boolean));
  const removedMarkers=current.filter(marker=>marker?.id&&!retainedIds.has(marker.id));
  const addedMarkers=update.markers.filter(marker=>marker?.ownerId===cleanOwnerId);
  return {markers:update.markers,addedMarkers,removedMarkers};
}

export function normalizeMeasurement(input, owner, ownerId) {
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
  const id=sanitizeClientId(input.id);
  const cleanOwnerId=sanitizeClientId(ownerId);
  if(!id||!cleanOwnerId||!Array.isArray(input.points)||![1,2].includes(input.points.length))return null;
  const points=input.points.map(point=>finiteArray(point,3,50000));
  if(points.some(point=>!point))return null;
  return {id,owner:sanitizeName(owner),ownerId:cleanOwnerId,points,updatedAt:Date.now()};
}

export function normalizeState(input) {
  if(!input||typeof input!=='object'||Array.isArray(input)||!['overview','skier','drone'].includes(input.mode))return null;
  const p=finiteArray(input.p,3,50000),q=finiteArray(input.q,4,2),v=finiteArray(input.v,3,180);
  if(!p||!q||!v)return null;
  const length=Math.hypot(...q);
  if(length<0.5||length>1.5)return null;
  const rawPose=input.pose===undefined?[]:input.pose;
  if(!Array.isArray(rawPose)||(rawPose.length!==0&&rawPose.length!==JOINT_FLOATS))return null;
  const pose=rawPose.map(Number);
  if(!pose.every(number=>Number.isFinite(number)&&Math.abs(number)<=8))return null;
  return {mode:input.mode,p,q:q.map(number=>number/length),v,pose};
}
