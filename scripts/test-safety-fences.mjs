import test from 'node:test';
import assert from 'node:assert/strict';
import { findSteepSafetyFencePlacements } from '../safety-fences.v1.js';

const footprint={
  edges:[
    {ax:0,az:0,bx:10,bz:0},
    {ax:10,az:0,bx:10,bz:10},
    {ax:10,az:10,bx:0,bz:10},
    {ax:0,az:10,bx:0,bz:0}
  ]
};
const isInside=(x,z)=>x>0&&x<10&&z>0&&z<10;

test('places safety panels outside a piste when terrain drops steeply away',()=>{
  const terrainY=(x,z)=>z<0?100+z*.8:100;
  const panels=findSteepSafetyFencePlacements(footprint,isInside,terrainY);
  assert.ok(panels.length>=2,'expected panels along the steep lower boundary');
  assert.ok(panels.some(panel=>panel.z<0),'panels must be placed outside the piste');
  for(const panel of panels){
    assert.ok(Number.isFinite(panel.x)&&Number.isFinite(panel.y)&&Number.isFinite(panel.z));
    assert.equal(panel.height,1.38);
    assert.equal(panel.width,5.8);
  }
});

test('does not place safety panels on flat terrain',()=>{
  const panels=findSteepSafetyFencePlacements(footprint,isInside,()=>100);
  assert.equal(panels.length,0);
});

test('empty or incomplete footprint inputs safely return no placements',()=>{
  assert.deepEqual(findSteepSafetyFencePlacements(null,isInside,()=>100),[]);
  assert.deepEqual(findSteepSafetyFencePlacements({edges:[]},isInside,()=>100),[]);
  assert.deepEqual(findSteepSafetyFencePlacements(footprint,null,()=>100),[]);
});