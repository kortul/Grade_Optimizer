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
