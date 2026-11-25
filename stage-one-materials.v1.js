/**
 * Normalize the two semantic surface classes used by the Stage 1 Maya FBX.
 * Maya can emit "AngledSlopes" as one compound token, as well as legacy
 * namespaced / pasted aliases such as "zzShapka_Angled" and "pasted__Slopes".
 */
export function classifyStageOneSurfaceKind(name){
  const value=String(name||'')
    .replace(/([a-z0-9])([A-Z])/g,'$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,'_');
  const compact=value.replace(/_/g,'');
  if(compact.includes('angled'))return 'angled';
  if(/slopes?/.test(compact))return 'slopes';
  return '';
}

export function hasStageOneSurfaceMaterialPair(names){
  let hasSlopes=false,hasAngled=false;
  for(const name of names||[]){
    const kind=classifyStageOneSurfaceKind(name);
    if(kind==='slopes')hasSlopes=true;
    else if(kind==='angled')hasAngled=true;
    if(hasSlopes&&hasAngled)return true;
  }
  return false;
}

/**
 * Hard-enforce Stage 1's two authored material identities on a loaded asset.
 * Only Mesh.material references and material labels / metadata are changed.
 * BufferGeometry, material groups, primitive ranges and draw topology remain
 * untouched. Call only after identifying a Slopes_Stage1 asset.
 */
export function shareStageOneMaterialsByKind(root,{defaultKind='slopes'}={}){
  const canonicalByKind=new Map();
  let meshCount=0,materialSlots=0,mergedSlots=0,unclassifiedSlots=0;
  const visit=(object,inheritedKind='')=>{
    if(!object)return;
    const objectKind=classifyStageOneSurfaceKind(object.name)||inheritedKind;
    if(object.isMesh&&object.material){
      meshCount++;
      const source=Array.isArray(object.material)?object.material:[object.material];
      const normalized=source.map(material=>{
        if(!material)return material;
        materialSlots++;
        const semanticKind=classifyStageOneSurfaceKind(material.userData?.gradeOptimizerStageOneSurfaceKind);
        const sourceKind=classifyStageOneSurfaceKind(material.userData?.gradeOptimizerFbxSourceMaterialName);
        const displayKind=classifyStageOneSurfaceKind(material.name);
        const kind=semanticKind||sourceKind||displayKind||objectKind||defaultKind||'';
        if(!kind){unclassifiedSlots++;return material;}
        let canonical=canonicalByKind.get(kind);
        if(!canonical){
          canonical=material;
          canonical.name=kind==='angled'?'AngledSlopes':'Slopes';
          canonical.userData={
            ...(canonical.userData||{}),
            gradeOptimizerStageOneSurfaceKind:kind
          };
          canonicalByKind.set(kind,canonical);
        }else if(canonical!==material){
          mergedSlots++;
        }
        return canonical;
      });
      object.material=Array.isArray(object.material)?normalized:normalized[0];
    }
    (object.children||[]).forEach(child=>visit(child,objectKind));
  };
  visit(root);
  const summary={
    materialCount:canonicalByKind.size,materialSlots,mergedSlots,meshCount,unclassifiedSlots,
    materialNames:[...canonicalByKind.values()].map(material=>material.name||'Material')
  };
  if(root){
    root.userData=root.userData||{};
    root.userData.gradeOptimizerStageOneSharedMaterials=summary;
  }
  return summary;
}
