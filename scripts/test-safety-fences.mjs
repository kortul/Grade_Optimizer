import test from 'node:test';
import assert from 'node:assert/strict';
import { findSteepSafetyFencePlacements, buildSafetyFenceBoundaryChains, collectSafetyFenceBoundaryEdges, buildTerrainHeightLookup, sampleTerrainHeight } from '../safety-fences.v1.js';
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
 const panels=await findSteepSafetyFencePlacements(footprint,isInside,terrainY,{});
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

class TestVector3 {
 constructor(){this.x=0;this.y=0;this.z=0;}
 fromBufferAttribute(attribute,index){this.x=attribute.getX(index);this.y=attribute.getY(index);this.z=attribute.getZ(index);return this;}
 applyMatrix4(){return this;}
}
function testTriangleMesh(vertices){
 const position={
  count:vertices.length,
  getX(index){return vertices[index][0];},
  getY(index){return vertices[index][1];},
  getZ(index){return vertices[index][2];}
 };
 return {isMesh:true,geometry:{attributes:{position},index:null,drawRange:{start:0,count:vertices.length}},
  matrixWorld:{},updateWorldMatrix(){},visible:true};
}
test('merges shared boundaries across separate mesh children and handles non-indexed geometry',async()=>{
 const meshA=testTriangleMesh([[0,0,0],[10,0,0],[10,0,10]]);
 const meshB=testTriangleMesh([[0,0,0],[10,0,10],[0,0,10]]);
 const root={name:'Slope_A1',visible:true,updateWorldMatrix(){},traverseVisible(visitor){visitor(meshA);visitor(meshB);}};
 let yields=0;
 const result=await collectSafetyFenceBoundaryEdges({Vector3:TestVector3},[
  {id:'slope-a1',name:'Slope_A1',meta:{name:'Slope_A1'},root}
 ],{yieldEveryTriangles:1,yieldControl:async()=>{yields++;}});
 assert.equal(result.totalTriangles,2);
 assert.equal(result.stats[0].meshCount,2);
 assert.equal(result.stats[0].name,'Slope_A1');
 assert.equal(result.edges.length,4,'the internal diagonal must be removed and only the four outer edges retained');
 assert.ok(yields>=2,'the scanner must yield while processing large meshes');
});
test('limits fence boundary scanning to the first three slope assets',async()=>{
 const makeAsset=(id,name)=>({
  id,name,root:{name,visible:true,updateWorldMatrix(){},traverseVisible(visitor){
   visitor(testTriangleMesh([[0,0,0],[10,0,0],[10,0,10]]));
  }}
 });
 const result=await collectSafetyFenceBoundaryEdges({Vector3:TestVector3},[
  makeAsset('a','A'),makeAsset('b','B'),makeAsset('c','C'),makeAsset('d','D')
 ],{yieldControl:async()=>{}});
 assert.deepEqual(result.stats.map(item=>item.name),['A','B','C']);
});

test('terrain height index samples triangle heights with barycentric interpolation',async()=>{
 const mesh=testTriangleMesh([[0,5,0],[10,15,0],[0,5,10]]);
 const root={updateWorldMatrix(){},traverseVisible(visitor){visitor(mesh);}};
 let yields=0;
 const index=await buildTerrainHeightLookup({Vector3:TestVector3},root,{
  cellSize:10,yieldEveryVertices:1,yieldEveryTriangles:1,yieldControl:async()=>{yields++;}
 });
 assert.equal(index.meshCount,1);
 assert.equal(index.vertexCount,3);
 assert.equal(index.triangleCount,1);
 assert.equal(sampleTerrainHeight(index,2,2),7);
 assert.equal(sampleTerrainHeight(index,12,2),null);
 assert.ok(yields>=4,'height-index construction should yield during both vertex and triangle passes');
});
test('terrain height index ignores degenerate XZ triangles and empty roots',async()=>{
 const degenerate=testTriangleMesh([[0,1,0],[5,2,0],[10,3,0]]);
 const root={updateWorldMatrix(){},traverseVisible(visitor){visitor(degenerate);}};
 const index=await buildTerrainHeightLookup({Vector3:TestVector3},root,{yieldControl:async()=>{}});
 assert.equal(index.triangleCount,0);
 assert.equal(sampleTerrainHeight(index,2,0),null);
 assert.equal(await buildTerrainHeightLookup({Vector3:TestVector3},null),null);
});
