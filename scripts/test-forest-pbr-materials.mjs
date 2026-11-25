import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const renderer = readFileSync(new URL('../webgpu-forest-lab.v10.js', import.meta.url), 'utf8');
const atmosphere = readFileSync(new URL('../webgpu-forest-atmosphere.v1.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../webgpu-forest-lab.html', import.meta.url), 'utf8');

// Winter terrain must use one neutral material on real terrain, Stage 1 and the fallback apron.
assert.match(renderer, /function createAlpineTerrainMaps\(\)/, 'snow terrain should have procedural PBR maps');
assert.match(renderer, /const powder=\[232,239,245\]/, 'base snow albedo should stay neutral and bright');
assert.match(renderer, /const compact=\[211,224,235\]/, 'packed snow should have a restrained value shift');
assert.match(renderer, /const blueIce=\[190,207,222\]/, 'ice detail should stay in a subtle blue range');
assert.match(renderer, /function getSnowPbrMaterial\(\)/, 'all winter surfaces must share one snow material');
assert.match(renderer, /name:'ForestLab_NeutralSnow_PBR'/, 'snow material should have a stable debug name');
assert.match(renderer, /map:maps\.albedo/, 'snow material must use the snow albedo map');
assert.match(renderer, /roughnessMap:maps\.roughness/, 'snow material must use the micro-roughness map');
assert.match(renderer, /bumpMap:maps\.height/, 'snow material must use the snow micro-height map');
assert.match(renderer, /vertexColors:false/, 'Maya vertex colours must not tint the snow');
assert.match(renderer, /object\.material\.map\(\(\)=>snowMaterial\)/, 'real terrain material slots must be normalised to snow');
assert.match(renderer, /const snowMaterial=getSnowPbrMaterial\(\)/, 'Stage 1 must use the common snow material');
assert.match(renderer, /GO_WebGPU_SlopeMargin_SnowTerrain/, 'procedural terrain apron must use the same snow look');
assert.match(renderer, /ground=new THREE\.Mesh\(geometry,getSnowPbrMaterial\(\)\)/, 'terrain apron cannot use a separate coloured vertex material');
assert.match(renderer, /ensureWorldTerrainUV\(object,true\)/, 'world-space tiling UVs must be generated for every terrain mesh');
assert.match(renderer, /object\.castShadow=true;\s*object\.receiveShadow=true;/, 'terrain must cast and receive sunlight shadows');
assert.doesNotMatch(renderer, /colors\[k\]=color\.r;colors\[k\+1\]=color\.g;colors\[k\+2\]=color\.b/, 'procedural apron must not paint grass/rock/snow vertex colours');

// Preserve terrain topology and semantic material classification while replacing only the
// winter look-development material used by the isolated Forest Lab.
assert.match(renderer, /shareStageOneMaterialsByKind\(root,\{defaultKind:'slopes'\}\)/, 'Stage 1 semantic groups must still be recognised');
assert.match(renderer, /object\.material\.map\(\(\)=>snowMaterial\)/, 'semantic material identities must not leak Maya display colours into the winter look');
assert.match(renderer, /function createSplinePineMaterial\(\)/, 'procedural near/mid forest still uses its physical foliage material');
assert.match(renderer, /MeshPhysicalNodeMaterial\(\{\s*roughness:0\.88/, 'foliage should retain its physical node material');
assert.match(renderer, /V10: keep V9's tree silhouette; fill each bough with dense, layered 3D needle sprays/, 'spruce must use the new whorled bough geometry');
assert.match(renderer, /const branches=high\?7:mid\?6:5/, 'near, mid and far LODs must use the denser V10 tier structure');
assert.doesNotMatch(renderer, /Forest_Far_Billboards_|createCrossBillboardGeometry\(\),|loadPineAtlas\(\);/, 'old crossed billboards and foliage atlas must be removed');
assert.match(renderer, /const addNeedle=/, 'foliage must be made from volumetric needle geometry, not flat cards');
assert.match(renderer, /const twigStations=high\?6:mid\?4:3/, 'V10 must add closely spaced paired twigs on each main bough');
assert.match(renderer, /for\(const sideSign of \[-1,1\]\)/, 'V10 must fill both flanks of every main branch');
assert.match(renderer, /const sprayPositions=high\?3:mid\?2:1/, 'V10 must place multiple foliage sprays along each twig');
assert.match(renderer, /const needlesPerSpray=high\?5:mid\?4:3/, 'V10 must use dense 3D needle whorls');
assert.doesNotMatch(renderer, /addTriangle|addQuad|fanWidth/, 'broad flat fan surfaces must be absent from V10 foliage');
assert.match(renderer, /const phase=hash\(level\+11,variant\+37\)\*Math\.PI\*2/, 'spruce tiers must not rotate into a golden-angle vortex');
assert.match(renderer, /const addSnowCap=/, 'spruce boughs must carry segmented top-side snow patches');
assert.match(renderer, /material\.positionNode=positionLocal/, 'V10 foliage must remain static until branch-local deformation is added');
assert.doesNotMatch(renderer, /positionLocal\.y\.mul\(0\.0075\)|positionLocal\.y\.mul\(0\.0055\)/, 'old whole-tree algae sway must be removed');
assert.match(renderer, /function removeLegacyTreeAssets\(root\)/, 'named legacy tree assets must be stripped from Stage 1 before creating the new forest');
assert.doesNotMatch(renderer, /addClump|SphereGeometry|IcosahedronGeometry/, 'rounded foliage clumps must not be part of V10 geometry');
assert.match(renderer, /mesh\.castShadow=!!castShadow;mesh\.receiveShadow=true;/, 'tree batches must expose an explicit shadow-casting switch');
assert.match(renderer, /createTreeInstanceBatch\(nearShadow\[variant\],'near',variant,forestSystem\.group,true\)/, 'only near detailed trees should cast shadows in the fast baseline');
assert.match(renderer, /createTreeInstanceBatch\(mid\[variant\],'mid',variant,forestSystem\.group,false\)/, 'mid-distance trees must not add a second shadow cascade load');
assert.match(renderer, /sunLight\.shadow\.mapSize\.setScalar\(1024\)/, 'fast baseline should use the reduced shadow map');
assert.match(renderer, /sunLight\.shadow\.camera\.far=4500/, 'shadow camera should be limited to the useful viewing range');

// The sky, native cloud field and IBL must all come from one physical SkyMesh.
// Heavy full-screen volumetric/GTAO passes are intentionally absent in this baseline.
assert.match(atmosphere, /new SkyMesh\(\)/, 'physical SkyMesh must be the active sky');
assert.match(atmosphere, /skyDome\.cloudCoverage\.value/, 'cloud coverage must come from the SkyMesh cloud field');
assert.match(atmosphere, /skyDome\.cloudDensity\.value/, 'cloud density must come from the SkyMesh cloud field');
assert.match(atmosphere, /skyDome\.cloudElevation\.value/, 'cloud elevation must come from the SkyMesh cloud field');
assert.match(atmosphere, /pmremGenerator\.fromScene\(environmentScene, 0\.035\)/, 'PMREM must be generated from that same SkyMesh');
assert.match(atmosphere, /scene\.environment = next\.texture/, 'PBR materials must receive the sky environment');
assert.match(atmosphere, /SKY_RADIANCE_SCALE = 0\.096/, 'visible sky radiance must compensate for the scene exposure');
assert.match(atmosphere, /scene\.environmentIntensity = 3\.8/, 'PMREM intensity must compensate for the sky radiance scale');
assert.match(atmosphere, /new THREE\.FogExp2\(hazeDay, 0\)/, 'baseline distance haze should use the native light fog');
assert.match(atmosphere, /renderer\.render\(scene, camera\)/, 'the baseline must use a direct scene render');
assert.doesNotMatch(atmosphere, /GTAONode|buildFogPipeline|rtt\(/, 'the old expensive screen-space pipeline must remain removed');

// HTML and runtime controls must agree.
assert.match(html, /webgpu-forest-lab\.v10\.js\?v=20261125v/, 'HTML must load the V10 renderer revision');
assert.doesNotMatch(html, /id="godRays"|id="fogDensity"|id="fogHeight"|id="fogRange"/, 'removed full-screen controls should not remain in the UI');
assert.match(renderer, /renderer\.toneMappingExposure = 0\.52/, 'terrain and snow must use a stable scene exposure');

console.log('✓ Physical SkyMesh, built-in clouds, native haze and PMREM share one atmosphere');
console.log('✓ Real terrain, Slopes_Stage1 and procedural apron share one neutral snow PBR material');
console.log('✓ V10 dense paired twiglets and needle whorls are active');
console.log('✓ Near-only tree shadows and direct rendering form the performance baseline');
