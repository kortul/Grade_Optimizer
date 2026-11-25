import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const renderer = readFileSync(new URL('../webgpu-forest-lab.v11.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../webgpu-forest-lab.html', import.meta.url), 'utf8');
const atmosphere = readFileSync(new URL('../webgpu-forest-atmosphere.v1.js', import.meta.url), 'utf8');

// Preserve the semantic stage-one material replacement and the physical look.
assert.match(renderer, /shareStageOneMaterialsByKind\(root,\{defaultKind:'slopes'\}\)/, 'Stage 1 semantic groups must still be recognised');
assert.match(renderer, /object\.material\.map\(\(\)=>snowMaterial\)/, 'semantic material identities must not leak Maya display colours into the winter look');
assert.match(renderer, /function createSplinePineMaterial\(\)/, 'procedural forest must use its physical foliage material');
assert.match(renderer, /MeshPhysicalNodeMaterial\(\{\s*roughness:0\.88/, 'foliage should retain its physical node material');

// Density comes from compact multi-needle tufts; geometry is explicitly reduced for LOD.
assert.match(renderer, /V11: dense alpine spruce foliage built from compact, volumetric needle tufts/, 'V11 dense spruce generator must be active');
assert.match(renderer, /branches=high\?6:mid\?5:4/, 'each LOD must use the V11 branch budget');
assert.match(renderer, /const twigStations=high\?3:mid\?2:1/, 'twiglet count must reduce with distance');
assert.match(renderer, /const tuftCount=high\?3:mid\?2:1/, 'near trees must receive overlapping foliage tufts');
assert.match(renderer, /const addNeedleTuft=/, 'foliage must use compact 3D needle tufts');
assert.match(renderer, /const needleCount=8/, 'each compact tuft must use multiple individually oriented needles');
assert.doesNotMatch(renderer, /addClump|SphereGeometry|IcosahedronGeometry/, 'rounded foliage clumps must not be used');
assert.doesNotMatch(renderer, /Forest_Far_Billboards_|createCrossBillboardGeometry\(\),|loadPineAtlas\(\);/, 'old crossed billboards and atlas path must remain absent');

// Culling and tighter LODs keep a dense forest from drawing the entire map every frame.
assert.match(renderer, /mesh\.computeBoundingSphere\(\);mesh\.frustumCulled=true;/, 'each tree batch must have bounds and enable frustum culling');
assert.match(renderer, /const cellSize=420/, 'forest batches must be split into spatial cells');
assert.match(renderer, /distanceSq<210\*210/, 'only the closest trees should cast detailed shadows');
assert.match(renderer, /distanceSq<370\*370/, 'near LOD should be limited to close trees');
assert.match(renderer, /distanceSq<1350\*1350/, 'mid LOD should be limited to medium-distance trees');
assert.match(renderer, /verticesPerTree:vertexCount/, 'V11 must report per-LOD vertex budgets');

// No crown-wide wind displacement until branch-local attributes are supported.
assert.match(renderer, /material\.positionNode=positionLocal/, 'V11 crowns must remain stable instead of using whole-tree sway');
assert.match(renderer, /function removeLegacyTreeAssets\(root\)/, 'named legacy tree assets must be removed before new forest placement');
assert.match(html, /webgpu-forest-lab\.v11\.js\?v=20261125w/, 'HTML must load the V11 renderer revision');

// The shared physical SkyMesh, fog and IBL stay untouched.
assert.match(atmosphere, /new SkyMesh\(\)/, 'physical SkyMesh must remain active');
assert.match(atmosphere, /skyDome\.cloudCoverage\.value/, 'cloud coverage must remain on the physical sky');
assert.match(atmosphere, /pmremGenerator\.fromScene\(environmentScene, 0\.035\)/, 'PMREM must use the same physical sky');
assert.match(atmosphere, /scene\.environment = next\.texture/, 'PBR materials must receive sky IBL');
assert.match(atmosphere, /renderer\.render\(scene, camera\)/, 'the fast baseline must use direct scene rendering');
assert.doesNotMatch(atmosphere, /GTAONode|buildFogPipeline|rtt\(/, 'the removed screen-space pipeline must stay absent');
assert.match(renderer, /renderer\.toneMappingExposure = 0\.52/, 'snow and terrain exposure must remain stable');

console.log('✓ V11 dense compact spruce tufts and per-LOD vertex budgets are active');
console.log('✓ Spatially chunked InstancedMesh batches use frustum culling and tighter LOD');
console.log('✓ Physical SkyMesh, snow PBR and direct rendering remain active');
