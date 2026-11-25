import assert from 'node:assert/strict';
import { mergeImportedMaterialsByName } from '../editor-shared-materials.v1.js';

function mesh(name,materials,geometry){
  return {name,isMesh:true,material:materials,geometry};
}
function scene(...nodes){
  return {
    userData:{},
    traverse(callback){for(const node of nodes)callback(node);}
  };
}

const slopesA={uuid:'slopes-a',name:'Slopes',type:'MeshStandardMaterial',roughness:0.95};
const slopesB={uuid:'slopes-b',name:'Slopes',type:'MeshStandardMaterial',roughness:0.35};
const angledA={uuid:'angled-a',name:'AngledSlopes',type:'MeshStandardMaterial',roughness:0.9};
const angledB={uuid:'angled-b',name:'pasted__AngledSlopes__03',type:'MeshPhysicalMaterial',roughness:0.1};
const other={uuid:'other',name:'LiftMetal',type:'MeshStandardMaterial'};
const geometryA={groups:[{start:0,count:6,materialIndex:0},{start:6,count:3,materialIndex:1}]};
const geometryB={groups:[{start:0,count:3,materialIndex:0},{start:3,count:3,materialIndex:1}]};
const first=mesh('Mesh A',[slopesA,angledA],geometryA);
const second=mesh('Mesh B',[slopesB,angledB],geometryB);
const third=mesh('Mesh C',other,{groups:[]});
const root=scene(first,second,third);

const result=mergeImportedMaterialsByName(root);

assert.equal(result.mergedSlots,2);
assert.equal(first.material[0],second.material[0],'all Slopes slots must point to one shared object');
assert.equal(first.material[1],second.material[1],'all AngledSlopes aliases must point to one shared object');
assert.notEqual(first.material[0],first.material[1],'different source material names must remain separate');
assert.equal(first.material[0],slopesA,'first same-name material instance remains canonical');
assert.equal(second.material[0],slopesA);
assert.equal(second.material[1],angledA);
assert.equal(third.material,other,'uniquely named materials must remain untouched');
assert.equal(first.geometry,geometryA,'geometry objects must not be split or replaced');
assert.equal(second.geometry,geometryB,'geometry objects must not be split or replaced');
assert.deepEqual(geometryA.groups,[{start:0,count:6,materialIndex:0},{start:6,count:3,materialIndex:1}]);
assert.deepEqual(geometryB.groups,[{start:0,count:3,materialIndex:0},{start:3,count:3,materialIndex:1}]);
assert.equal(root.userData.gradeOptimizerNamedMaterialMerge.mergedSlots,2);

const namespaced={uuid:'namespaced',name:'assetNS::Slopes.001',type:'MeshStandardMaterial'};
const aliasRoot=scene(mesh('Mesh D',namespaced,{groups:[]}));
const aliasSummary=mergeImportedMaterialsByName(aliasRoot);
assert.equal(aliasSummary.materialCount,1,'Maya namespaces and numeric duplicate suffixes must normalize to one authored name');

const restoredSlopes={uuid:'restored-slopes',name:'Slopes',type:'MeshPhysicalMaterial',roughness:0.02,userData:{gradeOptimizerSavedMaterialId:'legacy-mesh-24'}};
const restoredAngled={uuid:'restored-angled',name:'pasted__AngledSlopes__02',type:'MeshStandardMaterial',roughness:0.99,userData:{gradeOptimizerSavedMaterialId:'legacy-mesh-25'}};
const restoredMesh=mesh('Restored from old scene.json',[restoredSlopes,restoredAngled],{groups:[{start:0,count:6,materialIndex:0},{start:6,count:3,materialIndex:1}]});
const originalMesh=mesh('Original mesh',[slopesA,angledA],geometryA);
const restoredRoot=scene(originalMesh,restoredMesh);
const restoreResult=mergeImportedMaterialsByName(restoredRoot);
assert.equal(restoreResult.mergedSlots,2,'legacy restored materialId clones must be re-shared despite differing PBR classes');
assert.equal(restoredMesh.material[0],originalMesh.material[0],'restored Slopes clone must join the same shared object');
assert.equal(restoredMesh.material[1],originalMesh.material[1],'restored AngledSlopes clone must join the same shared object');

console.log('✓ same-named FBX/GLB materials share one object across asset mesh slots');
console.log('✓ distinct named materials stay separate');
console.log('✓ mesh geometry and material groups remain unchanged');
