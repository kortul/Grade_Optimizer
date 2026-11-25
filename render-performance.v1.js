export function resolveRendererPixelRatio(devicePixelRatio, { performanceProfileActive = false, maxPixelRatio = 2, performancePixelRatio = 0.9 } = {}) {
  const requested = Number(devicePixelRatio);
  const safeDpr = Number.isFinite(requested) && requested > 0 ? requested : 1;
  const maximum = Number.isFinite(Number(maxPixelRatio)) && Number(maxPixelRatio) > 0 ? Number(maxPixelRatio) : 2;
  const profileMaximum = Number.isFinite(Number(performancePixelRatio)) && Number(performancePixelRatio) > 0 ? Number(performancePixelRatio) : 0.9;
  return Math.min(safeDpr, maximum, performanceProfileActive ? profileMaximum : maximum);
}

export function calculateRollingFps(frameIntervalsMs) {
  if (!Array.isArray(frameIntervalsMs) || frameIntervalsMs.length < 5) return 0;
  let total = 0;
  let count = 0;
  for (const interval of frameIntervalsMs) {
    const value = Number(interval);
    if (!Number.isFinite(value) || value <= 0 || value >= 1000) continue;
    total += value;
    count++;
  }
  return count < 5 ? 0 : 1000 / (total / count);
}
