/**
 * Imported assets frequently contain one material datablock per mesh even
 * when every slot has the same authored material name. Consolidate those
 * slots asset-wide so Scene Editor behaves like a shared-material inspector.
 *
 * This changes only Mesh.material references; it never edits geometry,
 * material groups, primitive ranges, or mesh topology.
 */
function sourceMaterialName(material){
  const semanticKind=String(material?.userData?.gradeOptimizerStageOneSurfaceKind||'').trim().toLowerCase();
  if(semanticKind)return 'semantic:'+semanticKind;

  let name=String(
    material?.userData?.gradeOptimizerFbxSourceMaterialName ||
    material?.name ||
    ''
  ).trim();
  if(!name)return '';

  // Strip Maya namespace / path wrappers and FBX pasted-material prefixes.
  name=name.split('::').pop().split('|').pop().split(':').pop().trim();
  name=name.replace(/^pasted(?:[_ .-]+)+/i,'');
  // Maya commonly appends a numeric duplicate suffix when importing/copying.
  name=name.replace(/(?:[_ .-]+)\d+$/,'').trim();

  const key=name.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,'');
  if(!key||['material','defaultmaterial','meshstandardmaterial','standardmaterial'].includes(key))return '';
  return 'name:'+key+':'+String(material?.type||'');
}

export function mergeImportedMaterialsByName(root){
  const canonicalByName=new Map();
  let materialSlots=0,mergedSlots=0;
  root?.traverse?.(object=>{
    if(!object.isMesh||!object.material)return;
    const source=Array.isArray(object.material)?object.material:[object.material];
    const normalized=source.map(material=>{
      if(!material)return material;
      materialSlots++;
      const key=sourceMaterialName(material);
      if(!key)return material;
      const canonical=canonicalByName.get(key);
      if(canonical){
        if(canonical!==material)mergedSlots++;
        return canonical;
      }
      canonicalByName.set(key,material);
      return material;
    });
    object.material=Array.isArray(object.material)?normalized:normalized[0];
  });
  const summary={
    materialCount:canonicalByName.size,
    materialSlots,
    mergedSlots,
    materialNames:[...new Set([...canonicalByName.values()].map(material=>material.name||'Material'))]
  };
  if(root){
    root.userData=root.userData||{};
    root.userData.gradeOptimizerNamedMaterialMerge=summary;
  }
  return summary;
}
