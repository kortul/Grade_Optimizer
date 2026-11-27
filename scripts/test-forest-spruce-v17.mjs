import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../webgpu-forest-lab.v17.js',import.meta.url),'utf8');
const standalone=readFileSync(new URL('../webgpu-forest-lab-v17.html',import.meta.url),'utf8');
const main=readFileSync(new URL('../webgpu-forest-lab.html',import.meta.url),'utf8');

const start=source.indexOf('function createSplinePineGeometry(lod,variant){');
const end=source.indexOf('function createPineBacklightNode(){',start);
assert.ok(start>=0&&end>start,'V17 spruce generator must exist');
const geometry=source.slice(start,end);
assert.match(geometry,/levels:28,branches:8,width:1\.02/);
assert.match(geometry,/levels:30,branches:7,width:0\.86/);
assert.match(geometry,/const twigStations=high\?5:mid\?3:2/);
assert.match(geometry,/const twigClusters=high\?2:mid\?2:1/);
assert.match(geometry,/const cardCount=high\?3:mid\?2:1/);
assert.match(geometry,/const armCount=high\?\(stationRand\(\)<0\.38\?2:1\):1/);
assert.match(geometry,/\(armRand\(\)-0\.60\)\*0\.46/);
assert.match(geometry,/armRand\(\)<0\.25/);
assert.match(geometry,/tip\.y-=twigLength\*\(0\.07\+armRand\(\)\*0\.16\)/);
assert.match(geometry,/geometry\.addGroup\(0,woodIndices\.length,0\)/);
assert.match(geometry,/geometry\.addGroup\(woodIndices\.length,foliageIndices\.length,1\)/);
assert.match(source,/return \[wood,foliage\]/);
assert.match(source,/new THREE\.InstancedMesh\(geometry,material,trees\.length\)/);
assert.match(standalone,/webgpu-forest-lab\.v17\.js\?v=20261126e/);
assert.match(main,/webgpu-forest-lab\\.v19\\.js\\?v=20261127b/);
console.log('Forest Spruce V17 denser whorls, hanging branchlets, layered foliage and page activation passed.');
