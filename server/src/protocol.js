export const MAX_PLAYERS = 4;
export const MAX_IDLE_MS = 180000;
export const MAX_MESSAGE_CHARS = 4096;
export const MAX_MESSAGES_PER_SECOND = 12;
export const MAX_MESSAGE_RATE = MAX_MESSAGES_PER_SECOND;
export const JOINT_FLOATS = 72;

export function sanitizeName(value) {
  const clean=Array.from(String(value??'').replace(/[\u0000-\u001f\u007f<>&"']/g,'').trim()).slice(0,20).join('');
  return clean||'Лыжник';
}

function finiteArray(value,length,maxAbs) {
  if(!Array.isArray(value)||value.length!==length)return null;
  const result=value.map(Number);
  return result.every(number=>Number.isFinite(number)&&Math.abs(number)<=maxAbs)?result:null;
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
