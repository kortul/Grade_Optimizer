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
