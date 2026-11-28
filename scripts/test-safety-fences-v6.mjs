import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStageOneSlopeSurfaceLookup,
  sampleStageOneSurfaceHeight,
  selectHSafetyFenceCurves,
  findCenterlineSafetyFencePlacements,
  computeSafetyFencePanelBasis,
  buildSafetyFenceGroup,
  dedupeSafetyFencePlacements
} from '../safety-fences.v6.js';

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

test('selects all named H piste centerlines and ignores unrelated piste names',()=>{
  const curves=[
    {id:'curve-a1',name:'A1'},
    {id:'curve-b1',name:'B1'},
    {id:'curve-h1',name:'H1'},
    {id:'curve-h2',name:'H2'},
    {id:'curve-h3',name:'H3'},
    {id:'curve-h12',name:'Slope_H12'},
    {id:'curve-other',name:'Hotel3'}
  ];
  assert.deepEqual(
    selectHSafetyFenceCurves(curves).map(curve=>curve.id),
    ['curve-h1','curve-h2','curve-h3','curve-h12']
  );
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
  assert.ok(result.placements.every(panel=>panel.z<10&&panel.z>0),'panels should be inset from the high-z edge toward the piste centre');
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


function makeSlopedRectSurface(minX, maxX, minZ, maxZ, yAtX, material='Slopes') {
  const a=[minX,yAtX(minX),minZ],b=[maxX,yAtX(maxX),minZ];
  const c=[maxX,yAtX(maxX),maxZ],d=[minX,yAtX(minX),maxZ];
  return makeMesh([a,b,c,a,c,d],material);
}

test('keeps the real Stage 1 edge grade in each panel width axis',async()=>{
  const yAtX=x=>100-0.4*(x+40);
  const root=makeRoot([makeSlopedRectSurface(-50,50,-10,10,yAtX)]);
  const index=await buildStageOneSlopeSurfaceLookup(THREE,root,{yieldControl:async()=>{}});
  const curve={id:'H3',name:'H3',points:[[-40,yAtX(-40),0],[40,yAtX(40),0]]};
  const terrainY=(x,z)=>yAtX(x)-(z>10?8:0);
  const result=await findCenterlineSafetyFencePlacements(curve,index.byKind.slopes,terrainY,{
    stationSpacing:5,panelSpacing:5,edgeSampleDistance:8,panelTangentWindowMeters:4.5,
    yieldControl:async()=>{}
  });
  assert.ok(result.placements.length>=2,'expected safety nets on the steep outside edge');
  const panel=result.placements[0];
  const basis=computeSafetyFencePanelBasis(panel);
  const grade=basis.widthAxis[1]/basis.widthAxis[0];
  assert.ok(Math.abs(grade+0.4)<0.05,'panel base and top edges should follow the actual piste grade');
  assert.ok(panel.z<10 && panel.z>-10,'panels should be inset toward the piste centre');
  assert.ok(Math.abs(panel.ay-(yAtX(panel.ax)+0.02))<0.05,'first post must be grounded on Stage1 at its inset position');
  assert.ok(Math.abs(panel.by-(yAtX(panel.bx)+0.02))<0.05,'second post must be grounded on Stage1 at its inset position');
  assert.equal(basis.heightAxis[0],0);
  assert.equal(basis.heightAxis[1],panel.height);
  assert.equal(basis.heightAxis[2],0);
  assert.ok(Math.abs(basis.position[1]-((panel.ay+panel.by)*0.5+panel.height*0.5))<1e-8);
});

test('follows the sampled piste-edge bend instead of a long smoothed centerline heading',async()=>{
  const root=makeRoot([makeRectSurface(-45,15,-25,45)]);
  const index=await buildStageOneSlopeSurfaceLookup(THREE,root,{yieldControl:async()=>{}});
  const curve={id:'H3',name:'H3',points:[
    [-40,100,0],[-8,100,0],[0,100,0],[0,100,8],[0,100,40]
  ]};
  const result=await findCenterlineSafetyFencePlacements(curve,index.byKind.slopes,()=>100,{
    stationSpacing:4,panelSpacing:4,minimumTurnDegrees:18,
    turnWindowMeters:8,panelTangentWindowMeters:3,
    yieldControl:async()=>{}
  });
  assert.ok(result.placements.length>=2,'expected panels on the outside of the bend');
  const bases=result.placements.map(panel=>computeSafetyFencePanelBasis(panel));
  assert.ok(bases.some(basis=>Math.abs(basis.widthAxis[0])>Math.abs(basis.widthAxis[2])*1.5),'some panels should align with the approach edge');
  assert.ok(bases.some(basis=>Math.abs(basis.widthAxis[2])>Math.abs(basis.widthAxis[0])*1.5),'some panels should rotate with the outgoing edge');
});

test('applies a sloped, curved panel basis when constructing the instanced mesh',()=>{
  class TestMatrix4 {
    makeBasis(x,y,z){this.basis=[[x.x,x.y,x.z],[y.x,y.y,y.z],[z.x,z.y,z.z]];return this;}
    setPosition(x,y,z){this.position=[x,y,z];return this;}
  }
  class TestVector3 {
    constructor(){this.x=0;this.y=0;this.z=0;}
    set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  }
  class TestGroup { add(object){this.object=object;} }
  class TestMesh {
    constructor(geometry,material,count){
      this.geometry=geometry;this.material=material;this.count=count;this.instances=[];
      this.instanceMatrix={setUsage(){},needsUpdate:false};
      this.instanceColor={needsUpdate:false};
    }
    setMatrixAt(index,matrix){this.instances[index]={basis:matrix.basis,position:matrix.position};}
    setColorAt(){}
    computeBoundingSphere(){}
  }
  class TestColor { setRGB(){} }
  const fakeTHREE={
    Group:TestGroup,PlaneGeometry:class{},MeshBasicMaterial:class{},
    InstancedMesh:TestMesh,Matrix4:TestMatrix4,Vector3:TestVector3,Color:TestColor,
    DoubleSide:2,StaticDrawUsage:35044
  };
  const panel={x:1,y:2,z:3,ax:-1,ay:1.5,az:3,bx:3.8,by:-2.1,bz:3,width:6,height:1.4,tint:1};
  const result=buildSafetyFenceGroup(fakeTHREE,[panel],{});
  assert.equal(result.count,1);
  const matrix=result.group.object.instances[0];
  assert.ok(Math.abs(matrix.basis[0][0]-4.8)<1e-8);
  assert.ok(Math.abs(matrix.basis[0][1]+3.6)<1e-8);
  assert.deepEqual(matrix.basis[1],[0,1.4,0],'fence posts stay world-vertical');
  assert.equal(matrix.position[0],1.4);
  assert.ok(Math.abs(matrix.position[1]-0.4)<1e-8);
  assert.equal(matrix.position[2],3);
});

test('respects the maximum panel count after deferred edge-tangent sampling',async()=>{
  const root=makeRoot([makeRectSurface(-50,50,-10,10)]);
  const index=await buildStageOneSlopeSurfaceLookup(THREE,root,{yieldControl:async()=>{}});
  const curve={id:'H3',name:'H3',points:[[-40,100,0],[40,100,0]]};
  const terrainY=(x,z)=>z>10?100-(z-10):100;
  const result=await findCenterlineSafetyFencePlacements(curve,index.byKind.slopes,terrainY,{
    stationSpacing:2,panelSpacing:2,panelWidth:2,maxPanels:2,minimumEdgeAngleDegrees:5,
    edgeSampleDistance:8,yieldControl:async()=>{}
  });
  assert.ok(result.placements.length<=2);
});


test('full coverage produces continuous short panels along both measured piste edges',async()=>{
  const root=makeRoot([makeRectSurface(-50,50,-10,10)]);
  const index=await buildStageOneSlopeSurfaceLookup(THREE,root,{yieldControl:async()=>{}});
  const curve={id:'H1',name:'H1',points:[[-40,100,0],[40,100,0]]};
  const result=await findCenterlineSafetyFencePlacements(curve,index.byKind.slopes,()=>100,{
    coverageMode:'full',
    stationSpacing:3.5,
    panelWidth:3.5,
    panelHeight:1.4,
    maxPanels:200,
    fenceInsetMeters:1.25,
    yieldControl:async()=>{}
  });
  assert.ok(result.placements.length>=30,'expected a continuous test run on both piste edges');
  assert.ok(result.placements.every(panel=>panel.reason==='continuous-test'));
  assert.ok(result.placements.every(panel=>panel.width>=2.8&&panel.width<=4.2),
    'panel segments should follow the local station spacing rather than a long smoothed window');
  assert.ok(result.placements.every(panel=>panel.z<=-7.0||panel.z>=7.0),
    'both fence lines should remain near their respective piste edge after the inward offset');
  assert.ok(result.placements.every(panel=>Number.isFinite(panel.ax)&&Number.isFinite(panel.bx)));
  assert.equal(result.diagnostics.panelCount,result.placements.length);
});

test('full coverage rejects discontinuous / sideways edge jumps instead of creating explosive diagonal panels',async()=>{
  const root=makeRoot([makeRectSurface(-50,50,-10,10)]);
  const index=await buildStageOneSlopeSurfaceLookup(THREE,root,{yieldControl:async()=>{}});
  const curve={id:'H2',name:'H2',points:[[-40,100,0],[40,100,0]]};
  const result=await findCenterlineSafetyFencePlacements(curve,index.byKind.slopes,()=>100,{
    coverageMode:'full',
    stationSpacing:3.5,
    maxPanels:200,
    yieldControl:async()=>{}
  });
  for(const panel of result.placements){
    const dx=panel.bx-panel.ax,dz=panel.bz-panel.az;
    assert.ok(Math.abs(dx)>2.5,'valid fence panels must run along the piste, not across it');
    assert.ok(Math.abs(dz)<0.1,'straight piste edge should not generate sideways explosions');
  }
});

test('deduplicates coincident H-slope boundary panels while retaining adjacent panels',()=>{
  const segment=(ax,bx,z)=>({
    ax,ay:100,az:z,bx,by:100,bz:z,width:bx-ax,height:1.4
  });
  const placements=[
    segment(0,3.5,8),
    segment(3.5,7,8),
    segment(0,3.5,8.4),
    segment(3.5,7,8.35),
    segment(7,10.5,8)
  ];
  const result=dedupeSafetyFencePlacements(placements);
  assert.equal(result.length,3,'near-identical boundary panels from overlapping H curves should collapse, but neighbours remain');
  assert.ok(result.includes(placements[0]));
  assert.ok(result.includes(placements[1]));
  assert.ok(result.includes(placements[4]));
});

test('keeps crossing panels from different H pistes instead of mistaking them for duplicates',()=>{
  const result=dedupeSafetyFencePlacements([
    {ax:-2,ay:100,az:0,bx:2,by:100,bz:0,width:4,height:1.4},
    {ax:0,ay:100,az:-2,bx:0,by:100,bz:2,width:4,height:1.4}
  ]);
  assert.equal(result.length,2,'different directions at a crossing are not duplicate barriers');
});


test('full-coverage panels are terrain-checked along their entire span and report adaptive inset',async()=>{
  const root=makeRoot([makeRectSurface(-50,50,-10,10)]);
  const index=await buildStageOneSlopeSurfaceLookup(THREE,root,{yieldControl:async()=>{}});
  const curve={id:'H3',name:'H3',points:[[-40,100,0],[40,100,0]]};
  const result=await findCenterlineSafetyFencePlacements(curve,index.byKind.slopes,()=>100,{
    coverageMode:'full',stationSpacing:3.5,panelWidth:3.5,panelHeight:1.4,
    maxPanels:200,maxHalfWidth:64,crossSectionStep:1.25,fenceInsetMeters:1.25,
    yieldControl:async()=>{}
  });
  assert.ok(result.placements.length>0);
  assert.ok(result.diagnostics.maxAcceptedInset>=1.25);
  for(const panel of result.placements){
    assert.ok(Math.abs(sampleStageOneSurfaceHeight(index.byKind.slopes,panel.ax,panel.az)-100)<1e-6);
    assert.ok(Math.abs(sampleStageOneSurfaceHeight(index.byKind.slopes,panel.bx,panel.bz)-100)<1e-6);
  }
});
