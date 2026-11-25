import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const read = path => readFileSync(resolve(root, path));
const pass = message => console.log('✓ ' + message);

const html = read('index.html').toString('utf8');
const entryMatch = html.match(/<script\s+type=["']module["']\s+src=["']([^"']+)["']/i);
assert.ok(entryMatch, 'index.html must declare a module entrypoint');
const entry = entryMatch[1].replace(/^\.\//, '');
const entryPath = entry.split('?')[0];
assert.match(entryPath, /^app\.v\d+\.js$/, 'index.html must activate a versioned application release');
const entrySource = read(entryPath).toString('utf8');
assert.ok(entrySource.includes('TERRAIN_SNOW_TILE_METERS=120'), 'terrain snow texture must use a broad 120 m tile');
assert.ok(entrySource.includes('gradeOptimizerTerrainTexture') && entrySource.includes('low-frequency-albedo-no-bump'), 'source terrain must avoid high-frequency bump mapping');
assert.ok(entrySource.includes('THREE.LinearMipmapLinearFilter') && entrySource.includes('THREE.LinearFilter'), 'terrain snow albedo must use trilinear minification');

assert.ok(
  entrySource.includes('logarithmicDepthBuffer:true') && entrySource.includes('camera.near=0.5;'),
  'kilometre-scale terrain must use logarithmic depth buffering and a safe near plane'
);
assert.ok(existsSync(resolve(root, entryPath)), 'active module does not exist: ' + entryPath);
pass('active entrypoint exists: ' + entryPath);
const skierBatchSource=read('skier-render-batching.v1.js').toString('utf8');
assert.ok(skierBatchSource.includes('mergeGeometries')&&skierBatchSource.includes('physicsCollision:false')&&skierBatchSource.includes('goSkierBatchHidden'),'Stage1 skier render batching must merge static meshes while keeping a separate collision source');
assert.ok(entrySource.includes('setStageOneSkierRenderBatch')&&entrySource.includes('Skier Stage1 mesh batching'),'active app must batch Stage1 static meshes only in skier mode');
const renderPerformanceSource=read('render-performance.v1.js').toString('utf8');
assert.ok(renderPerformanceSource.includes('performanceProfileActive ? profileMaximum : maximum')&&renderPerformanceSource.includes('frameIntervalsMs.length < 5'),'render performance helpers must cap skier resolution and reject undersampled rolling FPS');
pass('skier viewport-resolution cap, rolling FPS sampling and scene draw diagnostics are present');
const weatherV8Source=read('weather-system.v9.js').toString('utf8');
assert.ok(existsSync(resolve(root,'assets/cloud-atlas.v1.svg')),'AI cloud atlas asset is missing');
assert.ok(weatherV8Source.includes('cloud-atlas.v1.svg')&&weatherV8Source.includes('cloudMaterials'),'AI cloud atlas is not used');
assert.ok(weatherV8Source.includes('CLOUD_VOLUME_FRAGMENT_SHADER')&&weatherV8Source.includes('GROUND_FOG_FRAGMENT_SHADER')&&weatherV8Source.includes('setSceneReady(ready)'),'volumetric cloud/fog shaders are missing');
assert.ok(weatherV8Source.includes('VOLUMETRIC_CLOUD_MIN_COVERAGE = 0.015')&&weatherV8Source.includes('shouldRenderVolumetricClouds(coverage, enabled = true)')&&weatherV8Source.includes('value > VOLUMETRIC_CLOUD_MIN_COVERAGE'),'light and partial cloud cover must retain the original volumetric cloud shader');
assert.ok(weatherV8Source.includes('material.opacity=volumetrics?0.12+coverage*0.12:0.50+coverage*0.30')&&weatherV8Source.includes('this.sceneReady&&volumetrics&&coverage>0.015'),'cloud sprites and volumetric activation must match the original weather behavior');
assert.ok(!weatherV8Source.includes('sin(dot(p, vec2(127.1, 311.7)))')&&!weatherV8Source.includes('for (int i = 0; i < 14; i++)'),'volumetric shaders must avoid expensive trigonometric hashes and 14-step fog loops');
assert.ok(weatherV8Source.includes('shadowDensity')&&weatherV8Source.includes('uRayStrength'),'volumetric god-ray scattering or cloud self-shadowing is missing');
assert.ok(weatherV8Source.includes('createNightSky()')&&weatherV8Source.includes('GO_StarField')&&weatherV8Source.includes('GO_Moon'),'night sky stars or moon are missing');
assert.ok(entrySource.includes('./weather-system.v9.js')&&entrySource.includes('setVolumetrics')&&entrySource.includes('weatherSystem.setSceneReady(false)')&&entrySource.includes('weatherSystem.setSceneReady(!!state.root)'),'app must import the volumetric weather system');
assert.ok(html.includes('id="weatherVolumetrics"')&&html.includes('id="sceneVolumetrics"'),'volumetric toggle UI is missing');
assert.ok(html.includes('id="timeOfDay" type="range" min="0" max="24"'),'time slider must span 24 hours');
pass('AI cloud atlas, volume shaders, god rays, stars, moon, 24h time and toggle UI are present');

assert.ok(html.includes('id="saveOverviewCamera"')&&html.includes('class="secondary save-overview-camera"'), 'Scene Editor overview camera-save icon is missing');
assert.ok(entrySource.includes('function normalizeOverviewCameraMap(')&&entrySource.includes('function saveOverviewCamera()'), 'overview camera capture / validation helpers are missing');
assert.ok(entrySource.includes("markClientProjectDirty('стартовый ракурс обзорной камеры')"), 'saving an overview camera must mark the client project dirty');
assert.ok(entrySource.includes('overviewCameras:normalizeOverviewCameraMap(state.savedOverviewCameras)'), 'per-slope overview cameras must be serialized into scene.json');
assert.ok(entrySource.includes('state.savedOverviewCameras=normalizeOverviewCameraMap(manifest.overviewCameras)'), 'per-slope overview cameras must be restored from scene.json');
assert.ok(entrySource.includes('if(restoreSavedOverviewCameraForCurrentSlope())return;'), 'Home must restore the saved overview camera before using the automatic fallback');
pass('Scene Editor camera-save icon, per-slope manifest persistence and Home restore are present');

assert.ok(html.includes('id="skierSpawnSlots"')&&html.includes('id="placeSkierSpawnButton"')&&html.includes('id="deleteSkierSpawnButton"')&&html.includes('id="sceneLookTab-spawn"')&&html.includes('id="sceneLookPanel-spawn"'), 'Scene Editor skier spawn tool controls / dedicated tab are missing');
assert.ok(html.includes('class="scene-look-panel scene-look-panel--spawn" id="sceneLookPanel-spawn" data-look-panel="spawn"')&&html.indexOf('id="sceneLookPanel-spawn"')>html.indexOf('<div class="scene-look-panels">'), 'spawn tool must live inside its dedicated Scene Editor tab panel');
for(const slot of ['1','2','3','4','5','6','7','8','9','0']){
  assert.ok(html.includes('data-skier-spawn-slot="'+slot+'"'), 'Scene Editor spawn slot missing: '+slot);
}
assert.ok(entrySource.includes("const SKIER_SPAWN_KEYS=['1','2','3','4','5','6','7','8','9','0']"), 'exactly ten numeric skier spawn slots must be available');
assert.ok(entrySource.includes('function normalizeSkierSpawnMap(')&&entrySource.includes('skierSpawns:normalizeSkierSpawnMap(state.skierSpawns)'), 'skier spawn points must be normalized and persisted in client scene.json');
assert.ok(entrySource.includes('state.skierSpawns=normalizeSkierSpawnMap(manifest.skierSpawns)'), 'skier spawn points must be restored when opening a client project');
assert.ok(entrySource.includes('function onSkierSpawnPlacementPointerDown(')&&entrySource.includes('function onSkierSpawnPlacementPointerMove(')&&entrySource.includes('pickSkierSpawnSurface(event)'), 'spawn placement must capture both surface position and facing direction');
assert.ok(entrySource.includes('lastSkierSpawnPlacementPointerAt=performance.now();')&&entrySource.includes('if(performance.now()-lastSkierSpawnPlacementPointerAt<700)'), 'spawn placement clicks must bypass Inspector geometry selection / yellow pulse');
assert.ok(entrySource.includes('function respawnSkierAtSpawnSlot(')&&entrySource.includes('respawnAtCustomSpawn('), 'numeric spawn slots must teleport the active skier to saved custom locations');
assert.ok(entrySource.includes('function getSkierSpawnKeyFromEvent(event)')&&entrySource.includes('const spawnKey=getSkierSpawnKeyFromEvent(e)')&&entrySource.includes("const editingText=!!(eventTarget?.isContentEditable||/^(INPUT|TEXTAREA)$/.test(eventTarget?.tagName||''));"), 'number-row and numpad spawn shortcuts must work even when a Scene Editor select retains focus');
pass('Scene Editor ten-slot skier spawn placement, direction, manifest persistence and numeric respawn controls are present');

assert.ok(entrySource.includes('async function loadCanonicalTerrainFbx('), 'canonical Maya terrain FBX loader is missing');
assert.ok(entrySource.includes("'./assets/real-terrain.json'+bust()") && entrySource.includes("'./assets/real-terrain.fbx'+bust()"), 'runtime must load the canonical terrain JSON / FBX pair');
assert.ok(entrySource.includes("cm:0.01") && entrySource.includes('root.scale.multiplyScalar(metersPerUnit)'), 'Maya centimetres must be converted to runtime metres');
assert.ok(entrySource.includes('setTerrainSnowMaterial(canonicalTerrain.terrainMesh,canonicalTerrain.metersPerUnit)'), 'snow texture UVs must account for Maya source units');
assert.ok(entrySource.includes("if(id==='A1')") && entrySource.includes("использую резервный A1.gltf"), 'real terrain must be preferred for the primary slope while preserving A1 fallback');
assert.ok(entrySource.includes('expectedNames.some(expected=>names.some(name=>name===expected))'), 'FBX loader must resolve terrainShape by its manifest name');
pass('canonical Maya terrainShape FBX loading, units, UV scale and A1 fallback are present');
assert.ok(entrySource.includes('function restoreCadBridgeWorkingCoordinates('), 'CAD Bridge working-world restoration helper is missing');
assert.ok(entrySource.includes("restoreCadBridgeWorkingCoordinates(root,manifest?.mayaExport,'canonical terrain')"), 'canonical terrain loader must honor CAD Bridge export metadata');
assert.ok(entrySource.includes('restoreCadBridgeWorkingCoordinates(root,item.mayaExport,item.name||item.id)'), 'client FBX loader must restore assets to the terrain working-world frame');
assert.ok(entrySource.includes('mayaExport:asset.meta.mayaExport||undefined'), 'client scene backups must preserve Maya CAD Bridge metadata');
pass('canonical terrain and imported Maya FBX assets share their original CAD working-world coordinate frame');
assert.ok(entrySource.includes("if(/\\.fbx$/i.test(item.file))restoreCadBridgeWorkingCoordinates(root,item.mayaExport,item.name||item.id)"), 'CAD Bridge restoration must run only on source FBX files, not already-normalized GLB backups');
const bridgeOffset = [218704.14299926758, 0, -50152.88024902344];
const bridgeScale = 1000;
const workingPoint = [-265699.25, 1528.5089111328125, -374683.03125];
const bridgeEncodedPoint = workingPoint.map((value,index)=>value/bridgeScale+bridgeOffset[index]);
const bridgeRestoredPoint = bridgeEncodedPoint.map((value,index)=>(value-bridgeOffset[index])*bridgeScale);
bridgeRestoredPoint.forEach((value,index)=>assert.ok(Math.abs(value-workingPoint[index])<1e-6, 'CAD Bridge coordinate round-trip failed on axis '+index));
pass('CAD Bridge coordinate round-trip and FBX-only restoration guard are validated');
assert.ok(entrySource.includes("if(/\\.fbx$/i.test(String(fileName||'')))"), 'generic model parser must route .fbx files through FBXLoader');
pass('generic FBX parser extension detection routes .fbx assets through FBXLoader');
assert.ok(html.includes('id="editorEmissiveEnabled"'), 'material editor must expose an independent emissive enable toggle');
assert.ok(entrySource.includes('function updateEditorEmissiveControls('), 'emissive toggle must control the color / strength inputs');
assert.ok(entrySource.includes('material.emissiveIntensity=emissiveEnabled?emissiveStrength:0'), 'disabling emission must zero emissive intensity without changing Base Color');
assert.ok(entrySource.includes('gradeOptimizerEmissiveEnabled')&&entrySource.includes('gradeOptimizerEmissiveStrength')&&entrySource.includes('gradeOptimizerEmissiveEnabled:savedMaterial.emissiveEnabled'), 'emissive enable state and strength must be serialized and restored');
pass('per-material emissive toggle, strength preservation and project serialization are present');
assert.ok(entrySource.includes('function disableMaterialEmissionByDefault(')&&entrySource.includes('material.emissiveIntensity=enabled?savedStrength:0'), 'current and newly loaded model materials must default to emission OFF');
assert.ok(entrySource.includes("gradeOptimizerEmissiveEnabled:false")&&entrySource.includes("if('emissiveIntensity' in material)material.emissiveIntensity=0"), 'legacy material configurations must migrate to emission OFF');
pass('all current legacy and newly imported model materials default to emissive OFF');
assert.ok(entrySource.includes('function isMayaStageOneFbx(root,fileName=')&&entrySource.includes('const isStageOneSlopes=isMayaStageOneFbx(root,fileName)'), 'Stage 1 detection must use the FBX filename or its Maya hierarchy / material names, not one exact filename pattern');
assert.ok(entrySource.includes('const canonicalBySourceName=new Map()')&&entrySource.includes('canonicalBySourceName.has(sourceName)')&&entrySource.includes('gradeOptimizerFbxSourceMaterialName'), 'FBX materials with duplicated Maya IDs but the same shader name must share one material object across meshes');
assert.ok(entrySource.includes('prepareFbxMaterials(root,{preserveSlopeAlbedo:isStageOneSlopes})')&&entrySource.includes('applyStageOneSurfaceMaterials(root)'), 'Slopes_Stage1 must run its dedicated surface-material pass after FBX conversion');
assert.ok(entrySource.includes("material.color.set(kind==='slopes'?0xffffff:0x383838)")&&entrySource.includes("if(/(^|_)angled?(_|$)/.test(value))return 'angled'")&&entrySource.includes("if(/(^|_)slopes?(_|$)/.test(value))return 'slopes'")&&entrySource.includes("(/openpbr/i.test(materialName)?'slopes':'')"), 'Stage 1 Slopes must be white, Angled dark grey, and the technical OpenPBR slot must inherit the Maya surface class');
assert.ok(entrySource.includes('material.map=null')&&entrySource.includes('material.emissiveMap=null')&&entrySource.includes('material.vertexColors=false'), 'Stage 1 surface colors must not be tinted by imported albedo maps, emission maps or vertex colors');
assert.ok(entrySource.includes('gradeOptimizerAlbedoRecovery')&&entrySource.includes('emissive-map-recovered-as-base-color-map')&&entrySource.includes('emissive-color-recovered-as-base-color'), 'black diffuse materials must recover usable albedo from FBX emission data');
pass('Slopes_Stage1 applies explicit white Slopes and dark-grey Angled materials');

assert.ok(entrySource.includes('function editorMaterialsEquivalent(a,b)')&&entrySource.includes('function editorGeometryForMaterial(object,materialFilter,ownedGeometries)'), 'material identity matching and group-filtered geometry selection are missing');
assert.ok(entrySource.includes('filtered.clearGroups()')&&entrySource.includes('filtered.addGroup(group.start,group.count,0)'), 'material highlight must isolate matching FBX geometry groups');
assert.ok(entrySource.includes('hit.face?.materialIndex')&&entrySource.includes('selectEditorNode(picked,picked.root,-1,hitMaterial)')&&entrySource.includes('pulseEditorSelection(picked.root,hitMaterial)'), 'viewport click must select and highlight all faces assigned to the clicked material');
assert.ok(entrySource.includes('duration:1000')&&!entrySource.includes('persistent:!!materialFilter')&&!entrySource.includes('if(effect.persistent){'), 'all Scene Editor selection highlights must fade and be removed after one second');
pass('viewport and material-list selection highlight all matching material groups across the selected asset');

assert.ok(entrySource.includes('function editorTexturesEquivalent(a,b)')&&entrySource.includes('function mergeEquivalentEditorMaterials(root)'), 'conservative duplicate-material matching and FBX-wide material consolidation are missing');
const parseModelSource=entrySource.slice(entrySource.indexOf('function parseSceneModel('),entrySource.indexOf('const loadGLTF'));
assert.ok(parseModelSource.includes('mergeEquivalentEditorMaterials(root)')&&parseModelSource.includes('mergeEquivalentEditorMaterials(sceneRoot)'), 'FBX and GLB imports must consolidate equivalent material instances after material normalization');
assert.ok(entrySource.includes('const byMaterial=new Map()')&&entrySource.includes('byMaterial.get(id)')&&entrySource.includes('target.bindings.push({owner:asset,mesh:object,material,index})'), 'Materials tab must group each shared material into one entry while retaining all mesh-slot bindings');
assert.ok(entrySource.includes('editorMaterialTargets=collectEditorMaterials(editorSelectedAsset,editorSelectedAsset?.root)'), 'Materials inspector must enumerate material bindings across the full selected FBX asset, not only the selected mesh');
assert.ok(entrySource.includes('const canonicalMaterials=new Map()')&&entrySource.includes("material.name=kind==='slopes'?'Slopes':'Angled'")&&entrySource.includes('gradeOptimizerStageOneSurfaceKind'), 'Stage 1 FBX assignments must consolidate into two shared Slopes / Angled material instances');
assert.ok(entrySource.includes('const kind=classify(materialName)||objectKind||(/openpbr/i.test(materialName)?\'slopes\':\'\')'), 'Stage 1 OpenPBR fallback must not become an unintended third editor material');
assert.ok(entrySource.includes('editorMaterialTargets=collectEditorMaterials(editorSelectedAsset,editorSelectedAsset?.root)')&&entrySource.includes('target.label=materialName+(meshCount>1?'), 'Materials tab must display one entry per shared material and report how many meshes use it');
assert.ok(entrySource.includes("materialCount.textContent=editorMaterialTargets.length+' MATERIALS'")&&html.includes('Unique Material · Whole Asset'), 'Materials tab must report unique asset-wide material count');
assert.ok(entrySource.includes('material.color.set(document.getElementById(\'editorBaseColor\').value)')&&entrySource.includes('markEditorMaterialOwnersDirty(material)'), 'editing a shared material instance must update and persist every mesh slot that references it');
assert.ok(entrySource.includes('const bindings=target.bindings?.length?target.bindings:[target]')&&entrySource.includes('bindings.forEach(binding=>'), 'assign and Make Unique operations must update every grouped material slot');
pass('FBX-wide shared materials: one Slopes / Angled material instance across all matching groups and meshes');

const originalTerrainManifest = JSON.parse(read('assets/real-terrain.json').toString('utf8'));
assert.equal(originalTerrainManifest.assetId, 'real-terrain', 'base terrain manifest identity changed');
assert.equal(originalTerrainManifest.category, 'terrain', 'base terrain category changed');
const terrainComponents = originalTerrainManifest.mayaExport?.components;
assert.ok(Array.isArray(terrainComponents) && terrainComponents.length > 0, 'base terrain manifest must identify at least one exported mesh');
const terrainComponent = terrainComponents.find(component => component && (component.name || component.shape));
assert.ok(terrainComponent, 'base terrain exported mesh name / shape is missing');
const terrainFbxPath = resolve(root, 'assets/real-terrain.fbx');
assert.ok(existsSync(terrainFbxPath), 'original base terrain FBX is missing');
assert.equal(
  statSync(terrainFbxPath).size,
  Number(originalTerrainManifest.mayaExport.modelSizeBytes),
  'base terrain FBX byte size does not match its export manifest'
);
const clientSceneManifest = JSON.parse(read('clients/alpine-resort/scene.json').toString('utf8'));
const stageOneAsset = clientSceneManifest.assets.find(asset => asset.id === 'slopes_stage1');
assert.ok(stageOneAsset, 'Slopes_Stage1 must be registered as a separate client asset');
assert.equal(stageOneAsset.name, 'Slopes_Stage1', 'stage-one piste asset name changed');
assert.equal(stageOneAsset.category, 'slope', 'Slopes_Stage1 must remain an additional slope asset');
assert.equal(stageOneAsset.activeTerrain, false, 'Slopes_Stage1 must not replace the base terrain');
assert.deepEqual(stageOneAsset.transform.scale, [0.01, 0.01, 0.01], 'Maya centimetres must be converted to metres for the imported piste');
assert.deepEqual(stageOneAsset.transform.position, [0, 0.1, 0], 'the complete imported piste asset must retain a non-destructive 10 cm world-Y clearance above the source terrain');

const stageOneComponents = stageOneAsset.mayaExport?.components || [];
assert.ok(stageOneComponents.length > 0, 'Slopes_Stage1 manifest must list its exported mesh components');
const stageOneSourceMaterialNames=[...new Set(stageOneComponents.flatMap(component=>component.materials||[]))].sort();
assert.deepEqual(stageOneSourceMaterialNames,[
  'openPBR_shader1','pasted__pasted__zzMainlandscape_Slopes','zzMainlandscape_Slopes','zzShapka_Angled'
], 'Maya Stage 1 source aliases / technical shader inventory changed');
assert.ok(entrySource.includes('meshCount,materialSlots')&&entrySource.includes('materialCount:canonicalMaterials.size'), 'Stage 1 material normalization must report total meshes, source slots and canonical unique materials');
assert.equal(
  stageOneComponents.length,
  Number(stageOneAsset.mayaExport?.meshComponentCount),
  'Slopes_Stage1 component manifest count must match the exported mesh count'
);
assert.ok(existsSync(resolve(root, 'clients/alpine-resort', stageOneAsset.file)), 'Slopes_Stage1 FBX file is missing');
pass('original base terrain is preserved and Slopes_Stage1 is registered as separate non-active piste geometry');


assert.ok(entrySource.includes('function adaptSceneScaleToBounds(bounds){'), 'scene framing must adapt to the actual terrain bounds');
assert.ok(entrySource.includes('controls.maxDistance=sceneViewMaxDistance') && entrySource.includes('d * factor, 30, sceneViewMaxDistance'), 'camera zoom range must grow with the real Maya terrain');
assert.ok(entrySource.includes('shadowHalfSpan=Math.max(1200,horizontalDiagonal*0.55)'), 'directional shadow coverage must include the full-scale terrain');
assert.ok(entrySource.includes('scene.fog.far=Math.max(9000,diagonal*1.5)'), 'fog distance must scale with the scene bounds');
pass('kilometre-scale camera, fog and shadow coverage adapt without recentering / normalizing terrain');

assert.ok(entrySource.includes('function collectVisibleOverviewMeshes(')&&entrySource.includes('function focusOverviewGeometryAt('), 'overview geometry focus helper is missing');
assert.ok(entrySource.includes('lastOverviewTouchTap')&&entrySource.includes("event.pointerType!=='touch'")&&entrySource.includes("addEventListener('pointercancel'"), 'mobile overview double-tap recognition / cancel cleanup is missing');
assert.ok(entrySource.includes('overviewTouchStart.maxMove')&&entrySource.includes('moved>8')&&entrySource.includes('now-start.time>260'), 'touch focus must reject dragging / long press rather than stealing the overview camera');
assert.ok(entrySource.includes('lastTouchFocusAt')&&entrySource.includes('performance.now()-lastTouchFocusAt<700'), 'synthetic mobile dblclick must not focus the camera a second time');
assert.ok(entrySource.includes('maxHitDistance=touch')&&entrySource.includes('item.distance<=maxHitDistance'), 'touch focus must reject distant stray / back-face geometry hits');


const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(m => m[1]);
const duplicateIds = ids.filter((id, i) => ids.indexOf(id) !== i);
assert.deepEqual([...new Set(duplicateIds)], [], 'duplicate HTML ids: ' + [...new Set(duplicateIds)].join(', '));
pass('HTML ids are unique (' + ids.length + ')');

const staticDomRefs = [...entrySource.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map(m => m[1]);
assert.ok(staticDomRefs.length > 0, 'expected to find static DOM lookups in the app');
const missingDomRefs = [...new Set(staticDomRefs.filter(id => !ids.includes(id)))];
assert.deepEqual(missingDomRefs, [], 'app references missing HTML ids: ' + missingDomRefs.join(', '));
pass('all static DOM lookups resolve (' + new Set(staticDomRefs).size + ')');

const localImports = [...entrySource.matchAll(/from\s+["'](\.[^"']+)["']/g)].map(m => m[1]);
assert.ok(entrySource.includes('weather-system.v9.js'), 'active app must use the updated atmospheric weather engine');
const mayaExporterSource = read('maya/grade_optimizer_exporter.py').toString('utf8');
assert.ok(mayaExporterSource.includes('def _inspect_git_worktree(repo):')&&mayaExporterSource.includes('"--show-toplevel"'), 'Maya exporter must verify the selected Git working tree');
assert.ok(
  !mayaExporterSource.includes('def _stage_one_branch_selection(repo, components):') &&
  mayaExporterSource.includes('The Maya selection is the sole source of export geometry for every target.'),
  'Every Maya export target must use the exact current Maya selection without phase/name-based branch overrides'
);
assert.ok(
  mayaExporterSource.includes('node == item or node.startswith(item.rstrip("|") + "|")') &&
  !mayaExporterSource.includes('item.startswith(node.rstrip("|") + "|")'),
  'Maya node metadata must not leak from ancestor or sibling branches'
);
assert.ok(
  mayaExporterSource.includes('Preserve all Maya-authored transforms') &&
  !mayaExporterSource.includes('node.rsplit("|", 1)[-1].lower() == "tosketchfab"'),
  'Maya export must preserve nested scales and ToSketchfab translation before world-space baking'
);
assert.ok(mayaExporterSource.includes('def _git_changes_for_paths(repo, paths):')&&mayaExporterSource.includes('"--short"'), 'Maya exporter must report exact Git status for the exported FBX and manifest');
assert.ok(mayaExporterSource.includes('remote.origin.url')&&mayaExporterSource.includes('def check_git_repository(')&&mayaExporterSource.includes('"--short", "--branch"'), 'Maya exporter must expose Git origin diagnostics in its UI');
assert.ok(mayaExporterSource.includes('ПРОВЕРКА GIT:')&&mayaExporterSource.includes('ПРОВЕРИТЬ ПАПКУ'), 'Maya exporter must show post-export Git diagnostics and a folder check button');
pass('Maya exporter verifies local Git root and reports exact post-export file status');
assert.ok(entrySource.includes("const FORCE_REMOTE_PROJECT=WORKSPACE_QUERY.get('remote')==='1'"), 'project URL must support loading the published GitHub manifest without a stale browser draft');
assert.ok(entrySource.includes('if(!FORCE_REMOTE_PROJECT)') && entrySource.includes('Локальный черновик браузера оставлен без изменений.'), 'forced GitHub load must preserve unsynced browser backup');
assert.ok(entrySource.includes('const geometryBounds=new THREE.Box3().setFromObject(root)') && entrySource.includes('if(!visibleMeshCount)'), 'FBX loader must validate actual nonempty and visible geometry');
pass('published project bypass and imported FBX geometry diagnostics are present');
const weatherSource = read('weather-system.v9.js').toString('utf8');
assert.ok(weatherSource.includes("this.cameraWeatherRig = new THREE.Group()"), 'weather camera-follow scene root missing');
assert.ok(weatherSource.includes('this.scene.add(this.cameraWeatherRig)'), 'camera-follow weather layer must belong to the renderable scene graph');
assert.ok(weatherSource.includes('this.cameraWeatherRig.add(this.snow)')&&weatherSource.includes('this.cameraWeatherRig.add(this.streaks)'), 'snow and wind streaks must be children of the renderable camera-follow root');
assert.ok(weatherSource.includes('this.camera.getWorldQuaternion(this.cameraWeatherRig.quaternion)')&&weatherSource.includes('this.cameraWeatherRig.position.copy(this.cameraPosition)'), 'weather layer must follow the current camera transform every frame');
assert.ok(weatherSource.includes('this.snowCount = 2200')&&weatherSource.includes('uOpacity:{value:0.92}')&&weatherSource.includes('this.snowMaterial.uniforms.uOpacity.value=0.84+this.params.snowfall*0.12'), 'snowfall density and shader opacity must remain visible');
for (const preset of ['clear','light','partly','cloudy','overcast','snow','blizzard']) {
  assert.ok(weatherSource.includes(preset + ':'), 'weather preset missing from runtime: ' + preset);
  assert.ok(html.includes('data-weather-preset="' + preset + '"'), 'weather preset button missing from UI: ' + preset);
}
assert.ok(entrySource.includes('weatherPresetButtons.forEach(button =>')&&entrySource.includes('applyWeatherPreset(button.dataset.weatherPreset)'), 'weather preset buttons must apply the selected runtime preset');
assert.ok(weatherSource.includes("this.params = { ...WeatherSystem.PRESETS.light, preset: 'light', groundFog: false, volumetrics: true }"), 'ground fog must default to OFF');
assert.ok(weatherSource.includes('shadowDensity')&&weatherSource.includes('uRayStrength'), 'broken-cloud sun shafts must be present and weather-dependent');
assert.ok(weatherSource.includes('makeGroundFogTexture()')&&weatherSource.includes('setGroundFog(enabled)'), 'optional ground fog simulation is missing');
assert.ok(entrySource.includes('dayTime:13.5'), 'default scene time must be sunny midday');
assert.ok(html.includes('id="weatherGroundFog"')&&html.includes('id="sceneGroundFog"'), 'ground fog controls must be exposed in Weather and Scene Look');
assert.ok(entrySource.includes("if(typeof saved.groundFog==='boolean')weatherSystem.setGroundFog(saved.groundFog)"), 'ground fog preference must restore with project weather settings');
pass('sunny midday default, atmospheric god rays and persistent optional ground fog are present');
assert.ok(!entrySource.includes("weather-open'))setWeatherPanelOpen(false)"), 'changing to skier / drone mode must not forcibly close weather settings');
assert.doesNotMatch(html,/#[^\n]*skier-mode #weatherPanel[^\n]*display:none|#[^\n]*drone-mode #weatherPanel[^\n]*display:none/, 'weather panel must remain available in skier and drone modes');
assert.ok(html.includes('#app.weather-open #weatherPanel{display:block}'), 'weather panel open state CSS missing');
const modulePaths = [entryPath, ...localImports.map(p => resolve(dirname(entryPath), p))];
for (const path of modulePaths) {
  assert.ok(existsSync(resolve(root, path)), 'missing local JS import: ' + path);
  const source = read(path).toString('utf8');
  const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], {
    input: source, encoding: 'utf8'
  });
  assert.equal(syntax.status, 0, 'JavaScript syntax error in ' + path + ':\n' + (syntax.stderr || syntax.stdout));
  pass('JavaScript syntax valid: ' + path);
}

const opticsPath = 'camera-optics.v2.js';
assert.match(entrySource, /camera-optics\.v2\.js/, 'active app must load the current camera optics module');
const opticsSource = read(opticsPath).toString('utf8');
const lensFragmentMatch = opticsSource.match(/fragmentShader:\s*\x60([\s\S]*?)\x60/);
assert.ok(lensFragmentMatch, 'lens fragment shader is missing');
const lensMainMatch = lensFragmentMatch[1].match(/void main\s*\(\s*\)\s*\{([\s\S]*?)\n    \}/);
assert.ok(lensMainMatch, 'lens fragment shader main() is missing');
const shaderLocals = [...lensMainMatch[1].matchAll(/\b(?:float|int|bool|vec[234]|mat[234])\s+([A-Za-z_]\w*)\b/g)].map(match => match[1]);
const duplicateShaderLocals = shaderLocals.filter((name, index) => shaderLocals.indexOf(name) !== index);
assert.deepEqual([...new Set(duplicateShaderLocals)], [], 'duplicate GLSL local declarations in lens main(): ' + [...new Set(duplicateShaderLocals)].join(', '));
assert.ok(opticsSource.includes('this._markComposerFailed('), 'post-processing failure fallback is missing');
assert.ok(opticsSource.includes('if (!this.enabled || this.composerFailed)'), 'camera optics must keep direct rendering available when post-processing fails');
assert.ok(opticsSource.includes('this.syncComposerSize();'), 'composer size must use the allocation guard');
pass('camera optics GLSL declarations and direct-render fallback are valid');

const sceneLookKeys = ['general','environment','camera','color','materials','render','trees','spawn'];
assert.ok(html.includes('role="tablist" aria-label="Scene Look categories"'), 'Scene Look tablist is missing');
for (const key of sceneLookKeys) {
  assert.ok(html.includes('data-look-tab="' + key + '"'), 'Scene Look tab missing: ' + key);
  assert.ok(html.includes('data-look-panel="' + key + '"'), 'Scene Look tab panel missing: ' + key);
}
assert.ok(html.includes('scene-editor-gear'), 'Scene Editor gear icon is missing');
assert.ok(html.includes('aria-label="Scene Editor"'), 'Scene Editor icon button needs an accessible label');
assert.ok(entrySource.includes('function bindSceneLookTabs()')&&entrySource.includes("spawn:['SKIER SPAWN POINTS','10 START SLOTS · POSITION & DIRECTION']")&&entrySource.includes("previousTab==='spawn'&&name!=='spawn'&&skierSpawnPlacementStep"), 'Scene Look Spawn tab label and safe placement cancellation are missing');
assert.ok(html.includes('id="sceneLookPanelTitle"') && html.includes('id="sceneLookPanelSubtitle"'), 'active Scene Look tab heading must stay visible above panels');
assert.ok(html.includes('id="sceneLookFxStatus"'), 'live post-processing status badge is missing');
assert.ok(html.includes('class="scene-look-reset"'), 'Scene Look reset action should be accessible from the section header');
assert.ok(html.includes('scene-look-subsection'), 'Lens controls need grouped inspector sections');
assert.ok(entrySource.includes('function updateSceneLookRangeFill()'), 'scene look range feedback is missing');
assert.ok(entrySource.includes('fxStatus.textContent=live?'), 'live post-processing status must reflect runtime settings');
assert.ok(html.includes('scene-look-tab-icon" aria-hidden="true"><svg'), 'Scene Look tabs must use consistent inline SVG icons');
assert.ok(html.includes('scene-look-switches input[type=checkbox]:checked'), 'Scene Look toggles need styled on/off states');
assert.ok(html.includes('class="editor-section scene-look-section" aria-label="Global Scene Look"'), 'Scene Look should not require a nested accordion');
pass('Scene Look finishing polish, live status, grouped Lens controls and range feedback are present');

assert.ok(!html.includes('Библиотека PBR-пресетов')&&!html.includes('ПРИМЕНИТЬ PBR-ПРЕСЕТ'), 'visible PBR preset workflow must remain removed');
assert.ok(!html.includes('<label for="editorTextureType">Тип карты</label>'), 'texture map type dropdown must remain removed');
for(const mapType of ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap']){
  assert.ok(html.includes('data-texture-card="'+mapType+'"'), 'independent texture card missing: '+mapType);
  assert.ok(html.includes('id="editorTexturePreview-'+mapType+'"'), 'texture preview missing: '+mapType);
  assert.ok(entrySource.includes("button.dataset.textureImport")&&entrySource.includes("button.dataset.textureRemove"), 'independent texture card actions are not wired');
}
assert.ok(html.includes('id="materialLibraryWindow"')&&html.includes('id="materialLibraryGrid"'), 'separate shared material library window is missing');
assert.ok(html.includes('id="openMaterialLibrary"')&&entrySource.includes('function renderMaterialLibraryWindow()'), 'Hypershade-style material library launcher / renderer missing');
assert.ok(entrySource.includes('function refreshEditorTexturePreviews('), 'material slot texture preview refresh is missing');
assert.ok(entrySource.includes("document.getElementById('materialLibraryAssign').addEventListener('click',assignEditorLibraryMaterial)"), 'floating material library assignment action is missing');
const sceneTabOrder=[...html.matchAll(/id="sceneLookTab-([^"]+)"/g)].map(match=>match[1]);
assert.ok(sceneTabOrder.indexOf('materials')<sceneTabOrder.indexOf('camera'), 'Materials tab must appear before Camera');
pass('Scene Editor material cards, separate Hypershade library, and Camera / Materials tab order are present');

assert.ok(html.includes('id="scene-editor-window-fit-v131"'), 'Scene Editor fit / responsive CSS layer is missing');
assert.ok(html.includes('grid-template-columns:repeat(3,minmax(0,1fr))!important'), 'Scene Editor tabs must use a responsive three-column desktop grid');
assert.ok(html.includes('white-space:normal')&&html.includes('overflow-wrap:anywhere'), 'Scene Editor labels must wrap instead of being clipped');
assert.ok(html.includes('height:112px')&&html.includes('top:270px!important'), 'mobile Scene Editor hierarchy and inspector must use separate non-overlapping rows');
assert.ok(entrySource.includes("if(open&&state.mode!=='overview')")&&entrySource.includes("setSceneMode('overview');"), 'opening Scene Editor from skier / drone must switch to overview');
pass('Scene Editor desktop / tablet / mobile fit guards and overview-on-open behavior are present');

assert.ok(html.includes('id="mobileControls"')&&html.includes('id="mobileMoveStick"')&&html.includes('id="mobileLookStick"'), 'mobile control layer and virtual sticks are missing');
for(const id of ['overviewMode','skierMode','droneModeButton'])assert.ok(html.includes('id="'+id+'"'), 'mobile mode selector missing: '+id);
assert.ok(html.includes('grade-optimizer-mobile-mode-v132'), 'mobile-only toolbar and control styling is missing');
assert.ok(html.includes('#app.mobile-mode #homeBtn,#app.mobile-mode #measureBtn{display:none!important}'), 'mobile mode must hide desktop-only home and measure tools');
assert.ok(entrySource.includes("window.matchMedia('(pointer: coarse) and (max-width: 900px), (pointer: coarse) and (max-height: 520px)'"), 'mobile mode must detect coarse touch phone viewports');
assert.ok(entrySource.includes('controls.enableZoom=enabled'), 'mobile overview must support pinch zoom');
assert.ok(entrySource.includes('function bindMobileStick(')&&entrySource.includes('updateMobileMoveKeys(dx,dy)'), 'virtual movement and look sticks must be wired');
assert.ok(entrySource.includes('mobileTouch.lookX*1.05*dt')&&entrySource.includes('mobileTouch.lookX*1.65*dt'), 'right mobile stick must drive drone and skier camera direction');
assert.ok(read('skier-controller.v94.js').toString('utf8').includes('this.touchMode = false')&&read('skier-controller.v94.js').toString('utf8').includes('if(requestPointerLock&&!this.touchMode){'), 'skier Pointer Lock must be disabled on mobile and deferable during async preparation');
assert.ok(read('drone-controller.v76.js').toString('utf8').includes('this.touchMode=false')&&read('drone-controller.v76.js').toString('utf8').includes('if(!this.touchMode){'), 'drone Pointer Lock must be disabled on mobile');
pass('mobile-only 3-mode navigation, touch sticks, action buttons and Pointer Lock-free controls are present');



assert.ok(!html.includes('id="sceneLookTab-optics"') && !html.includes('id="sceneLookPanel-optics"'), 'separate Optics tab must remain removed');
assert.ok(!html.includes('id="sceneLookTab-lens"') && !html.includes('id="sceneLookPanel-lens"'), 'separate Lens tab must remain removed');
assert.ok(html.includes('id="sceneLookTab-camera"') && html.includes('id="sceneLookPanel-camera"'), 'combined Camera / Lens / Optics tab is missing');
const cameraPanelStart = html.indexOf('data-look-panel="camera"');
const cameraPanelEnd = html.indexOf('</section>', cameraPanelStart);
const cameraPanelHtml = html.slice(cameraPanelStart, cameraPanelEnd);
for (const control of ['sceneCameraFov','sceneExposure','sceneWhiteBalance','sceneFocusMode','sceneFocusDistance','sceneAperture','sceneVignette','sceneChromatic','sceneDistortion','sceneGrain','sceneSharpness','sceneOpticsEnabled','sceneBokeh','sceneFlareEnabled','sceneBloom','sceneBloomThreshold','sceneFlare','sceneDirt']) {
  assert.ok(cameraPanelHtml.includes('id="' + control + '"'), 'combined Camera panel is missing ' + control);
}
assert.ok(html.includes('CAMERA · LENS · OPTICS'), 'Camera tab label must indicate its combined contents');
assert.ok(html.includes('grid-template-columns:repeat(3,minmax(0,1fr))'), 'Scene Look category-card grid is missing');
assert.ok(html.includes('scene-look-tab-meta'), 'Scene Look category cards need second-line labels');
assert.ok(entrySource.includes("const OPTICS_STORAGE_KEY = 'grade_optimizer_optics_v3'"), 'optics setting migration version is missing');
assert.ok(entrySource.includes("currentOptics?['enabled','flare','bokeh','sunEnabled']:['enabled','flare','sunEnabled']"), 'legacy optics migration must leave depth of field disabled');
assert.ok(entrySource.includes("['sceneOpticsEnabled','enabled'],['sceneFlareEnabled','flare'],['sceneBokeh','bokeh']"), 'Scene Editor must own enable / flare / DOF controls');
assert.ok(entrySource.includes("let activeSceneLookTab='camera'"), 'combined Camera tab must be the default active view');
pass('six Scene Editor tabs with Camera / Lens / Optics combined and DOF-off migration are present');


assert.ok(entrySource.includes("['ArrowLeft','ArrowRight','Home','End']"), 'Scene Look keyboard navigation is missing');
assert.ok(html.includes('id="sceneQuality"') && html.includes('id="sceneToneMapping"'), 'render settings must remain available in the Render tab');
pass('Sketchfab-style Scene Look tabs, keyboard navigation and gear button are present');

const assetPath = 'assets/trees/snowy_conifer_atlas.webp';
const webp = read(assetPath);
assert.equal(webp.toString('ascii', 0, 4), 'RIFF', 'tree atlas is not a RIFF image');
assert.equal(webp.toString('ascii', 8, 12), 'WEBP', 'tree atlas is not WebP');
assert.equal(webp.toString('ascii', 12, 16), 'VP8X', 'tree atlas must use the extended WebP header');
const flags = webp[20];
const read24 = offset => webp[offset] | (webp[offset + 1] << 8) | (webp[offset + 2] << 16);
const width = read24(24) + 1;
const height = read24(27) + 1;
assert.equal(width, 1632, 'unexpected tree atlas width');
assert.equal(height, 1200, 'unexpected tree atlas height');
assert.ok(flags & 0x10, 'tree atlas must contain an alpha channel');
pass('tree atlas is valid RGBA WebP (' + width + 'x' + height + ', ' + webp.length + ' bytes)');

assert.match(entrySource, /snowy_conifer_atlas\.webp/, 'active app must load the generated tree atlas');
assert.match(entrySource, /AI_PINE_VARIANTS\s*=\s*\[/, 'tree variants array missing');
assert.match(entrySource, /new THREE\.InstancedMesh\(geometry,material,variantTrees\.length\)/, 'single-plane instanced tree mesh missing');
assert.doesNotMatch(entrySource, /_Cross|geoB\.rotateY\(Math\.PI\s*\*\s*0\.5\)/, 'crossed tree billboards reintroduced');
const aiForestStart=entrySource.indexOf('if(aiPineTextures&&aiPineTextures.length===AI_PINE_VARIANTS.length){');
const aiForestEnd=entrySource.indexOf('const mesh=new THREE.InstancedMesh(geometry,material,variantTrees.length)',aiForestStart);
assert.ok(aiForestStart>=0&&aiForestEnd>aiForestStart,'AI tree atlas rendering branch missing');
const aiForestMaterialSource=entrySource.slice(aiForestStart,aiForestEnd);
assert.ok(aiForestMaterialSource.includes('new THREE.MeshStandardMaterial'), 'AI tree billboards must respond to scene lighting');
assert.doesNotMatch(aiForestMaterialSource,/MeshBasicMaterial|toneMapped:false/, 'AI tree billboards must not bypass daylight / tone mapping');
assert.ok(aiForestMaterialSource.includes('emissiveMap:treeTexture')&&aiForestMaterialSource.includes('emissiveIntensity:forestEmissiveIntensity'), 'AI trees must use texture-matched dynamic fill');
assert.ok(entrySource.includes('function updateForestDaylight(daylight)')&&entrySource.includes('updateForestDaylight(daylight)'), 'tree brightness must follow the day/night cycle');
const forestLightingStateIndex=entrySource.indexOf('let treeLightingMaterials = [];');
const initialDaylightApplyIndex=entrySource.indexOf('setTimeOfDay(state.dayTime);');
assert.ok(forestLightingStateIndex>=0&&initialDaylightApplyIndex>forestLightingStateIndex, 'forest daylight state must initialize before the first setTimeOfDay / updateDaylight call');
assert.ok(entrySource.includes('treeLightingMaterials.push(material)'), 'AI tree materials must be registered for dynamic daylight updates');
assert.ok(entrySource.includes('emissiveMap:map, emissiveIntensity:forestEmissiveIntensity'), 'fallback billboard trees must receive daylight-matched fill');
assert.ok(entrySource.includes('emissive:0x4d875c, emissiveIntensity:forestEmissiveIntensity'), 'procedural 3D tree foliage must receive daylight-matched fill');
assert.match(entrySource, /loadSequence=\+\+slopeLoadSequence/, 'stale slope-load guard missing');
assert.match(entrySource, /if\(document\.hidden\)/, 'background render pause missing');
assert.ok(entrySource.includes('drone-controller.v76.js'), 'active app must use the current drone controller');
const droneSource = read('drone-controller.v76.js').toString('utf8');
assert.ok(droneSource.includes('intersectObject(this.terrain,true)'), 'drone terrain raycast missing');
assert.ok(droneSource.includes('minimumTerrainClearance=2.5'), 'drone terrain clearance missing');
assert.ok(droneSource.includes('enforceTerrainClearance(nextPosition)'), 'drone movement collision guard missing');
assert.ok(droneSource.includes('terrainBoundsMargin=100'), 'drone 100 m terrain bounds margin missing');
assert.ok(droneSource.includes('clampToTerrainBounds(this.camera.position)'), 'drone entry position is not clamped to the terrain bounds');
assert.ok(droneSource.includes('clampToTerrainBounds(nextPosition)'), 'drone movement is not clamped to the terrain bounds');
assert.ok(entrySource.includes('function fitModeHudToViewport(){'), 'viewport-aware HUD fitting function missing');
assert.ok(entrySource.includes('new ResizeObserver(scheduleModeHudFit)'), 'HUD resize observer missing');
assert.ok(entrySource.includes('skier-controller.v99.js'), 'active app must use the stable terrain-contact skier controller');
const skierSource = read('skier-controller.v99.js').toString('utf8');
const skierContactUtils = read('skier-terrain-contact.v1.js').toString('utf8');
const skierContactTests = read('scripts/test-skier-terrain-contact.mjs').toString('utf8');
assert.ok(skierContactTests.includes('overlapping piste and terrain choose the surface continuous with the skier height')&&skierContactTests.includes('near-vertical wall normals are rejected'), 'skier terrain-contact regression tests must cover surface transitions and wall rejection');
assert.ok(skierSource.includes('respawnAtCustomSpawn(spawn)')&&skierSource.includes('spawnHint.headingYaw'), 'skier controller must apply custom spawn position and heading');
assert.ok(entrySource.includes('function isPreferredStageOneSkierSlopeAsset(')&&entrySource.includes("normalized.includes('slopes_stage1')")&&entrySource.includes('const preferredSlope=state.importedAssets.find('), "imported Slopes_Stage1 geometry must take priority as the skier surface");
assert.ok(entrySource.includes('position:dronePose.position,yaw:dronePose.yaw,velocity:dronePose.velocity,fromDrone:true')&&entrySource.includes('resolveSkierTerrainForDroneSpawn(dronePose.position)')&&entrySource.includes('skierTerrainName:skierController.terrain?.name')&&entrySource.includes('skierSpawn:skierController.lastSpawnInfo')&&!entrySource.includes('velocity:dronePose.velocity,fromDrone:true,startAtTop:true'), 'drone handoff must try the drone world position before the summit fallback');
assert.ok(!entrySource.includes('droneController.setTerrain(terrain);\\n    applySkierPresentation();'), 'using a dedicated skier piste must not replace the drone collision surface');
assert.ok(skierSource.includes('if(spawnHint?.position&&!spawnHint.startAtTop)'), 'explicit summit respawn must ignore the drone camera position');
assert.ok(entrySource.includes('function hasTerrainSurfaceAtWorldXZ(')&&entrySource.includes('hasTerrainSurfaceAtWorldXZ(originalTerrain,position)')&&entrySource.includes('return droneSpawnSurfaceRaycaster.intersectObject(terrain,true).some(hit=>hit.object?.isMesh)'), 'drone handoff must resolve the actual surface under exact drone X/Z on Stage 1 or original Terrain');
assert.ok(skierSource.includes('const hit=Number.isFinite(droneX)&&Number.isFinite(droneZ)')&&skierSource.includes('this._groundAt(droneX,droneZ)')&&!skierSource.includes('_findGroundNear('), 'drone handoff must project vertically at the exact drone X/Z without a nearby piste search');
assert.ok(skierSource.includes('respawnAtTop(){')&&skierSource.includes("this.lastSpawnInfo={...this.lastSpawnInfo,spawnType:'stage1-summit'}"), 'key 1 summit respawn must reuse the cached terrain lookup');
assert.ok(entrySource.includes('const spawnKey=getSkierSpawnKeyFromEvent(e)')&&entrySource.includes("if(spawnKey==='1')")&&entrySource.includes('respawnSkierAtStageOneSummit()')&&entrySource.indexOf('if(spawnKey&&state.skierSpawns?.[spawnKey])')<entrySource.indexOf("if(spawnKey==='1')"), 'key 1 must use its configured spawn when present and keep the Stage 1 summit fallback when slot 1 is empty');
assert.ok(html.includes('Спавн на вершине Stage 1'), 'skier HUD must explain the key 1 summit spawn');
assert.ok(skierSource.includes('const topSamples=candidates.slice(0,Math.min(180,candidates.length));')&&!skierSource.includes('0.334')&&!skierSource.includes('0.187'), 'piste spawn search must prefer the highest mesh vertices instead of the old fixed A1 seed');
assert.ok(skierSource.includes('const clearance=this._downhillClearance(hit.point.x,hit.point.z,hit.normal,[6,12,18,26]);')&&skierSource.includes('lastSpawnInfo={'), 'summit spawn must validate a downhill run and expose its world position');
pass('Slopes_Stage1 is prioritized for skier physics and spawn selection starts at its highest skiable point');

assert.ok(skierSource.includes('const idleYaw=this.headingYaw;')&&!skierSource.includes('const idleYaw=this.headingYaw+this.lookYaw;'), 'third-person camera orbit must not rotate the skier or ski rig at low speed');
const droneSpawnStart=skierSource.indexOf('if(isDroneSpawn){');
const droneSpawnEnd=skierSource.indexOf('}else if(spawnHint?.position',droneSpawnStart);
const droneSpawnBlock=droneSpawnStart>=0&&droneSpawnEnd>droneSpawnStart?skierSource.slice(droneSpawnStart,droneSpawnEnd):'';
assert.ok(droneSpawnBlock.includes('this._groundAt(droneX,droneZ)')&&!droneSpawnBlock.includes('_isUsableSkiStart')&&!droneSpawnBlock.includes('_findSpawn()'), 'drone spawn must accept any ground surface at exact X/Z without piste-angle or runout tests');
assert.ok(droneSpawnBlock.includes('this.lookYaw=0;')&&droneSpawnBlock.includes('this.lookPitch=-0.035;')&&droneSpawnBlock.includes('this.headingYaw=Number.isFinite(yaw)'), 'drone-to-skier handoff must use the fall-line on slopes and drone yaw on flat ground');
pass('skier camera orbit is decoupled from ski heading; drone handoff starts looking along the skis');

assert.ok(skierSource.includes('async _buildTerrainLookup(')&&skierSource.includes('requestAnimationFrame(resolve)'), 'terrain index must build asynchronously in responsive chunks');
assert.ok(skierSource.includes('const cols=192,rows=192')&&skierSource.includes('const cells=new Array(cols*rows)'), 'terrain lookup must use a finer compact spatial grid');
assert.ok(skierSource.includes('async start(terrain,spawnHint=null')&&skierSource.includes('await this._buildTerrainLookup('), 'skier startup must await incremental terrain indexing');
assert.ok(skierSource.includes('this.terrainBuildToken++'), 'stopping skier mode must cancel pending terrain indexing');
assert.ok(!skierSource.includes('const skiGround=this._groundAt('), 'ski model positioning must not run an extra ground query every frame');
const lookupQueryIndex=skierSource.indexOf('const lookupHit=this._groundFromLookup(x,z,referenceY,maxVerticalDelta);');
const raycastIndex=skierSource.indexOf('this.raycaster.intersectObject(this.terrain,true)');
assert.ok(lookupQueryIndex>=0&&raycastIndex>lookupQueryIndex, 'skier ground queries must use continuity-aware spatial lookup before Raycaster fallback');
assert.ok(skierSource.includes('faceNormal.y<MIN_TERRAIN_NORMAL_Y')&&skierSource.includes('MIN_SMOOTH_NORMAL_ALIGNMENT'), 'terrain contact must reject vertical walls and unreliable interpolated normals');
assert.ok(skierSource.includes('groundedReferenceY')&&skierSource.includes('expectedNextGroundY')&&skierSource.includes('maxVerticalDelta'), 'ground sampling must preserve height continuity when switching between slope and terrain meshes');
assert.ok(skierSource.includes('_smoothGroundNormal(nextHit.normal,dt)')&&skierSource.includes('new THREE.Matrix4().makeBasis(right,normal,back)'), 'skier orientation must be smoothed and re-orthogonalized at terrain transitions');
assert.ok(skierSource.includes('this._isTerrainCollisionMesh(object)')&&skierContactUtils.includes('selectGroundContactCandidate'), 'only visible valid collision meshes may become skier support surfaces');
assert.ok(skierContactUtils.includes('MIN_TERRAIN_NORMAL_Y')&&skierContactUtils.includes('blendGroundNormal'), 'engine-independent terrain-contact stability helpers are present');
assert.ok(entrySource.includes('function isVisibleSkierPhysicsObject(')&&entrySource.includes('An active imported Terrain replaces the hidden base terrain')&&entrySource.includes('remove.forEach(object=>object.parent?.remove(object))'), 'skier collision composite must exclude hidden mesh geometry and not collide with stale base terrain');
assert.ok(skierSource.includes('stats.raycastFallbacks++')&&skierSource.includes('getTerrainPerformanceDiagnostics()'), 'terrain lookup performance counters and diagnostics API are missing');
const thirdPersonGuardIndex=skierSource.indexOf('const needsThirdPerson=this.viewBlendTarget>0.001||this.viewBlend>0.001;');
const cameraGroundIndex=skierSource.indexOf(':this._groundAt(cameraX,cameraZ);');
assert.ok(thirdPersonGuardIndex>=0&&cameraGroundIndex>thirdPersonGuardIndex, 'third-person camera terrain query must be skipped in first-person view');
assert.ok(skierSource.includes('outline.lineTo(-0.050,0.8475)')&&skierSource.includes('outline.quadraticCurveTo(-0.048,1.7475,0,1.9125)')&&skierSource.includes('new THREE.BoxGeometry(0.009,0.004,1.7875)'), 'front ski overhang must be 1.5x longer while bindings and tails stay fixed');
assert.ok(skierSource.includes("const outsideLoad=Math.max(0,side*turnSide)*carve*(0.85+0.15*loadShift);")&&skierSource.includes("'skiFlex'+index"), 'ski flex must compute outside-ski load within each ski-slot iteration');

assert.ok(entrySource.includes("velocity:droneController.velocity.clone()"), 'drone-to-skier handoff must preserve the drone pose and velocity');
assert.ok(entrySource.includes('await skierController.start(terrain,spawnHint,{'), 'skier mode must await incremental terrain preparation');
const modeSwitchSource=entrySource.slice(entrySource.indexOf('async function setSceneMode'),entrySource.indexOf('window.__GRADE_OPTIMIZER_MODE_API=Object.freeze('));
assert.ok(modeSwitchSource.includes('skierModePreparing=true')&&modeSwitchSource.includes('requestPointerLock:false'), 'skier preparation must be guarded without seizing the overview mouse');
assert.ok(!modeSwitchSource.includes("sceneLoadingEl.style.display='flex'")&&!modeSwitchSource.includes("state.mode='loading'"), 'switching to skier must not show a blocking full-screen loading layer');
assert.ok(entrySource.includes('runtimePerformance.skierUpdateMs')&&entrySource.includes('runtimePerformance.renderMs'), 'runtime FPS and frame timing diagnostics missing');
assert.ok(entrySource.includes('controls.enabled=true;')&&entrySource.includes("sceneLoadingEl.style.display='none';"), 'initial overview must restore OrbitControls before hiding its splash screen');
assert.ok(!entrySource.includes('modeTransition'), 'mode changes must not be blocked by a stale cinematic transition');
assert.ok(entrySource.includes("if(state.mode==='skier'){")&&entrySource.includes("skierController.update(dt);"), 'skier physics must update every frame once skier mode is active');
assert.ok(entrySource.includes("if(resumePendingSkier)requestAnimationFrame(()=>setSceneMode('skier'))"), 'queued skier request must resume after initial splash removal');
assert.ok(skierSource.includes('_downhillClearance('), 'skier spawn must validate continuous downhill terrain');
assert.ok(skierSource.includes('if(!spawnFound&&!isDroneSpawn){')&&skierSource.includes('this._findSpawn(slot)')&&skierSource.includes("this.lastStartError='NO_GROUND_UNDER_DRONE'"), 'drone handoff must never silently relocate to a distant piste when no ground exists beneath it');
assert.ok(skierSource.includes('this.velocity.copy(downhill).multiplyScalar(initialSpeed)'), 'drone-to-skier handoff must begin with controlled downhill motion');

assert.ok(skierSource.includes("tuck: this.keys.has('w') || this.keys.has('arrowup')"), 'skier tuck state missing from HUD payload');
assert.ok(skierSource.includes('pushing:push&&!airborne,airborne,tuck'), 'skier push, airborne and stance state missing from movement HUD payload');
assert.ok(droneSource.includes('boostSpeed=200/3.6'), 'drone boost must cap at 200 km/h');
assert.ok(droneSource.includes("this.keys.has('shift')?this.boostSpeed:this.speed"), 'Shift must activate drone boost');
assert.ok(droneSource.includes("(this.keys.has('control')?1:0)"), 'Ctrl must control drone descent');
assert.ok(entrySource.includes("tuck?'Скоростная стойка':'Обычная езда'"), 'ordinary skiing / speed tuck status labels missing from HUD');
assert.ok(entrySource.includes("panel.content.style.setProperty('display',visible?'grid':'none','important')"), 'tutorial visibility must force display state');
assert.ok(skierSource.includes('this._tryBumpJump(this.velocity.length())'), 'skier bump jump must be integrated into movement');
assert.ok(skierSource.includes('speed<14.5||this.lastLongitudinalAccel<2.8'), 'bump jump must require high speed and strong acceleration');
assert.ok(skierSource.includes('this.airborneVelocityY=this.velocity.y+this.bumpJumpImpulseNs/this.massKg'), 'bump jump lift must remain small and ballistic');
assert.ok(skierSource.includes('this.jumpCooldown=1.2'), 'bump jump cooldown missing');
assert.ok(skierSource.includes('this.position.y+this.eyeHeight+this.airborneHeight'), 'camera must lift during a jump');
assert.ok(skierSource.includes('setSkiModel(source)'), 'skier model replacement API missing');
assert.ok(skierSource.includes("'Helmet_Shell'"), 'detailed skier helmet shell is missing');
assert.ok(skierSource.includes("'Goggle_Lens'"), 'reflective skier goggles are missing');
assert.ok(skierSource.includes("this.avatarArms.push({shoulder:armRoot,elbow:elbowPivot,pole:poleRoot,side})"), 'articulated ski-pole arms are missing');
assert.ok(skierSource.includes("this.avatarLegs.push({hip:leg,knee:lowerLeg,side})"), 'articulated knee rig is missing');
assert.ok(skierSource.includes('this.avatarPushPulse=1'), 'pole-push animation trigger is missing');
assert.ok(skierSource.includes('arm.pole.rotation.x'), 'pole stroke animation is missing');
assert.ok(skierSource.includes('leg.knee.rotation.x'), 'knee flex animation is missing');
assert.ok(skierSource.includes('slot.group.rotation.z'), 'ski edging animation is missing');
assert.ok(skierSource.includes('this.avatarPelvis.rotation.z'), 'pelvis counter-rotation during carving is missing');
assert.ok(skierSource.includes("smooth('carveWeight'") && skierSource.includes("smooth('turnDirection'"), 'turn compression and direction must be smoothed separately');
assert.ok(skierSource.includes('const sharedKneeFlex=0.17*carve'), 'both knees must flex under carving load');
assert.ok(skierSource.includes('const insideKneeFlex=0.27*insideLoad'), 'inside knee must fold deeper in an alpine turn');
assert.ok(skierSource.includes('const outsideSupport=-0.025*outsideLoad'), 'outside leg must retain a longer support stance');
assert.ok(/smooth\(\s*'kneeX'\+index,[\s\S]{0,260}?6\.2\s*\)/.test(skierSource), 'knee articulation must use damped transitions');
assert.ok(skierSource.includes('this.avatarPelvis.position.y=this.avatarPelvisBaseY-pelvisCompression'), 'pelvis compression must use a stable base position');
assert.ok(skierSource.includes('const kneeLateralLean=turnLean*(0.085+speedBlend*0.035)'), 'both knees must angle smoothly toward the slope on left and right turns');
assert.ok(skierSource.includes('turnLean*(0.055+speedBlend*0.035)'), 'hip / knee alignment must share the signed turn direction');
assert.ok(skierSource.includes('const fullyVisible=blend>=0.995'), 'skier materials must switch to opaque rendering when fully visible');
assert.ok(skierSource.includes('mat.depthWrite=fullyVisible') && skierSource.includes('mat.needsUpdate=true'), 'fully visible skier materials must write depth to prevent distance-dependent part loss');
assert.ok(skierSource.includes('object.frustumCulled=false'), 'skier avatar parts must not be culled independently');
assert.ok(entrySource.includes('dayTime:13.5'), 'default scene time must start at sunny midday 13:30');
assert.match(html, /id="timeOfDay"[^>]*value="13.5"/, 'default time slider must start at 13:30');
assert.ok(html.includes('id="timeValue">13:30') && html.includes('id="timeCompactValue">13:30'), 'both default time labels must show 13:30');
assert.ok(html.indexOf('id="weatherToggle"') < html.indexOf('id="editorToggle"'), 'cloud weather button must be placed immediately before the gear');
assert.ok(html.includes('class="weather-icon-button"') && html.includes('class="weather-cloud-icon"'), 'weather control must use its compact cloud icon');
assert.ok(skierSource.includes("'Kneepad_Upper_Strap'") && skierSource.includes("'Kneepad_Lower_Stitch'"), 'layered knee protection details are missing');

assert.ok(skierSource.includes("smooth('torsoRoll'"), 'damped turn lean animation is missing');
assert.ok(skierSource.includes("smooth('poleZ'"), 'damped ski-pole turn animation is missing');
assert.ok(skierSource.includes("this.eyeHeight = 2.05"), 'first-person eye-height correction is missing');
assert.ok(skierSource.includes('this.viewBlend=0;') && skierSource.includes('this.stanceCameraBlend=0;'), 'first-person view and tuck state must reset at skier spawn');
assert.ok(skierSource.includes('this.position.y+this.eyeHeight+this.airborneHeight-0.26*this.stanceCameraBlend'), 'first-person eye point must remain above skis in tuck');

assert.ok(skierSource.includes('this.massKg = 75;'), 'skier reference mass must be 75 kg');
assert.ok(skierSource.includes('this.maxEdgeG = 1.25;'), 'turn edge-force ceiling missing');
assert.ok(skierSource.includes('this.pushImpulseNs = 90;') && skierSource.includes('this.pushInterval = 0.42'), 'pole push must use a mass-scaled impulse');
assert.ok(skierSource.includes("if (e.code === 'Space')"), 'Space jump key handler missing');
assert.ok(skierSource.includes('if (!e.repeat && this.inputEnabled) this._tryManualJump();'), 'Space must trigger once per press and respect transition lock');
assert.ok(skierSource.includes('this.manualJumpImpulseNs = 255;'), 'manual jump impulse missing');
assert.ok(skierSource.includes('this.airborneVelocityY=this.velocity.y+this.manualJumpImpulseNs/this.massKg;'), 'take-off speed must be impulse divided by mass');
assert.ok(skierSource.includes('this.airborneWorldY=contact.point.y+0.055;'), 'jump must start at ski contact height');
assert.ok(skierSource.includes('this.velocity.y=0;'), 'launch must transfer slope-tangent vertical speed into the flight state');
assert.ok(skierSource.includes('new THREE.Vector3(this.velocity.x,this.airborneVelocityY,this.velocity.z)'), 'flight drag must use full 3D velocity');
assert.ok(skierSource.includes('this.airborneVelocityY+=acceleration.y*dt;'), 'air drag must affect vertical flight speed');
assert.ok(skierSource.includes('const verticalTravelVelocity=this.airborneWorldY!==null?this.airborneVelocityY:this.velocity.y;'), 'camera pitch must follow the actual vertical travel speed');
assert.ok(skierSource.includes('this.jumpCooldown=0.68;'), 'manual jump cooldown missing');
assert.ok(skierSource.includes('const contact=this._groundAt(this.position.x,this.position.z);'), 'manual jump must confirm snow contact');
assert.ok(skierSource.includes('Flight uses true 3D velocity; slope-tangent vertical speed is folded in at take-off.'), 'airborne state must not apply ski-snow contact forces');
assert.ok(skierSource.includes('const normalForceN=airborneAtStart?0:this.massKg*normalAcceleration;'), 'normal support force must include skier mass');
assert.ok(skierSource.includes('maxLateralForceN=this.maxEdgeG*normalForceN;'), 'turning must be limited by ski edge force');
assert.ok(skierSource.includes('this.totalSkiLoadN=Math.hypot(this.normalForceN,this.lateralForceN);'), 'combined ski load must include normal and lateral reaction');
assert.ok(skierSource.includes('this.outsideLoadShare=steer!==0?0.5+0.1*edgeDemand:0.5;'), 'carving must transfer pressure toward the outside ski');
assert.ok(skierSource.includes('this.landingPulse=THREE.MathUtils.clamp(impactSpeed/3.5,0,1);'), 'terrain-aware landing response missing');
const referenceMassKg=75;
const bodyWeightN=referenceMassKg*9.81;
const maxLateralForceN=bodyWeightN*1.25;
const combinedTurnLoadN=Math.hypot(bodyWeightN,maxLateralForceN);
assert.ok(combinedTurnLoadN>1150&&combinedTurnLoadN<1200, 'maximum modeled ski reaction must remain physically bounded');
assert.ok(Math.abs((combinedTurnLoadN*0.6)/(combinedTurnLoadN*0.4)-1.5)<1e-9, 'outside ski must carry 1.5 times the inside ski load at the modeled limit');
const jumpTakeoffSpeed=255/referenceMassKg;
const jumpApexM=jumpTakeoffSpeed*jumpTakeoffSpeed/(2*9.81);
assert.ok(jumpApexM>0.57&&jumpApexM<0.61, 'manual jump should be a modest ~0.59 m hop');
const skierHudSource = html.slice(html.indexOf('<div id="skierHud"'), html.indexOf('<div id="droneHud"'));
assert.ok(skierHudSource.includes('<kbd>SHIFT</kbd> — толчок палками. <kbd>SPACE</kbd> — прыжок.'), 'skier tutorial must document separate push and jump keys');
assert.ok(skierHudSource.includes('<kbd>SPACE</kbd></div><div><strong>Прыжок</strong>'), 'skier control grid must show Space jump');
assert.ok(!skierHudSource.includes('<kbd>SHIFT</kbd> / <kbd>SPACE</kbd> — толчок'), 'old combined push hint must be removed');
assert.ok(skierSource.includes('const yaw=this.headingYaw;'), 'pole strokes must follow ski heading, not camera look direction');
assert.ok(skierSource.includes('if(!locked)this.keys.clear();'), 'lost pointer lock must clear stuck movement keys');
assert.ok(skierSource.includes('const grounded=!!nextHit&&!airborne;'), 'HUD grounded state must be false while airborne');
assert.ok(skierSource.includes('grounded: this.active&&this.airborneWorldY===null'), 'friction control must preserve airborne HUD state');
assert.ok(skierSource.includes('this.terrain.traverse(object=>{\n      if(!object.isMesh||!object.geometry?.attributes?.position)return;\n      if(this._isTerrainCollisionMesh(object))meshes.push(object);'), 'skier spawn search must support grouped visible Terrain meshes and skip hidden collision geometry');
assert.ok(skierSource.includes('const sampleStride=Math.max(1,Math.ceil(totalVertices/3500));'), 'grouped terrain spawn sampling must have a bounded vertex workload');
assert.ok(skierSource.includes('setSkiModel(source)') && skierSource.includes('Prepare and validate the next model completely before removing the'), 'custom ski replacement must validate before replacing the existing pair');
pass('detailed skier equipment, articulated limbs, safe input release, pole physics, terrain-group spawn and transactional ski import are present');

assert.ok(skierSource.includes('this.skiSlots.push({group:ski,board,stripe,customMount})'), 'custom ski mounts missing from both ski slots');
assert.ok(html.includes('id="importAssetCategory"'), 'model import category selector missing');
assert.ok(html.includes('accept=".glb,.fbx'), 'model import input must accept GLB and FBX');
assert.ok(html.includes('id="editorTreeExpandAll"') && html.includes('id="editorTreeCollapseAll"'), 'Outliner expand/collapse controls missing');
assert.ok(entrySource.includes('function selectEditorNode(owner,node'), 'nested Object3D selection missing');
assert.ok(entrySource.includes('editorNodeKey(owner,node)'), 'hierarchy node identity helper missing');
assert.ok(entrySource.includes('function editorNodeHasSearchMatch('), 'recursive hierarchy search missing');
assert.ok(entrySource.includes('selectEditorNode(picked,hit.object)'), 'viewport selection must target the actual nested mesh');
assert.ok(entrySource.includes('asset.sourceBuffer=buffer'), 'changed imported model must be serialized during browser autosave');
assert.ok(entrySource.includes('const asset=editorSelectedAsset,root=editorSelectedNode'), 'transform inspector must edit the selected hierarchy node');
assert.ok(entrySource.includes('nodeVisibility:collectEditorNodeVisibility(root)'), 'nested visibility must be stored in client manifest');
assert.ok(entrySource.includes('function collectEditorNodeMetadata(root)'), 'per-node metadata collector missing');
assert.ok(entrySource.includes('function applyEditorNodeMetadata(root,records)'), 'per-node metadata restore missing');
assert.ok(entrySource.includes('nodeMetadata:collectEditorNodeMetadata(root)'), 'per-node metadata must be stored in client manifest');
assert.ok(entrySource.includes('async function collectProjectEditorSettings()'), 'project-wide base scene settings serializer missing');
assert.ok(entrySource.includes('editorSettings=await collectProjectEditorSettings()'), 'client project manifest must include base scene editor settings');
assert.ok(entrySource.includes('await applySceneEditorConfig(manifest.editorSettings,{quiet:true})'), 'client workspace must restore shared base scene editor settings');
assert.ok(entrySource.includes('async function collectEditorAssetConfig('), 'shared Scene Editor configuration serializer missing');
assert.ok(entrySource.includes("materialId:materialIds.get(material)"), 'project config must preserve shared material slot identity');
assert.ok(entrySource.includes('const sharedEditorMaterials=new Map()'), 'project config loader must restore shared material identity');

assert.ok(entrySource.includes('editorMaterialSavedIds=new WeakMap()'), 'project config loader must preserve unique material slots');
assert.ok(entrySource.includes('editorTextureDataUrlPromise'), 'custom texture bytes must be retained for project persistence');
assert.ok(entrySource.includes('async function loadEditorTextureDataUrl('), 'client workspace must restore user-imported base scene textures');

const clientManifestSource = entrySource.slice(entrySource.indexOf('function collectClientManifest(slug)'), entrySource.indexOf('async function exportAssetForClientPublish'));
assert.ok(clientManifestSource.includes('nodeMetadata:collectEditorNodeMetadata(root)'), 'client manifest must persist per-node metadata');
const nodeMetadataSaveSource = entrySource.slice(entrySource.indexOf('function saveSelectedNodeMetadata()'), entrySource.indexOf('function applyEditorTransform()'));
assert.ok(nodeMetadataSaveSource.includes('owner.meta.modelDirty=true'), 'editing node Collision / Forest blocker must mark imported client model dirty');
const localFolderWriter = entrySource.slice(entrySource.indexOf('async function writeProjectSnapshotToFolder('), entrySource.indexOf('function shareClientWorkspace()'));
assert.ok(localFolderWriter.includes("clients/'+slug+'/scene.json'"), 'direct local save must write the project manifest at the GitHub Pages path');
assert.ok(localFolderWriter.includes('asset.sourceBuffer'), 'direct local save must write imported model binary files');

assert.ok(entrySource.includes('applyEditorNodeMetadata(root,item.nodeMetadata||[])'), 'client scene must restore per-node metadata');
assert.ok(entrySource.includes('const editorOriginalVisibility=new WeakMap()'), 'node visibility source defaults must be tracked');
assert.ok(entrySource.includes('if(node.visible!==defaultVisible)'), 'visibility overrides must preserve both hide and unhide operations');
assert.ok(entrySource.includes('node.visible=state.visible'), 'project loader must restore explicit visible=true and visible=false overrides');

assert.ok(html.includes('id="editorNodeRole"') && html.includes('id="editorNodeTags"'), 'per-node role / tags controls missing');
assert.ok(html.includes('id="editorNodeCollision"') && html.includes('id="editorNodeForestBlocker"'), 'per-node semantic flags missing');
assert.ok(entrySource.includes('saveSelectedNodeMetadata'), 'per-node metadata edit handler missing');
assert.ok(entrySource.includes('applyEditorNodeVisibility(root,item.nodeVisibility||[])'), 'nested visibility must be restored for client scenes');
assert.ok(entrySource.includes('function disposeEditorComponent(root)'), 'shared material-safe component deletion missing');
assert.ok(entrySource.includes("from 'three/addons/loaders/FBXLoader.js'"), 'FBXLoader import missing');
assert.ok(entrySource.includes("function parseSceneModel("), 'generic GLB/FBX parser missing');
assert.ok(entrySource.includes('function collectEditorMaterialLibrary('), 'scene-wide material library missing');
assert.ok(entrySource.includes('function assignEditorLibraryMaterial('), 'material library assignment action missing');
assert.ok(entrySource.includes('function makeEditorMaterialUnique('), 'make-unique material action missing');
const textureImportSource = entrySource.slice(entrySource.indexOf('function importEditorTextureFile('), entrySource.indexOf('function clearEditorTextureMap('));
const textureClearSource = entrySource.slice(entrySource.indexOf('function clearEditorTextureMap('), entrySource.indexOf('function applySceneEditorConfig('));
assert.ok(textureImportSource.includes('markEditorMaterialOwnersDirty(material)'), 'texture import must dirty all shared material owners');
assert.ok(textureClearSource.includes('markEditorMaterialOwnersDirty(material)'), 'texture removal must dirty all shared material owners');
const presetSource = entrySource.slice(entrySource.indexOf('function applyEditorMaterialPreset('), entrySource.indexOf('function ensureEditorAoUv('));
assert.ok(presetSource.includes('markEditorMaterialOwnersDirty(target.material)'), 'material presets must dirty all shared material owners');
assert.ok(entrySource.includes('markEditorMaterialOwnersDirty(material)'), 'shared material edits must dirty all imported model owners');
assert.ok(entrySource.includes('updateEditorMaterialLinkStatus()'), 'shared material link status indicator missing');
assert.ok(html.includes('id="editorMaterialLibrarySelect"'), 'material library selector missing');
assert.ok(html.includes('id="assignEditorMaterial"'), 'material assign button missing');
assert.ok(html.includes('id="makeEditorMaterialUnique"'), 'make-unique material button missing');
assert.ok(html.includes('id="editorMaterialLinkStatus"'), 'shared material status indicator missing');
assert.ok(entrySource.includes('fbxLoader.parse(buffer,resourcePath||\'\')'), 'FBX binary parser call missing');
assert.ok(html.includes('id="resetTerrainButton"'), 'restore original terrain button missing');
assert.ok(html.includes('id="editorScaleX"') && html.includes('id="editorScaleY"') && html.includes('id="editorScaleZ"'), 'independent XYZ model scale controls missing');
assert.ok(html.includes('id="editorRotX"') && html.includes('id="editorRotZ"'), 'full XYZ model rotation controls missing');
assert.ok(entrySource.includes('function activateImportedTerrain('), 'imported terrain activation path missing');
assert.ok(entrySource.includes('function resetImportedTerrain('), 'original terrain restoration path missing');
assert.ok(entrySource.includes('function restoreSceneAssetsLocally('), 'local GLB persistence restore path missing');
assert.ok(entrySource.includes('function saveSceneAssetLocally('), 'local GLB persistence save path missing');
assert.ok(entrySource.includes('droneController.setTerrain(asset.root)'), 'imported terrain is not connected to drone collision');
assert.ok(entrySource.includes('state.terrain=asset.root'), 'imported terrain is not connected to skier ground queries');
assert.ok(entrySource.includes("if(category==='terrain')activateImportedTerrain(asset"), 'Terrain category does not auto-activate as ground');
assert.ok(entrySource.includes('focusSceneObject(root)'), 'imported models are not framed in the viewport');
pass('generic GLB model import, persistent local assets, XYZ transforms and active terrain handoff are present');
assert.ok(html.includes('id="clientWorkspaceId"'), 'project workspace ID field missing');
assert.ok(html.includes('id="openClientWorkspaceButton"'), 'open project control missing');
assert.ok(html.includes('id="connectProjectFolderButton"'), 'local repository folder connection control missing');
assert.ok(!html.includes('githubPublisherToken')&&!html.includes('github-config.js'), 'public GitHub token setup must be removed');
assert.ok(!html.includes('exportProjectBackupButton')&&!html.includes('EXPORT PROJECT PACKAGE'), 'ZIP export UI must be removed');
assert.ok(entrySource.includes("function openClientWorkspace("), 'remote project loader missing');
assert.ok(entrySource.includes('function connectProjectFolder()'), 'local repository folder picker and permission flow missing');
assert.ok(entrySource.includes('function restoreProjectFolderHandle()'), 'persisted local directory handle restore missing');
assert.ok(entrySource.includes('function writeProjectSnapshotToFolder('), 'direct repository snapshot writer missing');
assert.ok(entrySource.includes('function writeProjectFileToFolder('), 'direct local file writer missing');
assert.ok(entrySource.includes('function scheduleProjectBrowserAutosave()'), 'browser autosave scheduler missing');
assert.ok(entrySource.includes('function autosaveProjectToBrowser('), 'browser project autosave routine missing');
assert.ok(entrySource.includes('function readProjectBrowserBackup('), 'browser backup restore routine missing');
assert.ok(entrySource.includes('showDirectoryPicker'), 'directory picker API missing');
assert.ok(entrySource.includes("requestPermission({mode:'readwrite'})"), 'read/write permission flow missing');
assert.ok(entrySource.includes('createWritable()'), 'direct filesystem writes missing');
assert.ok(entrySource.includes("projectBackupKey(slug)"), 'project manifest fallback must be stored in IndexedDB');
assert.ok(entrySource.includes("projectBackupModelKey(slug,id)"), 'model binary fallback must be stored in IndexedDB');
assert.ok(entrySource.includes('sourceBuffer:buffer.slice(0)'), 'loaded remote model bytes must remain available for local sync');
assert.ok(!entrySource.includes('githubAdminToken')&&!entrySource.includes('githubPublisherRequest('), 'app must not contain a direct GitHub token publisher');
assert.ok(!entrySource.includes('function buildStoredZip('), 'ZIP exporter must be removed from active app');
assert.ok(entrySource.includes("clients/'+slug+'/scene.json"), 'direct folder sync must write project manifest under clients/<slug>');
assert.ok(entrySource.includes("clients/'+slug+'/'+item.file"), 'published model path must remain compatible with viewer loader');
pass('browser backup and direct local repository auto-sync are present');

const mayaExporter = read('maya/grade_optimizer_exporter.py').toString('utf8');
const mayaPlugin = read('maya/plug-ins/grade_optimizer.py').toString('utf8');
assert.ok(mayaExporter.includes('VERSION = "0.9.3"'), 'Maya scene-asset exporter version must be 0.9.3');
assert.ok(mayaExporter.includes('def export_slope_centerlines(*_):') && mayaExporter.includes('def _sample_slope_curve_points(') && mayaExporter.includes('manifest["slopeCurves"]'), 'Maya raw centerline geometry export is missing');
assert.ok(entrySource.includes('function renderSlopeAnalysisOverlays(') && entrySource.includes('function applySlopeAnalysisLayerVisibility('), 'overview slope-analysis overlay renderer / layer visibility is missing');
assert.ok(entrySource.includes('function analyzeSlopeCenterline(') && entrySource.includes('SLOPE_ANALYSIS_INTERVAL_METERS = 20.0'), 'browser-side 20 m centerline analyzer is missing');
assert.ok(entrySource.includes('Math.atan2(vertical,horizontal)') && entrySource.includes('SLOPE_ANALYSIS_ANGLE_LIMITS'), 'browser-side section grade calculation / difficulty thresholds are missing');
assert.ok(entrySource.includes('function classifySlopeAnalysisRoute(') && entrySource.includes('maximum<=20.0+1e-9'), 'browser-side route classification must preserve the Maya 20% harder-category allowance');
assert.ok(entrySource.includes('indexedDB.open(\'grade-optimizer-slope-analysis\',1)') && entrySource.includes('curve.sourceDigest'), 'unchanged curve analysis must be cached persistently by Maya geometry digest');
assert.ok(entrySource.includes('await buildSlopeAnalysisFromManifest(manifest)') && entrySource.includes('manifest?.slopeCurves'), 'raw Maya centerlines must be analyzed when the project scene is loaded');
assert.ok(entrySource.includes('new THREE.LineSegments') && entrySource.includes('new CSS2DObject'), 'slope overlays must use line segments and CSS2D labels rather than meshes');
assert.ok(html.includes('.slope-analysis-angle{padding:0;border:0;border-radius:0;background:transparent;box-shadow:none;color:var(--slope-analysis-color);') && html.includes('text-shadow:none'), 'slope angle labels must be bare difficulty-coloured degree text without background, border or shadow');
assert.ok(entrySource.includes("text:Number(section.angleDegrees).toFixed(1)+'°'")&&entrySource.includes('difficulty,marker:null'), 'each 20 m angle label must retain its own section angle and difficulty colour in the lazy record');
assert.ok(entrySource.includes("black: '#000000'") && html.includes('.slope-difficulty-black{--slope-analysis-color:#000000}'), 'black difficulty angle text must render black');
assert.ok(/^app\.v\d+\.js$/.test(entryPath) && entrySource.includes("if(kind==='angle')element.style.setProperty('color',labelColor,'important')"), 'angle labels must use the cache-busted module and force each difficulty colour inline');
assert.ok(entrySource.includes('buildSlopeAngleSpatialIndex(')&&entrySource.includes('forEachSlopeAngleSpatialCandidate(')&&entrySource.includes('slopeAnalysisActiveAngleLabels'), 'slope angle labels must use a spatial index and keep only nearby DOM labels active');
assert.ok(entrySource.includes('movedSquared<2.25')&&entrySource.includes('now-slopeAnalysisAngleLabelViewCache.updatedAt<150'), 'slope angle label culling must be movement-aware and throttled');
assert.ok(!entrySource.includes('for(const marker of group.children){\n    marker.getWorldPosition'), 'slope angle visibility must not traverse every DOM marker each frame');
assert.ok(entrySource.includes('slopeLabels:{total:slopeAnalysisAngleLabelRecords.length,active:slopeAnalysisActiveAngleLabels.size'), 'runtime diagnostics must expose total and active angle label counts');
assert.ok(entrySource.includes("distanceControl.max='1500'") && entrySource.includes("distanceSlider.max='1500'") && entrySource.includes("target.max='1500'"), 'angle distance slider must be initialized and reasserted at 1000 m during UI sync and input');
assert.ok(html.includes('font-size:15px') && html.includes('id="slopeLayerAngleDistance" type="range" min="0" max="1500" step="10" value="100"') && html.includes('id="slopeLayerAngleDistanceValue">100 м</strong>'), 'slope angle font must be 25% larger and camera distance control must reach 1000 m');
assert.ok(entrySource.includes('const clampSlopeDistance=(value,fallback=100)=>') && entrySource.includes('clampSlopeDistance(savedSlopeLayerSettings?.angleDistanceMeters,100)') && entrySource.includes('Math.max(0,Math.min(1500,Number(state.slopeAnalysisAngleMaxDistanceMeters)||0))'), 'camera distance clamp must preserve saved settings, default to 100 m and allow the full 1500 m range');
assert.ok(entrySource.includes('const SLOPE_ANALYSIS_LINE_WIDTH_PX = 4.125;') && entrySource.includes('green: 0x0b733a') && entrySource.includes('blue: 0x286bd6') && entrySource.includes('red: 0xe54848') && entrySource.includes('black: 0x2a2e34'), 'difficulty lines must be 25% thinner and use separate, slightly muted shades');
assert.ok(entrySource.includes('slopeAnalysis:state.slopeAnalysisData||undefined') && entrySource.includes('slopeCurves:state.slopeCurvesData||undefined'), 'derived analysis and raw Maya centerlines must survive client manifest autosave');
assert.ok(html.includes('id="slopeLayersToggle"') && html.includes('id="slopeLayer_angles"') && html.includes('id="slopeLayer_difficulty"') && html.includes('id="slopeLayer_names"'), 'three slope-analysis layer controls are missing');

assert.ok(mayaExporter.includes('def prepare_fbx_compatible_materials(components):') && mayaExporter.includes('def restore_fbx_compatible_materials(overrides):'), 'Maya exporter must bridge unsupported shading nodes for FBX and restore original assignments');
assert.ok(mayaExporter.includes('supported_node_types = {"lambert", "phong"}') && mayaExporter.includes('cmds.connectAttr(proxy + ".outColor", destination, force=True)'), 'FBX material bridge must use supported Lambert / Phong nodes on the existing shading groups');
assert.ok(mayaExporter.includes('restore_fbx_compatible_materials(material_overrides)') && mayaExporter.includes('"fbxMaterialConversions"'), 'Maya exporter must always restore source shader connections and record compatibility conversions');
assert.ok(mayaExporter.includes('def find_client_scene_manifest(repo):') && mayaExporter.includes('if len(matches) != 1'), 'Maya exporter must safely detect exactly one client scene without asking for a Project ID');
assert.ok(mayaExporter.includes('def prepare_client_asset_export(repo, components, node_metadata, replace_asset_id=None,') && mayaExporter.includes('source_root_name_override=None') && mayaExporter.includes('"file": relative_file'), 'Maya exporter must prepare new and replacement asset paths with an explicit export-root identity');
assert.ok(mayaExporter.includes('def list_replaceable_client_assets(repo):') && mayaExporter.includes('def refresh_git_asset_list(*_):'), 'Maya exporter must list existing client FBX files from the local Git scene manifest');
assert.ok(mayaExporter.includes('def replace_selected_scene_asset(*_):') && mayaExporter.includes('_export_scene(replace_asset_id=asset.get("id"))'), 'Maya exporter must expose explicit target replacement');
assert.ok(mayaExporter.includes('existing_size_bytes = os.path.getsize(model_path)'), 'replacement exporter must capture the original FBX size');
assert.ok(mayaExporter.includes('minimum_safe_size = max(16 * 1024, int(previous_size * 0.01))'), 'replacement exporter must reject suspiciously small FBX files before swapping');
assert.ok(mayaExporter.includes('Замена остановлена: новый FBX подозрительно мал.'), 'replacement failure must explain that original geometry remains safe');
assert.ok(!mayaExporter.includes('Замена Slopes_Stage1 остановлена: в выделение попала геометрия Stage 2.'), 'Maya exporter must allow intentional mixed multi-mesh hierarchy exports');

assert.ok(mayaExporter.includes('label="2. ЗАМЕНА СУЩЕСТВУЮЩЕГО ОБЪЕКТА"') && mayaExporter.includes('label="1. НОВЫЙ ОБЪЕКТ"') && mayaExporter.includes('ЗАМЕНИТЬ ВЫБРАННЫЙ ОБЪЕКТ') && mayaExporter.includes('ДОБАВИТЬ КАК НОВЫЙ ОБЪЕКТ'), 'Maya UI must keep new and replace operations in separate sections');
assert.ok(mayaExporter.includes('re.match(r"^models/') && mayaExporter.includes('_safe_existing_fbx_path'), 'Maya replacement must be restricted to safe models/ FBX paths');
assert.ok(mayaExporter.includes('"activeTerrain": False') && mayaExporter.includes('"category": category'), 'new Maya scene assets must default to non-active geometry');
assert.ok(mayaExporter.includes('MAYA_LINEAR_UNIT_TO_METERS') && mayaExporter.includes('"scale": [meters_per_unit, meters_per_unit, meters_per_unit]'), 'Maya asset units must be converted to metres in the client manifest');
assert.ok(mayaExporter.includes('def write_client_asset_manifest('), 'Maya client scene manifest writer missing');
assert.ok(mayaExporter.includes('collect_meshes(selection_only=True, selection_roots=export_roots)') && mayaExporter.includes('collect_node_metadata(selection_only=True, selection_roots=export_roots)'), 'Maya exporter must collect only selected objects and descendants using normalized DAG roots');
assert.ok(mayaExporter.includes('cmds.select(fbx_export_roots, replace=True)') && mayaExporter.includes('def collect_meshes(selection_only=False, selection_roots=None):'), 'Maya FBX export must restore whole transform roots before selection-only export');
assert.ok(mayaExporter.includes('FBXExport -f "') && mayaExporter.includes('" -s;'), 'Maya scene asset export must always use FBX selection-only mode');
assert.ok(mayaExporter.includes('os.replace(temporary_model_path, export_info["model_path"])') && mayaExporter.includes('os.replace(temporary_manifest_path, export_info["manifest_path"])'), 'Maya exporter must publish the separate model and manifest only after export succeeds');
assert.ok(mayaExporter.includes('"_canonical_terrain": True') && mayaExporter.includes('"_relative_file": "assets/real-terrain.fbx"'), 'Maya replacement tree must list the canonical base terrain as a separate asset');
assert.ok(mayaExporter.includes('def replace_canonical_terrain(*_):') && mayaExporter.includes('replace_canonical_terrain()'), 'Maya exporter must expose a dedicated canonical terrain replacement path');
assert.ok(mayaExporter.includes('"stageOneTransformPolicy"') && mayaExporter.includes('stage_one=False,'), 'Stage 1 export must preserve Maya hierarchy transforms instead of resetting nested scales');
assert.ok(mayaExporter.includes('terrain_diagonal_m < 1000.0'), 'canonical terrain export must reject a suspiciously tiny CAD terrain before replacing the published asset');
assert.ok(mayaExporter.includes('def _bake_export_root_to_world_meshes(') && mayaExporter.includes('_apply_inverse_bridge_to_root_matrix(baked_root, bridge_context)') && mayaExporter.includes('Remove the CAD Bridge wrapper from the duplicated root'), 'Maya export must remove the CAD Bridge wrapper from temporary copies before baking vertices');
assert.ok(mayaExporter.includes('"cadBridge": {') && mayaExporter.includes('"inverseApplied": bool(bridge_summaries)') && mayaExporter.includes('"workingTransformPreserved": False'), 'canonical terrain sidecar must record CAD Bridge inverse conversion');
assert.ok(mayaExporter.includes('os.replace(temporary_model_path, model_path)') && mayaExporter.includes('os.replace(temporary_manifest_path, manifest_path)'), 'canonical terrain FBX and JSON sidecar must be replaced as a recoverable pair');
assert.ok(mayaExporter.includes('if shape in seen:'), 'Maya exporter must retain multiple mesh shapes under one transform as separate mesh components');
assert.ok(mayaExporter.includes('METADATA_PRESETS = {'), 'Maya exporter metadata presets missing');
const mayaPresetSource = mayaExporter.slice(mayaExporter.indexOf('METADATA_PRESETS = {'), mayaExporter.indexOf('def safe_path'));
assert.ok(!mayaPresetSource.includes('"collision"') && !mayaPresetSource.includes('"forestBlocker"'), 'Maya metadata presets must not assign editor-owned Collision / Forest blocker flags');
assert.ok(mayaExporter.includes('"Рельеф"') && mayaExporter.includes('"Здание"') && mayaExporter.includes('"Подъёмник / опора"'), 'common Maya metadata presets missing');
assert.ok(mayaExporter.includes('cmds.optionMenuGrp(') && mayaExporter.includes('changeCommand=on_metadata_preset_changed'), 'metadata preset dropdown missing');
assert.ok(mayaExporter.includes('OPTION_PRESET') && mayaExporter.includes('OPTION_REPO') && mayaExporter.includes('remember_export_settings'), 'Maya exporter settings must persist between launches');
assert.ok(mayaExporter.includes('def clear_metadata_from_selection('), 'clear metadata selection action missing');
assert.ok(mayaExporter.includes('collapsable=True') && mayaExporter.includes('collapse=True'), 'Maya metadata controls must be collapsed by default');
assert.ok(!mayaExporter.includes('WINDOW + "_role"') && !mayaExporter.includes('WINDOW + "_tags"'), 'legacy always-visible Role / Tags text fields must not return');
assert.ok(!mayaExporter.includes('WINDOW + "_node_collision"') && !mayaExporter.includes('WINDOW + "_node_forest"'), 'Collision / Forest blocker controls belong in Web Editor, not Maya Exporter');
const mayaCollector = mayaExporter.slice(mayaExporter.indexOf('def collect_node_metadata('), mayaExporter.indexOf('def _set_string_attribute'));
assert.ok(!mayaCollector.includes('goCollision') && !mayaCollector.includes('goForestBlocker'), 'Maya exporter must not import editor-owned flags from Maya attributes');

assert.ok(mayaPlugin.includes('VERSION = "0.6.0"'), 'Maya plug-in entrypoint version must remain 0.6.0');
assert.ok(mayaPlugin.includes('def maya_useNewAPI():'), 'Maya Python API 2.0 marker missing');
assert.ok(mayaPlugin.includes('def initializePlugin(plugin_object):'), 'Maya plug-in initializer missing');
assert.ok(mayaPlugin.includes('registerCommand(COMMAND_NAME'), 'Maya plug-in command registration missing');
assert.ok(mayaPlugin.includes('maya_utils.executeDeferred(_build_menu)'), 'Maya menu must be created through deferred UI');
assert.ok(mayaPlugin.includes('Create FBX Test Scene…'), 'Maya plugin test-scene menu item missing');
assert.ok(mayaPlugin.includes('grade_optimizer_test_scene'), 'Maya plugin test-scene loader missing');
const mayaFixture = read('maya/grade_optimizer_test_scene.py').toString('utf8');
assert.ok(mayaFixture.includes('def create_test_scene():'), 'Maya FBX test-scene builder missing');
assert.ok(mayaFixture.includes('def _metadata(node, role="", tags="")'), 'Maya test fixture must seed descriptive Role / Tags only');
assert.ok(!mayaFixture.includes('_add_bool') && !mayaFixture.includes('collision=True') && !mayaFixture.includes('forest_blocker=True'), 'Maya test fixture must leave Collision / Forest blocker for Web Editor');

assert.ok(mayaFixture.includes('cmds.file(new=True, force=True)'), 'test scene must explicitly replace the current scene only after confirmation');
assert.ok(mayaFixture.includes('CONFIRM_BUTTON'), 'test-scene destructive action must require confirmation');
assert.ok(mayaFixture.includes('GO_Shared_Snow_MAT'), 'shared test material missing');
assert.ok(mayaFixture.includes('station_body + ".f[0:2]"'), 'test scene must create multiple material slots on one mesh');
assert.ok(mayaFixture.includes('Hidden_Survey_Marker') && mayaFixture.includes('".visibility", False'), 'hidden test node missing');
assert.ok(mayaFixture.includes('cmds.rename(south_pylon, "Pylon")'), 'duplicate hierarchy leaf-name test missing');
assert.ok(mayaFixture.includes('5 верхнеуровневых веток, 7 mesh objects'), 'test-scene summary must match the generated hierarchy and mesh count');
assert.ok(mayaFixture.includes('cmds.select(terrain_group, replace=True)'), 'test scene must preselect only its terrain group for the exporter');
assert.ok(read('maya/GradeOptimizer.mod').toString('utf8').includes('MAYA_PLUG_IN_PATH +:= plug-ins'), 'Maya module descriptor missing plug-in path');
assert.ok(read('maya/install_maya_module.bat').toString('utf8').includes('install_maya_module.ps1'), 'Windows Maya module installer missing');
assert.match(entry, /^app\.v\d+\.js$/, 'active app must use a versioned app.vNN.js runtime module');
assert.ok(html.includes('id="clientWorkspaceHint"') && html.includes('ABOUT PROJECTS') && html.includes('placeholder="alpine-resort"'), 'compact Project Workspace must retain its help text and default project ID');
assert.ok(entrySource.includes("WORKSPACE_QUERY.get('project')||WORKSPACE_QUERY.get('client')||''"), 'project query must be supported with legacy client URL compatibility');
assert.ok(entrySource.includes("REQUESTED_PROJECT_ID||'alpine-resort'"), 'primary alpine-resort workspace must open automatically');
assert.ok(entrySource.includes('await restoreProjectFolderHandle()'), 'project open must restore the chosen local repository folder handle');
assert.ok(entrySource.includes("Date.parse(localBackup.manifest.updatedAt||'')>Date.parse(remoteManifest.updatedAt||'')"), 'newer unsynced browser draft must take precedence over older deployed manifest');
assert.ok(entrySource.includes('90*1024*1024'), 'local folder sync must guard regular-Git model file size');
assert.ok(html.includes('class="workspace-sync-title">LOCAL SYNC') && html.includes('GITHUB DESKTOP'), 'compact Scene Editor sync section must identify GitHub Desktop');
assert.ok(entrySource.includes('function pulseEditorSelection(target,materialFilter=null){'), 'scene editor selection pulse effect missing');
assert.ok(entrySource.includes('updateEditorSelectionPulses(now);'), 'scene editor selection pulse animation must run in the render loop');
assert.ok(entrySource.includes('color:0xffd52f'), 'selection pulse must use the yellow highlight material');
assert.ok(entrySource.includes("markClientProjectDirty('назначение общего материала')"), 'shared material assignment must mark the client project dirty');
assert.ok(entrySource.includes("markClientProjectDirty('создание уникального материала')"), 'unique material creation must mark the client project dirty');
assert.ok(entrySource.includes("markClientProjectDirty('удаление карты текстуры')"), 'texture removal must mark the client project dirty');
assert.ok(entrySource.includes("markClientProjectDirty('смена активного рельефа')"), 'active terrain selection must mark the client project dirty');
assert.ok(entrySource.includes("window.addEventListener('beforeunload'"), 'unsaved client project changes must warn before leaving');
assert.ok(entrySource.includes("removeButton.disabled=asset.sourceType==='scene'"), 'non-persistent built-in scene component deletion must be disabled');
assert.ok(entrySource.includes("persistImportedEditorAsset(asset).catch(error=>console.warn('Не удалось сохранить импортированную JSON-конфигурацию модели:'"), 'imported model JSON changes must be persisted into the model file');
assert.ok(html.includes('id="editorNodeRole" type="text"'), 'node role must accept custom values');
assert.ok(html.includes('id="connectProjectFolderButton"') && html.includes('>CONNECT FOLDER</button>'), 'Scene Editor must provide the compact local repository folder control');
assert.ok(html.includes('id="clientWorkspaceStatus"') && entrySource.includes('function readProjectBrowserBackup(') && entrySource.includes('function autosaveProjectToBrowser('), 'browser backup and autosave status must remain available without verbose help text');
assert.ok(!read('maya/grade_optimizer_exporter.py').toString('utf8').includes('OPTION_PROJECT'), 'Maya exporter must remain independent of client Project IDs');
assert.ok(html.includes('ЭКСПОРТ JSON-БЭКАПА'), 'manual JSON export must be clearly marked as an optional backup');



pass('forest rendering, collision bounds and viewport-aware HUD safeguards present');

assert.ok(html.includes("if(event.code!=='KeyV'||event.repeat)return"), 'global V mode switch must be available in overview, skier and drone modes');
assert.ok(!entrySource.includes("e.code==='Tab'"), 'Tab must not switch between skier and drone');
assert.match(entrySource, /skierSwitchDrone/, 'skier-to-drone HUD button binding missing');
assert.match(entrySource, /droneSwitchSkier/, 'drone-to-skier HUD button binding missing');
assert.match(html, /id="skierSwitchDrone"/, 'skier HUD action button missing');
assert.match(html, /id="droneSwitchSkier"/, 'drone HUD action button missing');
assert.match(html, /id="skierTutorialContent"/, 'skier tutorial collapsible content missing');
assert.match(html, /id="droneTutorialContent"/, 'drone tutorial collapsible content missing');
assert.match(html, /id="toggleSkierTutorial"/, 'skier tutorial visibility button missing');
assert.match(html, /id="toggleDroneTutorial"/, 'drone tutorial visibility button missing');
assert.match(entrySource, /e\.code==='KeyH'/, 'H tutorial visibility shortcut missing');
assert.match(entrySource, /setTutorialVisible/, 'tutorial visibility handler missing');
assert.ok(entrySource.includes("if(e.code==='KeyH'&&(state.mode==='skier'||state.mode==='drone'))"), 'H must toggle even when a HUD button has focus');
const skierHudMarkup = html.slice(html.indexOf('<div id="skierHud"'), html.indexOf('<div id="droneHud"'));
const droneHudMarkup = html.slice(html.indexOf('<div id="droneHud"'), html.indexOf('<div id="legend"'));
assert.ok(skierHudMarkup.indexOf('id="speedValue"') < skierHudMarkup.indexOf('id="skierTutorialContent"'), 'skier speed must stay outside collapsible tutorial');
assert.ok(skierHudMarkup.indexOf('id="slopeValue"') < skierHudMarkup.indexOf('id="skierTutorialContent"'), 'skier slope angle must stay outside collapsible tutorial');
assert.ok(skierHudMarkup.indexOf('id="accelerationValue"') < skierHudMarkup.indexOf('id="skierTutorialContent"'), 'skier acceleration must stay outside collapsible tutorial');
assert.ok(droneHudMarkup.indexOf('id="droneSpeedValue"') < droneHudMarkup.indexOf('id="droneTutorialContent"'), 'drone speed must stay outside collapsible tutorial');
assert.match(html, /\.mode-hud-collapsible\[hidden\]/, 'collapsed tutorial display rule missing');
assert.match(html, /max-height:calc\(100dvh - 84px\)/, 'viewport-aware HUD sizing missing');
assert.match(html, /КАК НАЧАТЬ/, 'beginner skier tutorial missing');
assert.match(html, /КАК УПРАВЛЯТЬ/, 'beginner drone tutorial missing');
assert.ok(!html.includes('V / TAB') && !html.includes('<kbd>TAB</kbd>'), 'Tab shortcut must be removed from the mode switch UI');
assert.ok(html.includes('SHIFT</kbd> — ускорение до 200 км/ч'), 'drone tutorial must document Shift boost to 200 km/h');
assert.ok(html.includes('<kbd>SPACE</kbd><span>/</span><kbd>CTRL</kbd>'), 'drone vertical controls must use Space and Ctrl');
assert.ok(html.includes('id="groundState">Обычная езда</span>'), 'skier HUD must show normal skiing state');
assert.ok(html.includes('.mode-hud .tutorial-step strong{font-size:11px!important'), 'tutorial headings must be slightly larger');
assert.ok(html.includes('.mode-hud .tutorial-step small{font-size:9px!important'), 'tutorial descriptions must be slightly larger');

assert.ok(html.includes('id="skierTutorialContent" class="mode-hud-collapsible"'), 'skier tutorial wrapper missing');
assert.ok(html.includes('id="droneTutorialContent" class="mode-hud-collapsible"'), 'drone tutorial wrapper missing');
assert.ok(html.includes('max-height:none!important;height:auto!important;overflow:visible!important;'), 'HUD must not scroll or clip vertically');
assert.ok(html.includes('height:auto!important;overflow:visible!important;padding:0!important;margin:0!important;'), 'tutorial content must not scroll');
assert.ok(html.includes('grid-template-columns:minmax(0,.88fr) minmax(0,1.12fr)'), 'tutorial and key guide must use side-by-side layout');
assert.ok(html.includes('transform-origin:bottom left!important'), 'HUD must scale from its bottom edge to stay inside the viewport');
assert.ok(!html.includes('id="skierSkiFileInput"') && !html.includes('id="importSkierSkiButton"') && !html.includes('id="resetSkierSkiButton"') && !html.includes('id="skierSkiModelStatus"'), 'dedicated skier ski replacement UI must be absent');
assert.ok(!entrySource.includes('saveSkierSkiLocally') && !entrySource.includes('loadSavedSkierSki') && !entrySource.includes('removeSavedSkierSki'), 'skier-only ski upload and restore handlers must be absent');
assert.ok(entrySource.includes('openLocalAssetDatabase') && entrySource.includes('saveSceneAssetLocally'), 'shared Scene Editor local asset storage must remain');
for(const id of ['outsideSkiLoadValue','insideSkiLoadValue','outsideSkiLoadBar','totalSkiLoadValue'])assert.ok(html.includes('id="'+id+'"'), 'ski load HUD element missing: '+id);
assert.ok(entrySource.includes('outsideSkiLoadValueEl') && entrySource.includes('insideSkiLoadValueEl') && entrySource.includes('outsideSkiLoadBarEl'), 'ski loads must be shown in HUD');
assert.ok(entrySource.includes("if(state.optimizeMode)setOptimizerOpen(false)"), 'Overview must close the optimization panel');
assert.ok(entrySource.includes("if(state.mode!=='overview')setSceneMode('overview')"), 'optimizer must return to overview from skier / drone');
assert.ok(entrySource.includes("if(document.pointerLockElement===renderer.domElement)document.exitPointerLock?.()"), 'optimizer must release renderer pointer lock');
assert.ok(entrySource.includes('skierController.stop();')&&entrySource.includes('droneController.stop();'), 'optimizer must stop both interactive controllers');


assert.ok(entrySource.includes('await skierController.start(terrain,spawnHint,{'), 'skier mode must await incremental terrain preparation');
assert.ok(entrySource.includes("velocity:droneController.velocity.clone()"), 'drone pose and velocity must be captured before mode handoff');
assert.ok(entrySource.includes("if(state.mode==='skier'){")&&entrySource.includes("skierController.update(dt);"), 'skier controller must update continuously while active');
assert.ok(entrySource.includes("if(state.mode==='drone')droneController.update(dt)"), 'drone controller must update continuously while active');
assert.ok(!entrySource.includes('modeTransition'), 'stale transition lock must not block mode changes');
assert.ok(skierSource.includes('_downhillClearance('), 'skier spawn must validate downhill run-out');
assert.ok(skierSource.includes('if(!spawnFound&&!isDroneSpawn){')&&skierSource.includes('this._findSpawn(slot)'), 'ordinary starts keep the slot-aware piste fallback while drone starts remain at the drone location');
assert.ok(skierSource.includes('this.velocity.copy(downhill).multiplyScalar(initialSpeed)'), 'drone handoff must initialize downhill movement');
assert.ok(skierSource.includes('const fallbackDivisions=12'), 'skier spawn must have a bounded last-resort terrain scan');
assert.ok(skierSource.includes('fallbackCandidates.sort((a,b)=>b.baseScore-a.baseScore)')&&skierSource.includes('evaluatedFallbacks=fallbackCandidates.map(candidate=>'), 'skier spawn fallback must rank candidates and score downhill clearance');
assert.ok(skierSource.includes('this.lastPointerLockError=null'), 'pointer-lock denial must not abort skier startup');
assert.ok(entrySource.includes('let pendingSceneMode = null;'), 'skier mode requests during terrain loading must be queued');
assert.ok(entrySource.includes("if(pendingSceneMode==='skier')"), 'queued skier mode must resume after slope loading');
assert.ok(entrySource.includes("const reason=skierController.lastStartError||'UNKNOWN'"), 'skier startup failures must report the controller error code');

assert.ok(entrySource.includes('resolveRendererPixelRatio')&&entrySource.includes('performanceProfileActive:!!skierPerformanceRestore')&&entrySource.includes('runtimePerformance.rafIntervalMs')&&entrySource.includes('calculateRollingFps')&&entrySource.includes('collectRenderSceneBreakdown()'),'skier resolution profile must survive viewport resize; frame timing must use rolling rAF intervals; per-scene draw diagnostics must be exposed');
assert.ok(entrySource.includes('renderer.info.autoReset = false')&&entrySource.includes('runtimePerformance.weatherUpdateMs')&&entrySource.includes('runtimePerformance.forestUpdateMs')&&entrySource.includes('runtimePerformance.opticsMs')&&entrySource.includes('runtimePerformance.drawCalls')&&entrySource.includes('renderPipeline:') ,'frame profiler must expose update, render, draw-call and pipeline diagnostics');
pass('reliable skier/drone mode handoff, spawn fallback and active movement are present');
assert.ok(entrySource.includes('const forestTerrain=state.baseTerrain;'), 'forest placement must sample only original base terrain');
assert.ok(entrySource.includes('buildSlopeFootprintLookup(bounds,slopeAssets)')&&entrySource.includes('isTreePointOnSlope(candidate.x,candidate.z,slopeFootprint)'), 'visible piste meshes must be excluded from tree placement');
assert.ok(entrySource.includes('function normalizeTreeAreas(')&&entrySource.includes('treeAreas:normalizeTreeAreas(state.treeAreas)'), 'tree areas must be normalized and saved in project manifest');
assert.ok(entrySource.includes('state.treeAreas=normalizeTreeAreas(manifest.treeAreas)'), 'tree areas must restore from project manifest');
assert.ok(entrySource.includes('pointInPoly(candidate.x,candidate.z,area.points)'), 'forest placement must be restricted to saved polygons when areas exist');
assert.ok(entrySource.includes('onTreeAreaPointerDown')&&entrySource.includes('finishTreeAreaDrawing')&&entrySource.includes('treeAreaDrawButton'), 'Tree Areas drawing tool is missing');
assert.ok(entrySource.includes("markClientProjectDirty('Tree Area: '+name)"), 'tree area changes must mark the project dirty');
assert.ok(html.includes('id="sceneLookTab-trees"')&&html.includes('id="treeAreaDrawButton"')&&html.includes('id="treeAreaFinishButton"'), 'Scene Editor Tree Areas panel is missing');
assert.ok(entrySource.includes("trees:['TREE PLACEMENT AREAS'")&&entrySource.includes("if(name==='trees')updateTreeAreaPanel();")&&entrySource.includes('updateTreeAreaOverlayVisibility();'), 'Tree Areas tab must show its heading, refresh the list and update saved polygon overlays');
pass('original-terrain-only trees, slope exclusion and persistent world-space Tree Areas are present');
assert.ok(entrySource.includes('function buildTestForest({reusePlacements=false}={})'), 'test forest builder must support cached placement reuse');
assert.ok(entrySource.includes('forestPlacementCache={')&&entrySource.includes('reusePlacements&&forestPlacementCache?.terrain===forestTerrain'), 'forest placements must be cached for atlas upgrade');
assert.ok(!entrySource.includes('const y=terrainY(x,z)'), 'forest generation must not Raycast thousands of times against the large terrain');
assert.ok(entrySource.includes('requestIdleCallback(upgradeForest'), 'late forest atlas upgrade must wait for browser idle time');
assert.ok(entrySource.includes('function resolveSkierTerrain()'), 'skier mode must resolve a terrain mesh before its early guard');
assert.ok(entrySource.indexOf('const requestedTerrain=mode===\'skier\'')<entrySource.indexOf("if(mode==='skier'&&!requestedTerrain)")&&entrySource.includes('dronePose?resolveSkierTerrainForDroneSpawn(dronePose.position):resolveSkierTerrain()'), 'drone-aware terrain resolution must run before the early skier guard');
assert.ok(entrySource.includes('const terrain=requestedTerrain;'), 'skier start must use the resolved terrain instance');
assert.ok(entrySource.includes("const terrain=resolveSkierTerrain();"), 'queued skier mode must resolve its terrain when loading completes');
assert.ok(entrySource.includes("START_EXCEPTION"), 'skier controller exceptions must be reported precisely');
assert.ok(entrySource.includes("TERRAIN_NOT_RESOLVED"), 'mode API must report terrain resolution failures instead of NO_MODE_CHANGE');

assert.ok(skierSource.includes('this._groundFromLookup(x,z,referenceY,maxVerticalDelta)'), 'skier ground queries must have a direct triangle lookup fallback');
assert.ok(skierSource.includes('await this._buildTerrainLookup('), 'skier start must await incremental spatial terrain lookup');
assert.ok(skierSource.includes('occupiedCells:this.terrainLookup?.occupiedCells||0'), 'failed skier starts must report terrain lookup diagnostics');
assert.ok(entrySource.includes("const reason=skierController.lastStartError||(!state.root?'SCENE_ROOT_MISSING':'TERRAIN_NOT_RESOLVED')"), 'mode bridge must receive the precise terrain / startup failure code');
assert.ok(html.includes("actual.startsWith('failed:')"), 'HTML bridge must display the precise failed mode result');
assert.ok(entrySource.includes('window.__GRADE_OPTIMIZER_MODE_API=Object.freeze('), 'mode API must be exported for standalone HTML input bridge');
assert.ok(html.includes('id="grade-optimizer-mode-bridge"'), 'classic mode input bridge is missing');
assert.ok(html.includes('src="./' + entryPath + '"'), 'HTML must load the current application module');
assert.ok(html.includes("event.target?.closest?.('#skierMode, #droneModeButton')"), 'mode buttons must use the standalone HTML input bridge');
assert.ok(entrySource.includes("current==='drone'?'skier':current==='skier'?'drone':'skier'"), 'V must enter skier from overview and toggle between skier / drone');
assert.ok(html.includes('id="modeSwitchFeedback"'), 'visible mode-switch feedback element missing');
assert.ok(entrySource.includes("showModeSwitchFeedback(message)"), 'mode startup failures must be visible on screen');
assert.ok(entrySource.includes('function resolveSkierTerrain()')&&entrySource.includes('function resolveSkierTerrainForDroneSpawn(position)')&&entrySource.indexOf('const requestedTerrain=mode===\'skier\'')<entrySource.indexOf("if(mode==='skier'&&!requestedTerrain)"), 'skier mode must resolve the correct surface before its early return guard');
assert.ok(entrySource.includes('object.userData?.goSkierBatchHidden===true)object.visible=true')&&entrySource.includes('node.userData?.goSkierBatchHidden!==true'),'skier physics clones must retain hidden source meshes when the render-only batch is active');
assert.ok(entrySource.includes('function createSkierPhysicsSurface(roots)')&&entrySource.includes('GO_SkierPhysicsTerrainComposite')&&entrySource.includes('if(activeAsset&&hasGeometry(activeAsset.root))')&&entrySource.includes('if(state.baseTerrain&&state.baseTerrain!==state.terrain&&hasGeometry(state.baseTerrain))')&&entrySource.includes('const preferredSlope=state.importedAssets.find('),'skier collision surface must combine the Stage 1 piste with visible active Terrain while excluding hidden replaced terrain');
assert.ok(entrySource.includes('function applySkierPerformanceProfile()')&&entrySource.includes('cameraOptics.setOptions({enabled:false})')&&entrySource.includes('renderer.shadowMap.enabled=false')&&entrySource.includes('performanceRatio')&&entrySource.includes('FOREST_BILLBOARD_UPDATE_INTERVAL_MS=66')&&entrySource.includes('updateInterval=state.mode===\'skier\'?100:FOREST_BILLBOARD_UPDATE_INTERVAL_MS'),'skier mode must temporarily reduce render cost and throttle forest billboards');
assert.ok(entrySource.includes("sceneLoadingEl.getClientRects().length>0"), 'loading-state detection must use rendered visibility');

assert.ok(skierSource.includes("if (e.code === 'KeyC')"), 'C key third-person camera toggle missing');
assert.ok(skierSource.includes("toggleCameraView()"), 'camera view toggle method missing');
assert.ok(skierSource.includes("this.viewBlendTarget < 0.5 ? 1 : 0"), 'first/third-person camera switch state missing');
assert.ok(skierSource.includes('this.camera.position.copy(this.firstPersonPosition).lerp('), 'camera must smoothly blend between first and third person positions');
assert.ok(skierSource.includes('this.camera.quaternion.slerp(this.thirdPersonCameraQuaternion,this.viewBlend)'), 'camera rotation must smoothly blend between views');
assert.ok(skierSource.includes('_createSkierAvatar()'), 'third-person skier avatar is missing');
assert.ok(skierSource.includes('Third_Person_Skier_Avatar'), 'third-person skier avatar group is missing');
assert.ok(skierSource.includes('this.skierAvatar.quaternion.copy(this.skiRig.quaternion)'), 'skier avatar must align to ski heading and terrain');
assert.ok(skierSource.includes('cameraGround.point.y+1.35'), 'third-person camera terrain clearance missing');
assert.ok(html.includes('id="skierViewStatus"'), 'skier camera view indicator missing');
assert.ok(html.includes('<kbd>C</kbd>') && html.includes('Осмотреться / 3-е лицо'), 'C key camera control hint missing');


assert.ok(entrySource.includes("appRoot.classList.toggle('tuck-mode',tuck)"), 'speed tuck CSS state missing');
assert.ok(entrySource.includes("appRoot.style.setProperty('--ski-wind-opacity'"), 'speed-dependent wind effect intensity missing');
assert.ok(entrySource.includes('function beginModeCameraTransition(')&&entrySource.includes('function prepareModeCameraTransitionFrame()')&&entrySource.includes('function advanceModeCameraTransition(dt)'), 'drone/skier camera handoff must use a time-based transition');
assert.ok(entrySource.includes('if(modeCameraTransition)prepareModeCameraTransitionFrame();')&&entrySource.includes('if(modeCameraTransition)advanceModeCameraTransition(dt);'), 'camera handoff must preserve the destination controller camera state while blending output');
assert.ok(skierSource.includes('this.airborneCameraPitch+=(flightPitchTarget-this.airborneCameraPitch)*(1-Math.exp(-dt*5.5))'), 'first-person jump pitch must be damped');
assert.ok(!skierSource.includes('travelPitch+this.lookPitch'), 'first-person camera must not directly follow raw vertical flight velocity');
assert.ok(entrySource.includes('skierController.showForDrone()'), 'first-person skier must be shown to the drone during handoff');
assert.ok(entrySource.includes("skierController.stop({keepSceneModel:mode==='drone'})"), 'skier model must remain in the scene when entering drone mode');
assert.ok(entrySource.includes("if(mode==='overview')skierController.hideForOverview()"), 'skier model must be hidden when leaving drone for overview');
assert.ok(skierSource.includes('0.26*this.stanceCameraBlend'), 'first-person camera eye-height compensation in speed tuck missing');
assert.ok(skierSource.includes('0.085*this.stanceCameraBlend'), 'camera pitch adjustment in speed tuck missing');
assert.ok(skierSource.includes('this.avatarLegs.forEach'), 'third-person skier legs must bend into speed tuck');
assert.ok(skierSource.includes('0.43*tuck'), 'third-person skier torso must lean into speed tuck');
assert.ok(skierSource.includes('showForDrone(){'), 'skier avatar forced visibility handoff missing');
assert.ok(skierSource.includes('_updateSkierAvatar(true)'), 'skier avatar handoff must force full opacity');
assert.ok(skierSource.includes('hideForOverview(){'), 'external skier avatar cleanup missing');
assert.ok(skierSource.includes('stop({keepSceneModel=false}={})'), 'skier stop must optionally preserve model in scene');
assert.ok(html.includes('id="skiWindFx"'), 'peripheral wind visual overlay missing');
assert.ok(html.includes('#app.skier-mode.tuck-mode #skiWindFx'), 'wind overlay must appear only in skier speed stance');
assert.ok(html.includes('Скоростная стойка'), 'speed tuck help text missing');
assert.ok(html.includes('id="groundState">Обычная езда</span>'), 'default skiing status label missing');

pass('aerodynamic tuck camera, wind effect, avatar crouch and drone handoff are present');
pass('first/third-person skier camera, avatar and C-key UI are present');
pass('beginner controls, mode toggle and both mode-switch buttons are present');

for (const path of ['maya/grade_optimizer_exporter.py','maya/plug-ins/grade_optimizer.py','maya/grade_optimizer_test_scene.py']) {
  const syntax = spawnSync('python3', ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'], {
    input: read(path).toString('utf8'), encoding: 'utf8'
  });
  assert.equal(syntax.status, 0, 'Python syntax error in ' + path + ':\n' + (syntax.stderr || syntax.stdout));
  pass('Python syntax valid: ' + path);
}

const slopeIds = JSON.parse(read('assets/slopes.json').toString('utf8'));
assert.ok(Array.isArray(slopeIds) && slopeIds.length > 0, 'assets/slopes.json must contain at least one slope');
for (const id of slopeIds) {
  assert.match(id, /^[A-Za-z0-9_-]+$/, 'unsafe slope id: ' + id);
  const gltfPath = 'assets/' + id + '.gltf';
  const curvesPath = 'assets/' + id + '.curves.json';
  const gltf = JSON.parse(read(gltfPath).toString('utf8'));
  const curves = JSON.parse(read(curvesPath).toString('utf8'));
  for (const key of ['centre','left','right']) {
    assert.ok(Array.isArray(curves[key]) && curves[key].length > 1, id + ' curve missing or empty: ' + key);
  }
  for (const buffer of gltf.buffers || []) {
    assert.ok(buffer.uri && !/^(?:https?:|data:|\/|\.\.)/i.test(buffer.uri), id + ' has a non-local or unsafe glTF buffer URI');
    const bufferPath = resolve(root, 'assets', buffer.uri);
    assert.ok(existsSync(bufferPath), id + ' glTF buffer is missing: ' + buffer.uri);
    const bytes = readFileSync(bufferPath);
    assert.ok(bytes.length >= buffer.byteLength, id + ' glTF buffer is shorter than byteLength');
  }
  for (const view of gltf.bufferViews || []) {
    assert.ok(Number.isInteger(view.buffer) && view.buffer >= 0 && view.buffer < (gltf.buffers || []).length, id + ' has an invalid bufferView.buffer');
    const buffer = gltf.buffers[view.buffer];
    assert.ok((view.byteOffset || 0) + view.byteLength <= buffer.byteLength, id + ' has a bufferView outside its declared buffer');
  }
  pass('slope ' + id + ' glTF buffers and profile curves are valid');
}

const manifest = JSON.parse(read('scene-manifest.json').toString('utf8'));
assert.equal(manifest.schemaVersion, '1.0');
assert.ok(manifest.scene && manifest.scene.units === 'meters');
assert.ok(Array.isArray(manifest.assets));
pass('scene manifest parses');



// Atmospheric release v7 regression checks.

assert.ok(weatherV8Source.includes('aColor')&&weatherV8Source.includes('GO_StarField'),'night sky must include the updated star field');
assert.ok(weatherV8Source.includes('azimuthDelta>0.045')&&weatherV8Source.includes('globalCompositeOperation=\'screen\''),'sky must include wrapped, directional atmospheric scattering');
assert.ok(weatherV8Source.includes('cloudFbm')&&weatherV8Source.includes('cirrusLayer')&&weatherV8Source.includes('for(int i=0;i<6;i++)'),'cloud shader must retain layered detail with the reduced integration sample count');
pass('v7 sky atmosphere, cloud layers and night-sky regression checks');

assert.ok(weatherV8Source.includes('InstancedBufferGeometry')&&weatherV8Source.includes('uFallSpeed')&&weatherV8Source.includes('uLateralSpeed'),'snow particle motion must be vertex-shader driven');
assert.ok(!weatherV8Source.includes('this.snow.instanceMatrix.needsUpdate'),'snow must not upload per-instance matrices every frame');
pass('GPU-animated snowfall regression checks');

// Isolated WebGPU atmosphere lab: keep the production renderer entrypoint untouched.
const webgpuAtmosphereHtml = read('webgpu-atmosphere-lab.html').toString('utf8');
const webgpuAtmosphereSource = read('webgpu-atmosphere-lab.v2.js').toString('utf8');
const solarCycleSource = read('solar-cycle.v1.js').toString('utf8');
assert.ok(webgpuAtmosphereHtml.includes('three@0.187.0') && webgpuAtmosphereHtml.includes('three/tsl'), 'atmosphere lab must use the pinned modern Three.js / TSL import map');
assert.ok(webgpuAtmosphereHtml.includes('src="./webgpu-atmosphere-lab.v2.js"'), 'atmosphere lab entry module is missing');
assert.ok(webgpuAtmosphereSource.includes("new THREE.WebGPURenderer") && webgpuAtmosphereSource.includes('await renderer.init()'), 'atmosphere lab must initialize WebGPURenderer asynchronously');
assert.ok(webgpuAtmosphereSource.includes('ui.dayLengthValue.textContent')&&!webgpuAtmosphereSource.includes('ui.dayCycleLengthValue.textContent'),'atmosphere day-cycle label must reference the declared UI field');
assert.ok(webgpuAtmosphereSource.includes('createFallbackTerrain')&&webgpuAtmosphereSource.includes('Резервный процедурный рельеф')&&webgpuAtmosphereSource.includes('Используется процедурный рельеф'),'atmosphere lab must fall back to generated terrain when the FBX response is invalid');
assert.ok(webgpuAtmosphereSource.includes('renderer.backend && renderer.backend.isWebGPUBackend === true'), 'atmosphere lab must report the active WebGPU / WebGL2 backend');
assert.ok(webgpuAtmosphereSource.includes("loadFBXTerrain('./assets/real-terrain.fbx')") && webgpuAtmosphereSource.includes("new FBXLoader().parse(buffer, './assets/')") && webgpuAtmosphereSource.includes('mayaExport.metersPerUnit'), 'atmosphere lab must validate and parse canonical Maya terrain while honoring its units');
assert.ok(webgpuAtmosphereSource.includes('isBinaryFBX') && webgpuAtmosphereSource.includes('isAsciiFBX') && webgpuAtmosphereSource.includes('Сервер вернул не FBX'), 'atmosphere lab must identify invalid FBX responses before parsing');
assert.ok(webgpuAtmosphereSource.includes('new SkyMesh()') && webgpuAtmosphereSource.includes('sky.cloudCoverage.value'), 'atmosphere lab must expose the procedural sky and cloud system');
assert.ok(webgpuAtmosphereSource.includes('new THREE.RenderPipeline(renderer)') && webgpuAtmosphereSource.includes('texture3D(noiseTexture'), 'atmosphere lab must use a TSL RenderPipeline and 3D density field');
assert.ok(webgpuAtmosphereSource.includes('Loop(marchSteps') && webgpuAtmosphereSource.includes('isBackgroundDepth(depth)'), 'volumetric fog must be depth-limited and exclude background pixels');
assert.ok(webgpuAtmosphereSource.includes('depthAware') || webgpuAtmosphereSource.includes('function buildFogPipeline()'), 'depth-aware volumetric upsampling pipeline is missing');
assert.ok(webgpuAtmosphereSource.includes('cameraWorld.value.copy(camera.matrixWorld)') && webgpuAtmosphereSource.includes('fogPipeline.updateCamera()'), 'volumetric reconstruction must track camera matrices each frame');
assert.ok(webgpuAtmosphereSource.includes('lowResFog.setResolutionScale(value)') && webgpuAtmosphereSource.includes('performance: { pixelRatio: 1.0'), 'atmosphere quality profiles must control fog resolution and pixel ratio');
assert.ok(webgpuAtmosphereSource.indexOf('camera.aspect = stage.clientWidth / Math.max(1, stage.clientHeight);') < webgpuAtmosphereSource.indexOf('fogPipeline = buildFogPipeline()'), 'atmosphere camera aspect must be initialized before the first pipeline render');
assert.ok(webgpuAtmosphereSource.includes('sceneColor.rgb.mix(fogColor, fogResult)') && !webgpuAtmosphereSource.includes('fogResult.mix(sceneColor.rgb, fogColor)'), 'atmosphere fog composite must use fog opacity as the mix factor');
assert.ok(webgpuAtmosphereSource.includes('const rangeFog = rangeT.mul(rangeT)'), 'distance haze must ease in gradually instead of becoming dense at mid-range');
assert.ok(solarCycleSource.includes('phase=(hour-6)/12*Math.PI')&&solarCycleSource.includes('azimuth=phase-Math.PI/2')&&solarCycleSource.includes('advanceSolarClock('), 'shared day cycle must rotate the sun across azimuth and support a configurable full-day duration');
assert.ok(solarCycleSource.includes('export function createSolarDisc(THREE)')&&solarCycleSource.includes('export function updateSolarDisc(THREE,sprite,camera,cycle,intensity)'), 'shared day cycle must expose a separate intensity-controlled solar disc');
assert.ok(webgpuAtmosphereHtml.includes('id="dayCycleToggle"')&&webgpuAtmosphereHtml.includes('id="dayCycleLength"')&&webgpuAtmosphereHtml.includes('id="sunIntensity"'), 'Atmosphere Lab must expose a time-of-day play/pause, day length and direct-sun power controls');
assert.ok(webgpuAtmosphereSource.includes("from './solar-cycle.v1.js'")&&webgpuAtmosphereSource.includes('calculateSolarCycle(THREE,hours)')&&webgpuAtmosphereSource.includes('advanceSolarClock('), 'Atmosphere Lab must use the shared rotating solar path and animated day cycle');
assert.ok(webgpuAtmosphereSource.includes('sky.showSunDisc.value = false')&&webgpuAtmosphereSource.includes('createSolarDisc(THREE)')&&webgpuAtmosphereSource.includes('updateSolarDisc(THREE,sunDisc'), 'Atmosphere Lab sun disc must be independently controlled by the sun power slider');
assert.ok(webgpuAtmosphereSource.includes('sky.mieCoefficient.value = 0.0038')&&webgpuAtmosphereSource.includes('sky.rayleigh.value = Number(ui.rayleigh.value)')&&!webgpuAtmosphereSource.includes('sky.mieColor.value')&&!webgpuAtmosphereSource.includes('sky.mieAlbedo.value')&&!webgpuAtmosphereSource.includes('sky.sunSize.value'), 'Atmosphere Lab must write only uniforms exposed by SkyMesh in Three.js r187');
pass('isolated WebGPU atmosphere lab: canonical terrain, SkyMesh, TSL volumetrics, camera depth and quality profiles');

// WebGPU Alpine Forest Lab regression checks.
const alpineForestHtml=read('webgpu-forest-lab.html').toString('utf8');
const alpineForestSource=read('webgpu-forest-lab.js').toString('utf8');
assert.ok(alpineForestHtml.includes('three@0.187.0')&&alpineForestHtml.includes('src="./webgpu-forest-lab.js"'),'Alpine Forest lab must use pinned Three.js r187 and its isolated entrypoint');
assert.ok(alpineForestSource.includes("import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'")&&alpineForestSource.includes("new GLTFLoader().loadAsync(stageOneUrl)")&&alpineForestSource.includes("extension==='glb'")&&alpineForestSource.includes('restoreStageOneCoordinates(root,item)'),'Alpine Forest lab must load the published Slopes_Stage1 GLB with GLTFLoader and restore its saved CAD Bridge transform');
assert.ok(alpineForestSource.includes('function createFallbackTerrain(manifest, metersPerUnit)')&&alpineForestSource.includes('loadFBXTerrain')&&alpineForestSource.includes('Резервный процедурный рельеф'),'Forest Lab must validate the base FBX and keep a procedural terrain fallback');
assert.ok(alpineForestSource.includes('buildSlopeFootprint(root)')&&alpineForestSource.includes('buildTreePlacements(footprint'),'procedural forest must derive placements from the actual slope footprint');
assert.ok(alpineForestSource.includes('createSplinePineGeometry')&&alpineForestSource.includes('THREE.CatmullRomCurve3')&&alpineForestSource.includes("distance<520")&&alpineForestSource.includes("distance<1900"),'spruce forest must provide near and mid spline-based geometry LODs');
assert.ok(alpineForestSource.includes('const addBlade=')&&alpineForestSource.includes('needle sprays')&&alpineForestSource.includes('DoubleSide'),'spline spruce branches must include dense, two-sided procedural needle sprays');
assert.ok(alpineForestSource.includes("getObjectByName?.('ToSketchfab')")&&alpineForestSource.includes('sketchfabGroup.position.set(0,0,0)'),'Stage 1 loader must normalize Maya ToSketchfab wrapper transforms before CAD Bridge restoration');
assert.ok(alpineForestSource.includes('lastForward.dot(forestSystem.cameraForward)<0.94'),'far billboard LOD must rebuild on camera rotation, not only camera translation');
assert.ok(alpineForestSource.includes('smoothstep,'),'TSL smoothstep must be imported for the god-ray shader');
assert.ok(alpineForestSource.includes('snowy_conifer_atlas.webp')&&alpineForestSource.includes("lod==='far" ),'far forest must use the existing atlas billboard LOD');
assert.ok(alpineForestSource.includes('new THREE.RenderPipeline(renderer)')&&alpineForestSource.includes('GO_LowResolutionGodRays')&&alpineForestSource.includes('upsampleRays'),'god rays must use a separate low-resolution TSL pass and depth-aware upsampling');
assert.ok(alpineForestSource.includes('sunScreenUV.value.set(')&&alpineForestSource.includes('rayStrength.value=visible?'),'god rays must track the projected sun and disable when it is off-screen');
assert.ok(alpineForestSource.includes('sceneColor.rgb.mix(fogColor,fogResult)') && !alpineForestSource.includes('fogResult.mix(sceneColor.rgb,fogColor)'), 'forest fog composite must use fog opacity as the mix factor');
assert.ok(alpineForestSource.includes('const rangeFog = rangeT.mul(rangeT)') && alpineForestSource.includes('addScaledVector(sunPosition,100000)'), 'forest distance haze and sun projection must remain correctly framed');
assert.ok(alpineForestHtml.includes('value="16"'), 'forest preview must open at the shared neutral daytime default');
assert.ok(alpineForestHtml.includes('id="godRays"')&&alpineForestHtml.includes('id="forestDensity"'),'Alpine Forest lab controls for god rays and forest density are missing');
assert.ok(alpineForestHtml.includes('id="dayCycleToggle"')&&alpineForestHtml.includes('id="dayCycleLength"')&&alpineForestHtml.includes('id="sunIntensity"'), 'Forest Lab must expose the shared time-of-day and sun-power controls');
assert.ok(alpineForestSource.includes("from './solar-cycle.v1.js'")&&alpineForestSource.includes('calculateSolarCycle(THREE,hours)')&&alpineForestSource.includes('advanceSolarClock('), 'Forest Lab must use the shared solar path and animated day cycle');
assert.ok(alpineForestSource.includes('ui.dayLengthValue.textContent')&&!alpineForestSource.includes('ui.dayCycleLengthValue.textContent'), 'Forest Lab day-cycle label must reference the declared UI field');
assert.ok(alpineForestSource.includes('sky.mieCoefficient.value = 0.0038')&&alpineForestSource.includes('sky.rayleigh.value = Number(ui.rayleigh.value)')&&!alpineForestSource.includes('sky.mieColor.value')&&!alpineForestSource.includes('sky.mieAlbedo.value')&&!alpineForestSource.includes('sky.sunSize.value'), 'Forest Lab must write only uniforms exposed by SkyMesh in Three.js r187');
assert.ok(alpineForestSource.includes('sky.showSunDisc.value = false')&&alpineForestSource.includes('createSolarDisc(THREE)')&&alpineForestSource.includes('updateSolarDisc(THREE,sunDisc'), 'Forest Lab sun disc must respond to the direct-sun power slider');
assert.ok(alpineForestSource.includes('renderer.getMaxAnisotropy()')&&!alpineForestSource.includes('renderer.capabilities.getMaxAnisotropy'), 'Forest atlas loading must use the WebGPURenderer anisotropy API rather than WebGL capabilities');
assert.ok(alpineForestSource.includes('async function buildTerrainHeightLookup(')&&alpineForestSource.includes('function sampleTerrainSurface(')&&alpineForestSource.includes('terrainHeightLookup=await buildTerrainHeightLookup('), 'Forest Lab must precompute a spatial terrain height lookup before placing trees');
const forestPlacementSource=alpineForestSource.slice(alpineForestSource.indexOf('function buildTreePlacements('),alpineForestSource.indexOf('function createSplinePineGeometry('));
assert.ok(forestPlacementSource.includes('sampleTerrainSurface(x,z,terrainHeightLookup)')&&!forestPlacementSource.includes('intersectObject(terrainRoot,true)'), 'tree placement must query cached terrain triangles instead of raycasting the entire terrain for each tree');
assert.ok(alpineForestSource.includes("setLoadingMessage('Строим spatial height lookup для рельефа…')")&&alpineForestSource.includes("setLoadingMessage('Загружаем atlas елей…')")&&alpineForestSource.includes('Не удалось запустить WebGPU Forest Lab'), 'Forest Lab must expose loading stages and its own diagnostic error label');
pass('isolated WebGPU Alpine Forest lab: Slopes_Stage1, deterministic track-edge spruce LODs and depth-aware god rays');

// Public resort multiplayer regression checks.
const multiplayerImportMatch=entrySource.match(/import\s+\{\s*ResortMultiplayer\s*\}\s+from\s+['"]\.\/(multiplayer\.v\d+\.js)['"]/);
assert.ok(multiplayerImportMatch,'active app must import a versioned multiplayer client');
const multiplayerClientSource=read(multiplayerImportMatch[1]).toString('utf8');
const multiplayerConfigSource=read('multiplayer-config.v1.js').toString('utf8');
const multiplayerWorkerSource=read('server/src/worker.js').toString('utf8');
const multiplayerProtocolSource=read('server/src/protocol.v2.js').toString('utf8');
const multiplayerSkierSource=read('skier-controller.v98.js').toString('utf8');
assert.ok(html.includes('id="multiplayerStatus"')&&html.includes('id="multiplayerStatusText"')&&html.includes('id="clearMyFlags"')&&html.includes('aria-label="Удалить все мои флажки"')&&!html.includes('ФЛАЖКИ ·'),'multiplayer bar must keep an icon-only clear action without displaying a count');
assert.ok(entrySource.includes('new ResortMultiplayer(')&&entrySource.includes('multiplayerClient.publish(buildMultiplayerState())')&&entrySource.includes('setInterval(()=>multiplayerClient.publish(buildMultiplayerState()),33)')&&entrySource.includes('multiplayerClient.update(dt,state.mode)'),'app must publish and render multiplayer states at 30 Hz');
assert.ok(entrySource.includes("mode='skier'")&&entrySource.includes("mode='drone'")&&entrySource.includes('REMOTE_SKIER_POSE_NODES'),'app must send independent skier and drone state');
assert.ok(entrySource.includes("const clearMyFlagsButton=document.getElementById('clearMyFlags')")&&entrySource.includes('multiplayerClient.clearOwnedMarkers()')&&!entrySource.includes('ФЛАЖКИ ·')&&!entrySource.includes('refreshOwnFlagsButton'),'main toolbar must clear owned flags with an icon and never display a flag count');
assert.ok(entrySource.includes('sharedFlagRaycaster.intersectObjects(markerTargets,true)')&&entrySource.includes('multiplayerClient.removeOwnedMarker(markerId)'),'double-clicking an owned scene flag must remove it without placing a new flag underneath');
assert.ok(entrySource.includes('placeSharedFlagFromOverviewClick')&&entrySource.includes("state.mode!=='overview'")&&entrySource.includes('multiplayerClient.addMarker(point)')&&entrySource.includes('getOverviewGeometryTargets()')&&!entrySource.includes('if(!multiplayerClient.connected||!state.terrain)return;')&&entrySource.includes("addEventListener('dblclick',event=>")&&!entrySource.includes("addEventListener('click',placeSharedFlagFromOverviewClick)"),'overview double-click must place shared flags with no single-click placement');
assert.ok(multiplayerClientSource.includes('const MAX_VISIBLE_MARKERS = 40')&&multiplayerClientSource.includes('while(this.ownedMarkers.size>10)')&&multiplayerClientSource.includes('makeFlagNumberLabel(number)')&&multiplayerClientSource.includes('function makeFlagMarker(number=1)')&&multiplayerClientSource.includes('setNumber(nextNumber)')&&!multiplayerClientSource.includes("makeNameLabel(labelNumber+' · '+labelOwner)"),'client must show only the sequential number above each flag and allow ten per participant');
assert.ok(multiplayerClientSource.includes('applyMarkerSnapshot(inputMarkers,ackOwnerId=')&&multiplayerClientSource.includes('pendingMarkerChanges')&&multiplayerClientSource.includes('this.markerSyncPending=false')&&!multiplayerClientSource.includes('for(const marker of this.ownedMarkers.values())this.upsertMarker'),'server snapshots must be authoritative and stale cached flags must not be replayed');
assert.ok(multiplayerClientSource.includes("t:'marker-sync',revision,markers")&&multiplayerClientSource.includes('clearOwnedMarkers()')&&multiplayerClientSource.includes('removeOwnedMarker(id)')&&multiplayerClientSource.includes("t:'marker-clear'"),'shared flag add/remove/clear must be versioned and synchronized');
assert.ok(multiplayerClientSource.includes('publishMeasurement(points,id)')&&multiplayerClientSource.includes('flushMeasurementSync()')&&multiplayerClientSource.includes("msg.t==='measure-ack'")&&multiplayerClientSource.includes('measurementClearPending'),'shared ruler measurement must retry on reconnect and clear with a server acknowledgement');
assert.ok(multiplayerClientSource.includes('const SEND_INTERVAL_MS = 33')&&multiplayerClientSource.includes('MAX_OUTGOING_BUFFERED_BYTES')&&multiplayerClientSource.includes('socket.bufferedAmount')&&multiplayerClientSource.includes('droppedQueuedStates'),'client movement transport must run at 30 Hz and drop stale queued frames under backpressure');
assert.ok(multiplayerClientSource.includes('remote.lastSequence')&&multiplayerClientSource.includes('lastSequence:0'),'out-of-order state snapshots must not overwrite newer remote movement');
assert.ok(multiplayerClientSource.includes('sprite.scale.set(6.5,1.44,1)'),'remote player nameplate must be twice its previous size');
assert.ok(multiplayerWorkerSource.includes("from './protocol.v2.js'")&&multiplayerWorkerSource.includes("msg.t==='marker-sync'")&&multiplayerWorkerSource.includes("msg.t==='marker-clear'")&&multiplayerWorkerSource.includes('broadcastMarkerSnapshot')&&multiplayerWorkerSource.includes('clearMarkersForPlayer(player?.id)')&&multiplayerWorkerSource.includes('pruneOrphanedSharedMarkers(stored,activeMarkerOwners)'),'worker must broadcast authoritative flag snapshots and remove flags owned by disconnected sessions');
assert.ok(multiplayerWorkerSource.includes("sharedMarkerRevisions")&&multiplayerWorkerSource.includes("sharedMeasurementRevisions")&&multiplayerWorkerSource.includes("t:'measure-ack'"),'worker must revision-check marker and ruler operations and acknowledge them');
assert.ok(multiplayerWorkerSource.includes('MAX_STATE_BUFFERED_BYTES')&&multiplayerWorkerSource.includes('bufferedAmount')&&!multiplayerWorkerSource.includes("const presence={t:'presence'"),'worker must drop stale state broadcasts under backpressure and avoid redundant heartbeat presence traffic');
assert.ok(multiplayerConfigSource.includes('MULTIPLAYER_SERVER_URL'),'one-time WebSocket endpoint config is missing');
assert.ok(multiplayerWorkerSource.includes("PUBLIC_RESORT='grade-optimizer-public-resort'")&&multiplayerWorkerSource.includes('idFromName(PUBLIC_RESORT)')&&multiplayerWorkerSource.includes('acceptWebSocket'),'all visitors must connect to the same hibernatable Durable Object');
assert.ok(multiplayerWorkerSource.includes('assignMissingSlots(existing)')&&multiplayerWorkerSource.includes('slot:player.slot')&&multiplayerClientSource.includes("msg.t==='slot'"),'existing and new multiplayer connections must receive unique server-assigned slots');
assert.ok(multiplayerWorkerSource.includes("ALLOWED_ORIGIN='https://kortul.github.io'")&&multiplayerWorkerSource.includes('MAX_PLAYERS')&&multiplayerWorkerSource.includes('MAX_MESSAGES_PER_SECOND')&&multiplayerWorkerSource.includes('sanitizeClientId')&&multiplayerWorkerSource.includes('normalizeMarker')&&multiplayerWorkerSource.includes('normalizeMeasurement')&&multiplayerWorkerSource.includes("msg.t==='measure'")&&multiplayerWorkerSource.includes("msg.t==='measure-clear'")&&multiplayerWorkerSource.includes("transaction.put('sharedMeasurements',measurements)")&&multiplayerWorkerSource.includes('appendSharedMarker')&&multiplayerWorkerSource.includes('pruneOrphanedSharedMarkers')&&multiplayerWorkerSource.includes('this.ctx.storage.transaction')&&multiplayerWorkerSource.includes("transaction.put('sharedMarkers',update.markers)")&&multiplayerWorkerSource.includes('stateMessagesReceived')&&multiplayerWorkerSource.includes('Session replaced by reconnect')&&multiplayerWorkerSource.includes('if(player.left)continue'),'multiplayer relay must enforce origin, limits, persistent snapshots and stale-session pruning');
assert.ok(multiplayerProtocolSource.includes('MAX_PLAYERS = 4')&&multiplayerProtocolSource.includes('MAX_IDLE_MS = 60000')&&multiplayerProtocolSource.includes('MAX_MESSAGES_PER_SECOND = 45')&&multiplayerProtocolSource.includes('MAX_SHARED_MARKERS = MAX_PLAYERS * MAX_MARKERS_PER_PLAYER')&&multiplayerProtocolSource.includes('MAX_MARKERS_PER_PLAYER = 10')&&multiplayerProtocolSource.includes('renumberSharedMarkers')&&multiplayerProtocolSource.includes('appendSharedMarker')&&multiplayerProtocolSource.includes('pruneSharedMarkers')&&multiplayerProtocolSource.includes('pruneOrphanedSharedMarkers')&&multiplayerProtocolSource.includes('normalizeMarker')&&multiplayerProtocolSource.includes('normalizeMeasurement')&&multiplayerProtocolSource.includes('sanitizeClientId'),'public resort must allow ten numbered flags per participant and prune orphaned flags');
assert.ok(multiplayerProtocolSource.includes('normalizeState')&&multiplayerProtocolSource.includes('Number.isFinite')&&multiplayerProtocolSource.includes('JOINT_FLOATS = 72'),'server must validate transforms and skier joint data');
assert.ok(multiplayerSkierSource.includes('_findSpawn(spawnIndex=0)')&&multiplayerSkierSource.includes('multiplayerSlot:requestedSlot')&&multiplayerSkierSource.includes('const across=new THREE.Vector3().crossVectors')&&multiplayerSkierSource.includes('selectSpawnPool')&&multiplayerSkierSource.includes("spawnSearch:'grid-fallback'")&&multiplayerSkierSource.includes("spawnSearch:'last-resort'")&&multiplayerSkierSource.includes('capture: true')&&multiplayerSkierSource.includes('this.airborneWorldY=this.position.y+this.airborneHeight+0.055')&&!multiplayerSkierSource.includes('this.velocity.multiplyScalar(0.015)')&&entrySource.includes('await multiplayerClient.waitForSlot(1800)')&&entrySource.includes('skierController.diagnostics()'),'skier must retain momentum across terrain seams, fall under gravity and keep distinct starts');
pass('public shared multiplayer: ten numbered flags, authoritative removal, reliable ruler, 30 Hz backpressure-safe movement and session diagnostics');

console.log('\nAll project checks passed.');
