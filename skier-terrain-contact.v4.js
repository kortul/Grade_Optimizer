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


/**
 * Validate a manually authored spawn by checking a short, real ground run-out.
 * The clicked heading is tested first; if it has no run-out, the gravity-
 * projected downhill direction is checked as a safe fallback.
 */
export function evaluateCustomSpawnRunout({
  x,
  z,
  headingYaw,
  normal,
  hasGroundAt,
  distances = [1.5, 3, 4.5],
  minimumClearance = 3
} = {}) {
  const originX = Number(x), originZ = Number(z), yaw = Number(headingYaw);
  if (!Number.isFinite(originX) || !Number.isFinite(originZ) ||
      !Number.isFinite(yaw) || typeof hasGroundAt !== 'function') {
    return { usable: false, clearance: 0, direction: null, reason: 'invalid-input' };
  }
  const up = normalizeUpwardNormal(normal, 0.01);
  if (!up) return { usable: false, clearance: 0, direction: null, reason: 'invalid-normal' };

  const forward = { x: -Math.sin(yaw), z: -Math.cos(yaw), kind: 'heading' };
  const downhill = { x: up.x * up.y, z: up.z * up.y, kind: 'downhill' };
  const candidates = [forward, downhill].filter(direction =>
    Number.isFinite(direction.x) && Number.isFinite(direction.z) &&
    Math.hypot(direction.x, direction.z) > 1e-6
  );
  const tested = new Set();
  let best = { usable: false, clearance: 0, direction: null, reason: 'no-runout' };

  for (const candidate of candidates) {
    const length = Math.hypot(candidate.x, candidate.z);
    const direction = { x: candidate.x / length, z: candidate.z / length };
    const signature = Math.round(direction.x * 1000) + ':' + Math.round(direction.z * 1000);
    if (tested.has(signature)) continue;
    tested.add(signature);

    let clearance = 0;
    for (const rawDistance of distances) {
      const distance = Number(rawDistance);
      if (!Number.isFinite(distance) || distance <= clearance) continue;
      let hasGround = false;
      try {
        hasGround = !!hasGroundAt(originX + direction.x * distance, originZ + direction.z * distance);
      } catch {
        hasGround = false;
      }
      if (!hasGround) break;
      clearance = distance;
    }
    if (clearance > best.clearance) {
      best = { usable: clearance >= minimumClearance, clearance, direction: candidate.kind, reason: clearance >= minimumClearance ? null : 'short-runout' };
    }
    if (best.usable) return best;
  }
  return best;
}


/**
 * Custom Scene Editor points may be placed on flat run-outs / staging areas.
 * A zero-degree slope is valid; only reject non-finite, negative or over-limit
 * surface angles. A separately checked ground run-out prevents edge spawns.
 */
export function isCustomSpawnSlopeAllowed(slopeDeg, maximumSlopeDeg = 55) {
  const slope = Number(slopeDeg);
  const maximum = Number(maximumSlopeDeg);
  return Number.isFinite(slope) && Number.isFinite(maximum) &&
    slope >= 0 && maximum >= 0 && slope <= maximum;
}


/**
 * Physics uses the actual geometric face normal on every collision mesh.
 * Artist-authored vertex normals are for shading and can differ between a
 * terrain mesh and a piste mesh, changing effective gravity and glide.
 */
export function resolvePhysicsContactNormal(faceNormal) {
  return normalizeUpwardNormal(faceNormal);
}
