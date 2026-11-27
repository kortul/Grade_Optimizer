import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStageOneSlopeSurfaceLookup,
  sampleStageOneSurfaceHeight,
  selectH3SafetyFenceCurves,
  findCenterlineSafetyFencePlacements
} from '../safety-fences.v2.js';

class TestVector3 {
  constructor(){this.x=0;this.y=0;this.z=0;}
  fromBufferAttribute(attribute,index){
    this.x=attribute.getX(index);this.y=attribute.getY(index);this.z=attribute.getZ(index);return this;
  }
  applyMatrix4(){return this;}
}

function makeMesh(vertices, materialName='Slopes') {
  const position={
    count:vertices.length,
    getX(index){return vertices[index][0];},
    getY(index){return vertices[index][1];},
    getZ(index){return vertices[index][2];}
  };
  return {
    isMesh:true,uuid:'mesh-'+materialName,name:'test-surface',visible:true,parent:null,
    material:{name:materialName,userData:{}},
    geometry:{attributes:{position},index:null,groups:[],drawRange:{start:0,count:vertices.length}},
    matrixWorld:{},
    updateWorldMatrix(){},
  };
}

function makeRoot(meshes) {
  return {
    visible:true,
    updateWorldMatrix(){},
    traverseVisible(visitor){for(const mesh of meshes)visitor(mesh);}
  };
}

function makeRectSurface(minX,maxX,minZ,maxZ,y=100,material='Slopes') {
  const a=[minX,y,minZ],b=[maxX,y,minZ],c=[maxX,y,maxZ],d=[minX,y,maxZ];
  return makeMesh([a,b,c,a,c,d],material);
}

const THREE={Vector3:TestVector3};

test('selects only the named H3 centerline and not adjacent H30/H31 names',()=>{
  const curves=[
    {id:'curve-1',name:'A1'},
    {id:'curve-2',name:'Slope_H3'},
    {id:'curve-3',name:'H30'},
    {id:'H3-centerline',name:'Other'},
    {id:'curve-5',name:'H31'}
  ];
  assert.deepEqual(selectH3SafetyFenceCurves(curves).map(curve=>curve.id),['curve-2','H3-centerline']);
});

test('builds a Stage1 surface index from Slopes material triangles',async()=>{
  const root=makeRoot([makeRectSurface(-40,40,-10,10)]);
  const result=await buildStageOneSlopeSurfaceLookup(THREE,root,{yieldControl:async()=>{}});
  assert.equal(result.stats.byKind.slopes.triangles,2);
  assert.equal(result.stats.byKind.angled.triangles,0);
  assert.equal(sampleStageOneSurfaceHeight(result.byKind.slopes,0,0),100);
  assert.equal(sampleStageOneSurfaceHeight(result.byKind.slopes,0,20),null);
});

test('places nets only along the steep outside edge of a straight H3 segment',async()=>{
  const root=makeRoot([makeRectSurface(-50,50,-10,10)]);
  const index=await buildStageOneSlopeSurfaceLookup(THREE,root,{yieldControl:async()=>{}});
  const curve={id:'H3',name:'H3',points:[[-40,100,0],[40,100,0]]};
  const terrainY=(x,z)=>z>10?100-(z-10)*0.8:100;
  const result=await findCenterlineSafetyFencePlacements(curve,index.byKind.slopes,terrainY,{
    stationSpacing:5,panelSpacing:5,edgeSampleDistance:8,
    yieldControl:async()=>{}
  });
  assert.ok(result.placements.length>=2,'expected a few nets on the dangerous piste edge');
  console.log('[H3 fence test] steep edge placements:',JSON.stringify(result.placements.map(panel=>({x:panel.x,z:panel.z,reason:panel.reason}))));
  assert.ok(result.placements.every(panel=>panel.z>10),'panels should be outside the high-z edge');
  assert.ok(result.placements.every(panel=>panel.reason==='steep-edge'));
  assert.equal(result.diagnostics.surfaceHitRatio,1);
});

test('does not fence a straight piste when both edges and adjacent terrain are flat',async()=>{
  const root=makeRoot([makeRectSurface(-50,50,-10,10)]);
  const index=await buildStageOneSlopeSurfaceLookup(THREE,root,{yieldControl:async()=>{}});
  const curve={id:'H3',name:'H3',points:[[-40,100,0],[40,100,0]]};
  const result=await findCenterlineSafetyFencePlacements(curve,index.byKind.slopes,()=>100,{
    yieldControl:async()=>{}
  });
  assert.deepEqual(result.placements,[]);
});

test('adds a limited run on the outside of a sharp turn even on level terrain',async()=>{
  const root=makeRoot([makeRectSurface(-45,15,-25,45)]);
  const index=await buildStageOneSlopeSurfaceLookup(THREE,root,{yieldControl:async()=>{}});
  const curve={id:'H3',name:'H3',points:[
    [-40,100,0],[-8,100,0],[0,100,0],[0,100,8],[0,100,40]
  ]};
  const result=await findCenterlineSafetyFencePlacements(curve,index.byKind.slopes,()=>100,{
    stationSpacing:4,panelSpacing:4,minimumTurnDegrees:18,
    yieldControl:async()=>{}
  });
  assert.ok(result.diagnostics.turnStations>0,'expected the centreline bend to be detected');
  assert.ok(result.diagnostics.placedForTurns>0,'expected safety nets on the outside of the bend');
  assert.ok(result.placements.some(panel=>panel.reason==='turn'));
});

test('uses AngledSlopes only when its material is explicitly classified as angled',async()=>{
  const root=makeRoot([makeRectSurface(-40,40,-10,10,100,'AngledSlopes')]);
  const result=await buildStageOneSlopeSurfaceLookup(THREE,root,{yieldControl:async()=>{}});
  assert.equal(result.stats.byKind.slopes.triangles,0);
  assert.equal(result.stats.byKind.angled.triangles,2);
  assert.equal(sampleStageOneSurfaceHeight(result.byKind.angled,0,0),100);
});

test('yields while building the Stage1 lookup and while sampling a long line',async()=>{
  const meshes=[];
  for(let i=0;i<20;i++)meshes.push(makeRectSurface(i*3,i*3+2,-2,2,100));
  let yields=0;
  const index=await buildStageOneSlopeSurfaceLookup(THREE,makeRoot(meshes),{
    yieldEveryTriangles:1,yieldControl:async()=>{yields++;}
  });
  assert.ok(yields>0);
  const curve={id:'H3',name:'H3',points:[[0,100,0],[50,100,0]]};
  const result=await findCenterlineSafetyFencePlacements(curve,index.byKind.slopes,()=>100,{
    yieldEveryStations:1,yieldControl:async()=>{yields++;}
  });
  assert.ok(yields>1);
  assert.equal(result.diagnostics.curveName,'H3');
});
