import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../webgpu-forest-lab.v18.js',import.meta.url),'utf8');
const standalone=readFileSync(new URL('../webgpu-forest-lab-v18.html',import.meta.url),'utf8');
const main=readFileSync(new URL('../webgpu-forest-lab.html',import.meta.url),'utf8');

const start=source.indexOf('function createSplinePineGeometry(lod,variant){');
const end=source.indexOf('function createPineBacklightNode(){',start);
assert.ok(start>=0&&end>start,'V18 spruce generator must exist');
const geometry=source.slice(start,end);
assert.match(geometry,/const tierCount=high\?20:mid\?13:7/);
assert.match(geometry,/const goldenAngle=Math\.PI\*\(3-Math\.sqrt\(5\)\)/);
assert.match(geometry,/const secondaryCount=high\?7:mid\?4:2/);
assert.match(geometry,/const sprayCount=high\?3:mid\?2:1/);
assert.match(geometry,/const forkCount=sr\(\)<0\.24\?2:1/);
assert.match(geometry,/addTubeCurve\(tertiary/);
assert.match(geometry,/geometry\.addGroup\(0,woodIndices\.length,0\)/);
assert.match(geometry,/geometry\.addGroup\(woodIndices\.length,foliageIndices\.length,1\)/);
assert.match(source,/new THREE\.InstancedMesh\(geometry,material,trees\.length\)/);
assert.match(standalone,/webgpu-forest-lab\.v18\.js\?v=20261127a/);
assert.match(main,/webgpu-forest-lab\.v20\.js\?v=20261127c/);
console.log('Forest Spruce V18 hierarchical scaffold, phyllotactic placement, terminal needle sprays, LOD and historical V18 generator and active V20 main-page activation passed.');
