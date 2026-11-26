import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const renderer=readFileSync(new URL('../webgpu-forest-lab.v12.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../webgpu-forest-lab.html',import.meta.url),'utf8');
const atmosphere=readFileSync(new URL('../webgpu-forest-atmosphere.v2.js',import.meta.url),'utf8');

assert.match(renderer,/shareStageOneMaterialsByKind\(root,\{defaultKind:'slopes'\}\)/,'Stage 1 semantic groups must still be recognised');
assert.match(renderer,/object\.material\.map\(\(\)=>snowMaterial\)/,'winter material replacement must remain intact');
assert.match(renderer,/new THREE\.WebGPURenderer\(\{ antialias: false, powerPreference: 'high-performance' \}\)/,'V12 must initialize WebGPURenderer without MSAA');
assert.match(renderer,/renderer\.backend\.isWebGPUBackend === true/,'the visible label must identify the actual WebGPU backend or WebGL fallback');
assert.match(renderer,/name:'Norway'[\s\S]*name:'Alpine'[\s\S]*name:'Broad'/,'V12 must provide three genuinely different spruce morphologies');
assert.match(renderer,/levels:10,branches:7,width:1\.02/,'Norway spruce must have a full classic silhouette');
assert.match(renderer,/levels:11,branches:6,width:0\.84/,'Alpine spruce must be tall and narrow');
assert.match(renderer,/levels:9,branches:8,width:1\.18/,'Broad spruce must have a mature wide silhouette');
assert.match(renderer,/sizeClass<0\.38\?6\.5\+rr\(\)\*5\.5:sizeClass<0\.84\?11\+rr\(\)\*6:17\+rr\(\)\*6/,'trees must use small, medium and large size bands');
assert.match(renderer,/const needleCount=10/,'needle tufts must contain ten blades');
assert.match(renderer,/length\*\(0\.125\+hash\(seed\+7,i\)\*0\.035\)/,'needle blades must overlap more densely');
assert.match(renderer,/const cellSize=520/,'forest instances must remain split into spatial cells');
assert.match(renderer,/distanceSq<140\*140/,'only trees within 140 m should enter the shadow band');
assert.match(renderer,/distanceSq<260\*260/,'detailed near LOD must end at 260 m');
assert.match(renderer,/distanceSq<950\*950/,'mid LOD must end at 950 m');
assert.match(renderer,/mesh\.computeBoundingSphere\(\);mesh\.frustumCulled=true;/,'spatial batches must use frustum culling');
assert.match(renderer,/mesh\.receiveShadow=lod==='near'/,'only near trees should receive shadows');
assert.match(renderer,/frameTimeEMA>34/,'adaptive resolution must react to sustained slow frames');
assert.match(renderer,/atmosphere\.setResolutionScale\(dynamicResolutionScale\)/,'adaptive scale must reach the renderer through the atmosphere');
assert.match(renderer,/sunLight\.shadow\.mapSize\.setScalar\(512\)/,'shadow map must be reduced to 512');
assert.match(renderer,/sunLight\.shadow\.camera\.far=2200/,'shadow distance must be reduced');
assert.match(html,/webgpu-forest-lab\.v12\.js\?v=20261126a/,'main HTML must activate V12');

assert.match(atmosphere,/function setResolutionScale\(scale\)/,'atmosphere must expose adaptive scaling');
assert.match(atmosphere,/qualityScale\*dynamicResolutionScale/,'adaptive and quality profiles must compose');
assert.match(atmosphere,/new SkyMesh\(\)/,'physical SkyMesh must remain active');
assert.match(atmosphere,/pmremGenerator\.fromScene\(environmentScene, 0\.035\)/,'PBR IBL must remain sky-derived');
assert.match(atmosphere,/renderer\.render\(scene, camera\)/,'direct renderer path must remain active');
console.log('✓ V12 WebGPU, three spruce varieties, three size classes and dense needle tufts');
console.log('✓ Adaptive resolution, shorter LOD/shadow ranges and frustum culling');
console.log('✓ Physical SkyMesh and snow PBR remain active');
