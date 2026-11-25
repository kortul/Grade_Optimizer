import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRenderVolumetricClouds, VOLUMETRIC_CLOUD_MIN_COVERAGE } from '../weather-system.v8.js';

test('light and partly cloudy presets stay on the atlas fallback', () => {
  assert.equal(VOLUMETRIC_CLOUD_MIN_COVERAGE, 0.38);
  assert.equal(shouldRenderVolumetricClouds(0.00, true), false);
  assert.equal(shouldRenderVolumetricClouds(0.18, true), false);
  assert.equal(shouldRenderVolumetricClouds(0.34, true), false);
});

test('medium and heavy cloud coverage can use volumetric rendering', () => {
  assert.equal(shouldRenderVolumetricClouds(0.38, true), true);
  assert.equal(shouldRenderVolumetricClouds(0.66, true), true);
  assert.equal(shouldRenderVolumetricClouds(0.96, true), true);
});

test('explicitly disabled volumetrics and invalid coverage never activate the cloud volume', () => {
  assert.equal(shouldRenderVolumetricClouds(0.96, false), false);
  assert.equal(shouldRenderVolumetricClouds(Number.NaN, true), false);
  assert.equal(shouldRenderVolumetricClouds(undefined, true), false);
});

import { resolveRendererPixelRatio, calculateRollingFps } from '../render-performance.v1.js';

test('viewport resizes preserve the active skier resolution cap', () => {
  assert.equal(resolveRendererPixelRatio(2), 2);
  assert.equal(resolveRendererPixelRatio(2, { performanceProfileActive: true }), 0.9);
  assert.equal(resolveRendererPixelRatio(1.25, { performanceProfileActive: true }), 0.9);
  assert.equal(resolveRendererPixelRatio(0.75, { performanceProfileActive: true }), 0.75);
  assert.equal(resolveRendererPixelRatio(3, { maxPixelRatio: 1.5 }), 1.5);
});

test('rolling FPS uses real animation-frame intervals rather than a stale completed window', () => {
  assert.equal(calculateRollingFps([16.6667,16.6667,16.6667,16.6667]), 0);
  assert.ok(Math.abs(calculateRollingFps([16.6667,16.6667,16.6667,16.6667,16.6667])-60)<0.01);
  assert.equal(calculateRollingFps([20,20,20,20,20]), 50);
  assert.equal(calculateRollingFps([200,200,200,200,200]), 5);
  assert.equal(calculateRollingFps([0,NaN,-1,1000,16,16,16,16,16]), 62.5);
});
