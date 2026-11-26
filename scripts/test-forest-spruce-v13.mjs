import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../webgpu-forest-lab.v13.js', import.meta.url), 'utf8');
const start = source.indexOf('function createSplinePineGeometry(lod,variant){');
const end = source.indexOf('function createPineBacklightNode(){', start);
assert.ok(start >= 0 && end > start, 'V13 spruce geometry generator must exist');
const generator = source.slice(start, end);

assert.match(generator, /levels:24/);
assert.match(generator, /levels:26/);
assert.match(generator, /levels:22/);
assert.match(generator, /new THREE\.QuadraticBezierCurve3/);
assert.match(generator, /const gapWeights=Array\.from/);
assert.match(generator, /while\(r2>1\)/);
assert.match(generator, /const needleCount=high\?14:mid\?9:5/);
assert.match(generator, /const twigStations=high\?5:mid\?3:2/);
assert.match(generator, /tertiary shoot/);
assert.doesNotMatch(generator, /branch\/branches\*Math\.PI\*2/);
assert.doesNotMatch(generator, /0\.14\+station\/Math\.max\(1,twigStations-1\)\*0\.74/);
assert.match(source, /new THREE\.InstancedMesh/);
assert.match(source, /renderer\.backend\.isWebGPUBackend === true/);

console.log('Forest Spruce V13 structural checks passed.');
