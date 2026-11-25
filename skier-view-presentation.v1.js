/**
 * Keep skier first-person camera FOV 25% wider than the scene camera.
 * Blend back to the unmodified scene FOV when moving into third-person view.
 */
export function resolveSkierViewFov(baseFov, viewBlend = 0, firstPersonScale = 1.25) {
  const base = Number(baseFov);
  const scale = Number(firstPersonScale);
  const blendValue = Number(viewBlend);
  if (!Number.isFinite(base) || base <= 0 ||
      !Number.isFinite(scale) || scale <= 0) return null;
  const blend = Number.isFinite(blendValue)
    ? Math.min(1, Math.max(0, blendValue))
    : 0;
  const fov = base * (1 + (scale - 1) * (1 - blend));
  return Math.min(170, Math.max(1, fov));
}
