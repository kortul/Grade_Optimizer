import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectH3SafetyFenceCurves } from '../safety-fences.v2.js';

const manifest = JSON.parse(readFileSync('clients/alpine-resort/scene.json', 'utf8'));
const curves = manifest?.slopeCurves?.curves;
assert.ok(Array.isArray(curves), 'scene.json must contain slopeCurves.curves');

const selected = selectH3SafetyFenceCurves(curves);
const describe = curve => {
  const points = (Array.isArray(curve.points) ? curve.points : []).filter(point =>
    Array.isArray(point) && point.length >= 3 &&
    point.slice(0, 3).every(value => Number.isFinite(Number(value)))
  );
  const bounds = points.reduce((box, point) => {
    for (let axis = 0; axis < 3; axis++) {
      const value = Number(point[axis]);
      box.min[axis] = Math.min(box.min[axis], value);
      box.max[axis] = Math.max(box.max[axis], value);
    }
    return box;
  }, { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
  let length3d = 0;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index];
    length3d += Math.hypot(
      Number(b[0]) - Number(a[0]),
      Number(b[1]) - Number(a[1]),
      Number(b[2]) - Number(a[2])
    );
  }
  return {
    id: curve.id || null,
    name: curve.name || null,
    sourcePath: curve.sourcePath || null,
    queue: curve.queue || null,
    sourceDigest: curve.sourceDigest || null,
    pointCount: points.length,
    length3dMeters: Number(length3d.toFixed(2)),
    bounds: points.length ? {
      min: bounds.min.map(value => Number(value.toFixed(2))),
      max: bounds.max.map(value => Number(value.toFixed(2)))
    } : null
  };
};

console.log('[H3 safety fence manifest audit]', JSON.stringify({
  coordinateSystem: manifest.slopeCurves.coordinateSystem,
  worldFrame: manifest.slopeCurves.worldFrame,
  units: manifest.slopeCurves.units,
  curveCount: curves.length,
  h3Matches: selected.map(describe)
}, null, 2));

assert.ok(selected.length > 0, 'H3 centerline must be present in scene.json');
assert.ok(selected.every(curve => Array.isArray(curve.points) && curve.points.length >= 2),
  'every selected H3 curve must contain sampled centerline points');
