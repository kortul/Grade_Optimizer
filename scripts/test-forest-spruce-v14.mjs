import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../webgpu-forest-lab.v14.js', import.meta.url), 'utf8');
const atmosphere = readFileSync(new URL('../webgpu-forest-atmosphere.v3.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../webgpu-forest-lab-v14.html', import.meta.url), 'utf8');

const start = source.indexOf('function createSplinePineGeometry(lod,variant){');
const end = source.indexOf('function createPineBacklightNode(){', start);
assert.ok(start >= 0 && end > start, 'V14 spruce geometry generator must exist');
const generator = source.slice(start, end);

assert.match(generator, /levels:24/);
assert.match(generator, /levels:26/);
assert.match(generator, /levels:22/);
assert.match(generator, /const needleCount=high\?20:mid\?12:6/);
assert.match(generator, /const twigStations=high\?6:mid\?4:2/);
assert.match(generator, /const radiusSide=size\*0\.34,radiusUp=size\*0\.29,radiusAlong=size\*0\.18/);
assert.match(generator, /needleLength\*\(0\.048\+rng\(\)\*0\.028\)/);
assert.match(generator, /const primaryClumps=high\?4:mid\?3:2/);
assert.match(generator, /new THREE\.QuadraticBezierCurve3/);
assert.match(generator, /const gapWeights=Array\.from/);
assert.match(source, /new THREE\.WebGPURenderer\(\{ antialias: true/);
assert.match(source, /function selectTreeLod\(distance,current\)/);
assert.match(source, /current==='near'&&distance>=115&&distance<300/);
assert.match(source, /const cellSize=300/);
assert.doesNotMatch(source, /cameraTurned/);
assert.doesNotMatch(source, /lastForward\.dot/);
assert.match(source, /const previousGroup=forestSystem\.group/);
assert.match(atmosphere, /balanced:1\.0/);
assert.match(atmosphere, /Math\.max\(0\.85,qualityScale\*dynamicResolutionScale\)/);
assert.match(page, /webgpu-forest-lab\.v14\.js/);

console.log('Forest Spruce V14 structural checks passed.');
