import assert from 'node:assert/strict';
import { shareStageOneMaterialsByKind } from '../stage-one-materials.v1.js';

function mesh(name,materials,geometry){
  return {name,isMesh:true,material:materials,geometry,children:[]};
}
const slopesA={uuid:'s-a',name:'Slopes',type:'MeshStandardMaterial',roughness:0.92,userData:{}};
const slopesB={uuid:'s-b',name:'pasted__Slopes__02',type:'MeshPhysicalMaterial',roughness:0.2,userData:{gradeOptimizerFbxSourceMaterialName:'MayaNS::Slopes'}};
const angledA={uuid:'a-a',name:'AngledSlopes',type:'MeshPhongMaterial',userData:{}};
const angledB={uuid:'a-b',name:'pasted__AngledSlopes__03',type:'MeshStandardMaterial',userData:{gradeOptimizerFbxSourceMaterialName:'zzShapka_Angled'}};
const fallback={uuid:'fallback',name:'OpenPBR Material',type:'MeshPhysicalMaterial',userData:{}};
const geometryA={groups:[{start:0,count:600,materialIndex:0},{start:600,count:300,materialIndex:1}]};
const geometryB={groups:[{start:0,count:150,materialIndex:0},{start:150,count:150,materialIndex:1},{start:300,count:60,materialIndex:2}]};
const root={
  name:'Slopes_Stage1',userData:{},
  children:[
    mesh('G1Slope_Mesh_30m',[slopesA,angledA],geometryA),
    mesh('G2Slope_Mesh_20m',[slopesB,angledB,fallback],geometryB)
  ]
};
const groupsBefore=JSON.stringify([geometryA.groups,geometryB.groups]);
const result=shareStageOneMaterialsByKind(root);
const [first,second]=root.children;
assert.equal(result.materialCount,2,'known Stage 1 asset must expose exactly Slopes and AngledSlopes');
assert.equal(result.materialSlots,5);
assert.equal(result.mergedSlots,3);
assert.equal(first.material[0],second.material[0],'all Slopes slots must point to one shared object');
assert.equal(first.material[1],second.material[1],'all AngledSlopes slots must point to one shared object');
assert.equal(first.material[0],slopesA);
assert.equal(first.material[1],angledA);
assert.equal(second.material[2],first.material[0],'unknown Stage 1 slots fall back to Slopes');
assert.equal(first.material[0].name,'Slopes');
assert.equal(first.material[1].name,'AngledSlopes');
assert.equal(JSON.stringify([geometryA.groups,geometryB.groups]),groupsBefore,'material groups must remain unchanged');
assert.deepEqual(root.userData.gradeOptimizerStageOneSharedMaterials,result);
console.log('✓ Stage1 material aliases collapse into exactly two semantic materials');
console.log('✓ original material groups and geometry remain unchanged');
