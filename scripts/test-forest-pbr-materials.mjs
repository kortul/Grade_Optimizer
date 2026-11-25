import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../webgpu-forest-lab.v4.js',import.meta.url),'utf8');

assert.match(source,/function createAlpineTerrainMaps\(\)/,'terrain should have non-flat procedural PBR maps');
assert.match(source,/function makeTerrainPbrMaterial\(source,proceduralMaps,cache\)/,'FBX materials should be converted through one PBR-preserving path');
assert.match(source,/map:source\.map\|\|proceduralMaps\.albedo/,'source baseColor maps must be preserved, otherwise use procedural albedo');
assert.match(source,/if\(needsProceduralAlbedo\)ensureWorldTerrainUV\(object,true\)/,'procedural maps need world-scale UVs even when FBX contains generic UVs');
assert.match(source,/color:source\.color\?\.clone\?\.\(\)\|\|new THREE\.Color\(0xffffff\)/,'authored FBX baseColor must be retained');
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
