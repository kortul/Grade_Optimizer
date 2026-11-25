import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../webgpu-forest-lab.v4.js',import.meta.url),'utf8');

assert.match(source,/function createAlpineTerrainMaps\(\)/,'terrain should have non-flat procedural PBR maps');
assert.match(source,/function makeTerrainPbrMaterial\(source,proceduralMaps,cache\)/,'FBX materials should be converted through one PBR-preserving path');
assert.match(source,/map:source\.map\|\|proceduralMaps\.albedo/,'source baseColor maps must be preserved, otherwise use procedural albedo');
assert.match(source,/if\(needsProceduralAlbedo\)ensureWorldTerrainUV\(object,true\)/,'procedural maps need world-scale UVs even when FBX contains generic UVs');
assert.match(source,/color:source\.color\?\.clone\?\.\(\)\|\|new THREE\.Color\(0xffffff\)/,'authored FBX baseColor must be retained');
assert.match(source,/specularColor:new THREE\.Color\(0xffffff\)/,'Phong default dark specular must not suppress physical highlights');
assert.doesNotMatch(source,/specularColor:source\.specular/,'Phong specular must not be copied as a physical F0 color');
assert.match(source,/object\.castShadow=true;\s*object\.receiveShadow=true;/,'base terrain must both cast and receive shadows');
assert.doesNotMatch(source,/new THREE\.MeshStandardMaterial\(\{ color: 0xe7eff4/,'flat pale-grey terrain override must not return');
assert.match(source,/scene\.environmentIntensity=0\.92;/,'PBR environment reflections must have useful intensity');
assert.match(source,/new THREE\.MeshPhysicalNodeMaterial\(\{roughness:0\.64/,'near foliage should use a physical node material');
assert.match(source,/mesh\.castShadow=!!castShadow;mesh\.receiveShadow=true;/,'near and mid tree batches should support shadow casting');
assert.match(source,/midShadow=\[\[\],\[\],\[\]\]/,'mid-distance trees need a dedicated shadow-casting LOD');
assert.match(source,/shadowLimitSq=2050\*2050/,'tree shadow coverage should extend beyond the immediate foreground');
assert.match(source,/shadow\.camera\.left=-2100/,'directional shadow frustum should cover the forest viewing area');

console.log('✓ Real terrain keeps authored FBX baseColor/materials and receives procedural PBR detail only as fallback');
console.log('✓ Terrain and near/mid forest LODs cast and receive direct-sun shadows');
console.log('✓ Physical foliage, roughness, bump and stronger environment IBL are active');


assert.match(source,/import \{ SunLight \} from 'three\/addons\/lights\/SunLight\.js'/,'WebGPU scene should use cascaded SunLight, not a basic directional light');
assert.match(source,/SunLight\.registerNode\(SunLightNode\)/,'SunLight node implementation must be registered before renderer init');
assert.match(source,/new THREE\.PMREMGenerator\(renderer\)/,'sky environment must use the supported PMREM generator');
assert.match(source,/pmremGenerator\.fromScene\(environmentScene,0\.04\)/,'prefiltered environment must be baked from the real SkyMesh');
assert.match(source,/scene\.environment=environmentRenderTarget\.texture/,'PBR materials must receive the baked sky environment');
assert.match(source,/import \{ ao \} from 'three\/addons\/tsl\/display\/GTAONode\.js'/,'screen-space GTAO should be part of the ambient lighting path');
assert.match(source,/scenePass\.contextNode=builtinAOContext\(aoPass\.getTextureNode\(\)\.sample\(screenUV\)\.r\)/,'GTAO must modulate the scene ambient term, not tint the final image');
assert.match(source,/sunLight\.intensity = solar\.daylight \* \(3\.0 \+ solar\.daylight \* 2\.0\) \* directPower/,'sunlight should follow the high/low sun irradiance curve');
assert.match(source,/renderer\.shadowMap\.enabled=true;\s*renderer\.shadowMap\.type=THREE\.PCFShadowMap;\s*sunLight\.shadow\.mapSize\.setScalar\(2048\)/,'cascaded shadows must be enabled after WebGPU renderer init');
assert.match(source,/renderer\.toneMappingExposure = 0\.6/,'display exposure should match the r187 physical sunlight baseline');
assert.doesNotMatch(source,/new THREE\.DataTexture\(data,width,height,THREE\.RGBAFormat,THREE\.HalfFloatType\)/,'synthetic flat-gradient HDR texture must not replace the sky PMREM');
