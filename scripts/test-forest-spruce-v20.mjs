import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../webgpu-forest-lab.v20.js',import.meta.url),'utf8');
const standalone=readFileSync(new URL('../webgpu-forest-lab-v20.html',import.meta.url),'utf8');
const main=readFileSync(new URL('../webgpu-forest-lab.html',import.meta.url),'utf8');

const start=source.indexOf('const addNeedleClump=');
const end=source.indexOf('const addSnowCap=',start);
assert.ok(start>=0&&end>start,'V20 directional needle-clump builder must exist');
const clump=source.slice(start,end);
assert.match(clump,/const outward=new THREE\.Vector3\(center\.x,0,center\.z\)/,'sprays must use the branch position as their outward reference');
assert.match(clump,/const direction=forward\.clone\(\)\.multiplyScalar\(0\.68\+rng\(\)\*0\.13\)[\s\S]*addScaledVector\(outward,0\.52\+rng\(\)\*0\.16\)/,'needle directions must remain aligned to the twig and point away from the trunk');
assert.match(clump,/const cardCount=high\?Math\.max\(1,layers\):1/,'close terminal tufts may use two cards but regular sprays stay single-card');
assert.match(source,/const sx=size\*0\.5,sy=size\*0\.90,ex=size\*0\.5,ey=size\*0\.10/,'the textured shoot axis must align with the card long axis');
assert.match(source,/addNeedleClump\(centre,axis,seedBase\+i\*31,scale\*\(0\.82\+rr\(\)\*0\.34\),colour,1\)/,'branch sprays must render as one card each');
assert.match(source,/const sprayCount=high\?1:2/,'only the near LOD is reduced; medium and far LODs keep their spray coverage');
assert.match(source,/addSpraysAlong\(primary,high\?1:2/,'the distant crown fill must retain the successful V19 spray count');
assert.match(source,/if\(high&&sr\(\)<0\.34\)[\s\S]*const forkCount=1/,'tertiary twig density must be capped for the near LOD');
assert.match(source,/addSpraysAlong\(primary,high\?1:2/,'medium and far primary branches must retain their established fill sprays');
assert.match(source,/mesh\.castShadow=!!castShadow;mesh\.receiveShadow=false/,'trees must not pay for expensive shadow-map lookups on every foliage card');
assert.match(source,/if\(distance<55\)return 'shadow'/,'only the immediate foreground should cast full tree shadows');
assert.match(source,/if\(current==='shadow'&&distance<72\)return 'shadow'/,'shadow LOD must retain hysteresis');
assert.match(standalone,/webgpu-forest-lab\.v20\.js\?v=20261127c/);
assert.match(main,/webgpu-forest-lab\.v20\.js\?v=20261127c/);
console.log('Forest Spruce V20 branch-aligned needle sprays, vertical shoot atlas, reduced card count and limited shadow cost passed.');
