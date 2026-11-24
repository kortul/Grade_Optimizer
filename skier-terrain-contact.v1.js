export const MIN_TERRAIN_NORMAL_Y = 0.12;
export const MIN_SMOOTH_NORMAL_ALIGNMENT = 0.55;

export function normalizeUpwardNormal(normal, minimumUp = MIN_TERRAIN_NORMAL_Y) {
  if (!normal) return null;
  let x = Number(normal.x), y = Number(normal.y), z = Number(normal.z);
  if (![x,y,z].every(Number.isFinite)) return null;
  const length = Math.hypot(x,y,z);
  if (length < 1e-8) return null;
  x /= length; y /= length; z /= length;
  if (y < 0) { x = -x; y = -y; z = -z; }
  if (y < minimumUp) return null;
  return {x,y,z};
}

export function selectGroundContactCandidate(
  candidates,
  {referenceY = null, maxVerticalDelta = Infinity, referenceNormal = null} = {}
) {
  const hasReference = referenceY !== null && referenceY !== undefined && Number.isFinite(Number(referenceY));
  const preferred = hasReference ? normalizeUpwardNormal(referenceNormal, 0.01) : null;
  const maximumDelta = Number.isFinite(Number(maxVerticalDelta))
    ? Math.max(0, Number(maxVerticalDelta))
    : Infinity;
  let best = null;
  let bestScore = Infinity;
  let bestY = -Infinity;

  for (const candidate of candidates || []) {
    const y = Number(candidate?.point?.y);
    const normal = normalizeUpwardNormal(candidate?.normal);
    if (!Number.isFinite(y) || !normal) continue;

    if (!hasReference) {
      if (y > bestY) { best = candidate; bestY = y; }
      continue;
    }

    const heightDelta = Math.abs(y - Number(referenceY));
    if (heightDelta > maximumDelta) continue;
    const normalDot = preferred
      ? Math.max(-1, Math.min(1, normal.x*preferred.x + normal.y*preferred.y + normal.z*preferred.z))
      : 1;
    const score = heightDelta + (1-normalDot)*0.15;
    if (score < bestScore-1e-7 || (Math.abs(score-bestScore)<=1e-7 && y>bestY)) {
      best = candidate;
      bestScore = score;
      bestY = y;
    }
  }
  return best;
}

export function blendGroundNormal(current, target, dt, maxTurnRate = 3.6) {
  const from = normalizeUpwardNormal(current, 0.01) || {x:0,y:1,z:0};
  const to = normalizeUpwardNormal(target, MIN_TERRAIN_NORMAL_Y);
  if (!to) return from;

  const dot = Math.max(-1, Math.min(1, from.x*to.x + from.y*to.y + from.z*to.z));
  const angle = Math.acos(dot);
  const maxStep = Math.max(0, Number(dt)||0) * Math.max(0.1, Number(maxTurnRate)||3.6);
  const amount = angle <= 1e-8 ? 1 : Math.min(1, maxStep/angle);
  return normalizeUpwardNormal({
    x: from.x + (to.x-from.x)*amount,
    y: from.y + (to.y-from.y)*amount,
    z: from.z + (to.z-from.z)*amount
  }, 0.01) || from;
}
