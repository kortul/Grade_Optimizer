import test from 'node:test';
import assert from 'node:assert/strict';
import { findSteepSafetyFencePlacements, buildSafetyFenceBoundaryChains } from '../safety-fences.v1.js';
const footprint={edges:[
 {ax:0,az:0,bx:10,bz:0},{ax:10,az:0,bx:10,bz:10},
 {ax:10,az:10,bx:0,bz:10},{ax:0,az:10,bx:0,bz:0}
]};
const isInside=(x,z)=>x>0&&x<10&&z>0&&z<10;
test('reconstructs closed piste boundary contours',()=>{
 const chains=buildSafetyFenceBoundaryChains(footprint.edges);
 assert.equal(chains.length,1);
 assert.ok(chains[0].length>=5);
});
test('places panels outside a piste when terrain drops steeply away',async()=>{
 const terrainY=(x,z)=>z<0?100+z*.8:100;
 const panels=await findSteepSafetyFencePlacements(footprint,isInside,terrainY);
 assert.ok(panels.length>=1,'expected panels along the steep lower boundary');
 assert.ok(panels.some(panel=>panel.z<0),'panels must be placed outside the piste');
 for(const panel of panels){assert.ok(Number.isFinite(panel.x)&&Number.isFinite(panel.y)&&Number.isFinite(panel.z));assert.equal(panel.height,1.38);assert.equal(panel.width,5.8);}
});
test('does not place panels on flat terrain',async()=>{
 const panels=await findSteepSafetyFencePlacements(footprint,isInside,()=>100);assert.equal(panels.length,0);
});
test('yields periodically instead of monopolizing the main thread',async()=>{
 let yields=0;
 await findSteepSafetyFencePlacements(footprint,isInside,(x,z)=>z<0?100+z*.8:100,{spacing:1.2,yieldEvery:2,yieldControl:async()=>{yields++;}});
 assert.ok(yields>0,'expected the finder to yield while processing boundary samples');
});
test('empty or incomplete footprint inputs safely return no placements',async()=>{
 assert.deepEqual(await findSteepSafetyFencePlacements(null,isInside,()=>100),[]);
 assert.deepEqual(await findSteepSafetyFencePlacements({edges:[]},isInside,()=>100),[]);
 assert.deepEqual(await findSteepSafetyFencePlacements(footprint,null,()=>100),[]);
});
