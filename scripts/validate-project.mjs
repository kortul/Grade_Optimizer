import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const read = path => readFileSync(resolve(root, path));
const pass = message => console.log('✓ ' + message);

const html = read('index.html').toString('utf8');
const entryMatch = html.match(/<script\s+type=["']module["']\s+src=["']([^"']+)["']/i);
assert.ok(entryMatch, 'index.html must declare a module entrypoint');
const entry = entryMatch[1].replace(/^\.\//, '');
const entrySource = read(entry).toString('utf8');
assert.ok(existsSync(resolve(root, entry)), 'active module does not exist: ' + entry);
pass('active entrypoint exists: ' + entry);

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
const modulePaths = [entry, ...localImports.map(p => resolve(dirname(entry), p))];
for (const path of modulePaths) {
  assert.ok(existsSync(resolve(root, path)), 'missing local JS import: ' + path);
  const source = read(path).toString('utf8');
  const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], {
    input: source, encoding: 'utf8'
  });
  assert.equal(syntax.status, 0, 'JavaScript syntax error in ' + path + ':\n' + (syntax.stderr || syntax.stdout));
  pass('JavaScript syntax valid: ' + path);
}

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
assert.match(entrySource, /loadSequence=\+\+slopeLoadSequence/, 'stale slope-load guard missing');
assert.match(entrySource, /if\(document\.hidden\)/, 'background render pause missing');
assert.ok(entrySource.includes('drone-controller.v72.js'), 'active app must use the current drone controller');
const droneSource = read('drone-controller.v72.js').toString('utf8');
assert.ok(droneSource.includes('intersectObject(this.terrain,true)'), 'drone terrain raycast missing');
assert.ok(droneSource.includes('minimumTerrainClearance=2.5'), 'drone terrain clearance missing');
assert.ok(droneSource.includes('enforceTerrainClearance(nextPosition)'), 'drone movement collision guard missing');
assert.ok(droneSource.includes('terrainBoundsMargin=100'), 'drone 100 m terrain bounds margin missing');
assert.ok(droneSource.includes('clampToTerrainBounds(this.camera.position)'), 'drone entry position is not clamped to the terrain bounds');
assert.ok(droneSource.includes('clampToTerrainBounds(nextPosition)'), 'drone movement is not clamped to the terrain bounds');
assert.ok(entrySource.includes('function fitModeHudToViewport(){'), 'viewport-aware HUD fitting function missing');
assert.ok(entrySource.includes('new ResizeObserver(scheduleModeHudFit)'), 'HUD resize observer missing');
assert.ok(entrySource.includes('skier-controller.v73.js'), 'active app must use the current skier controller');
const skierSource = read('skier-controller.v73.js').toString('utf8');
assert.ok(skierSource.includes("tuck: this.keys.has('w') || this.keys.has('arrowup')"), 'skier tuck state missing from HUD payload');
assert.ok(skierSource.includes('pushing:push,\n      tuck'), 'skier stance state missing from movement HUD payload');
assert.ok(droneSource.includes('boostSpeed=120/3.6'), 'drone boost must cap at 120 km/h');
assert.ok(droneSource.includes("this.keys.has('shift')?this.boostSpeed:this.speed"), 'Shift must activate drone boost');
assert.ok(droneSource.includes("(this.keys.has('control')?1:0)"), 'Ctrl must control drone descent');
assert.ok(entrySource.includes("tuck?'Скоростная стойка':'Обычная езда'"), 'ordinary skiing / speed tuck status labels missing from HUD');
assert.ok(entrySource.includes("panel.content.style.setProperty('display',visible?'grid':'none','important')"), 'tutorial visibility must force display state');
assert.ok(skierSource.includes('this._tryBumpJump(this.velocity.length())'), 'skier bump jump must be integrated into movement');
assert.ok(skierSource.includes('speed<14.5||this.lastLongitudinalAccel<2.8'), 'bump jump must require high speed and strong acceleration');
assert.ok(skierSource.includes('this.airborneVelocityY=2.7'), 'bump jump lift must remain small and ballistic');
assert.ok(skierSource.includes('this.jumpCooldown=1.35'), 'bump jump cooldown missing');
assert.ok(skierSource.includes('this.position.y+this.eyeHeight+this.airborneHeight'), 'camera must lift during a jump');
assert.ok(skierSource.includes('setSkiModel(source)'), 'skier model replacement API missing');
assert.ok(skierSource.includes('this.skiSlots.push({group:ski,board,stripe,customMount})'), 'custom ski mounts missing from both ski slots');
assert.ok(html.includes('id="importAssetCategory"'), 'model import category selector missing');
assert.ok(html.includes('accept=".glb,.fbx'), 'model import input must accept GLB and FBX');
assert.ok(html.includes('id="editorTreeExpandAll"') && html.includes('id="editorTreeCollapseAll"'), 'Outliner expand/collapse controls missing');
assert.ok(entrySource.includes('function selectEditorNode(owner,node'), 'nested Object3D selection missing');
assert.ok(entrySource.includes('editorNodeKey(owner,node)'), 'hierarchy node identity helper missing');
assert.ok(entrySource.includes('function editorNodeHasSearchMatch('), 'recursive hierarchy search missing');
assert.ok(entrySource.includes('selectEditorNode(picked,hit.object)'), 'viewport selection must target the actual nested mesh');
assert.ok(entrySource.includes('asset.sourceBuffer=await exportAssetForClientPublish(asset)'), 'edited hierarchy must be serialized for local persistence');
assert.ok(entrySource.includes("from 'three/addons/loaders/FBXLoader.js'"), 'FBXLoader import missing');
assert.ok(entrySource.includes("function parseSceneModel("), 'generic GLB/FBX parser missing');
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
assert.ok(html.includes('id="clientWorkspaceId"'), 'client workspace ID field missing');
assert.ok(html.includes('id="openClientWorkspaceButton"'), 'open client scene control missing');
assert.ok(html.includes('id="publishClientWorkspaceButton"'), 'publish client scene control missing');
assert.ok(html.includes('id="githubPublisherToken"'), 'GitHub publisher token field missing');
assert.ok(entrySource.includes("function openClientWorkspace("), 'remote client scene loader missing');
assert.ok(entrySource.includes("function publishClientWorkspace("), 'GitHub client scene publisher missing');
assert.ok(entrySource.includes("function githubPublisherRequest("), 'GitHub REST publishing helper missing');
assert.ok(entrySource.includes("clients/'+slug+'/scene.json"), 'client scene repository namespace missing');
assert.ok(entrySource.includes("clients/'+slug+'/'+item.file"), 'client model loading path missing');
assert.ok(entrySource.includes("'/git/blobs'") && entrySource.includes("'/git/trees'") && entrySource.includes("'/git/commits'"), 'Git object commit flow missing');
assert.ok(entrySource.includes("'/git/refs/heads/main'"), 'main branch update missing');
assert.ok(entrySource.includes("await openClientWorkspace(currentClientSlug,{updateUrl:false})"), 'client URL auto-load missing');
assert.ok(entrySource.includes("Authorization:'Bearer '+githubAdminToken"), 'GitHub publisher authentication missing');
assert.ok(entrySource.includes("if(currentClientSlug||!asset||asset.sourceType==='scene'||!asset.sourceBuffer)return;"), 'client models still depend on local persistence');
assert.ok(entrySource.includes("buffer.byteLength>90*1024*1024"), 'large model upload guard missing');
assert.ok(entrySource.includes('function exportAssetForClientPublish('), 'GLB export for changed client models missing');
assert.ok(entrySource.includes('editorSelectedAsset.meta.modelDirty=true'), 'PBR changes are not marked for publish');
assert.ok(entrySource.includes('if(!asset.meta.modelDirty)continue'), 'unchanged models should not be uploaded again');
pass('shared per-client scene loading and GitHub publishing flow are present');


pass('forest rendering, collision bounds and viewport-aware HUD safeguards present');

assert.ok(entrySource.includes("if(e.code==='KeyV'&&(state.mode==='skier'||state.mode==='drone'))"), 'V-only mode switch missing');
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
assert.ok(html.includes('SHIFT</kbd> — ускорение до 120 км/ч'), 'drone tutorial must document Shift boost to 120 km/h');
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
assert.ok(html.includes('id="skierSkiFileInput"'), 'skier ski GLB input missing');
assert.ok(html.includes('id="importSkierSkiButton"'), 'skier ski import button missing');
assert.ok(html.includes('id="resetSkierSkiButton"'), 'skier ski reset button missing');
assert.ok(html.includes('id="skierSkiModelStatus"'), 'skier ski import status missing');
assert.ok(html.includes('#legend{display:none!important}'), 'legend must be hidden outside slope optimization');
assert.ok(html.includes('#app.optimizer-open:not(.editor-open):not(.skier-mode):not(.drone-mode) #legend{display:flex!important}'), 'legend must be shown only for slope optimization');
assert.ok(entrySource.includes('skierController.setSkiModel(model)'), 'Scene Editor must pass imported ski GLB to skier controller');
assert.ok(entrySource.includes("indexedDB.open(SKIER_SKI_DB_NAME,1)"), 'custom ski model must be persisted in browser IndexedDB');
assert.ok(entrySource.includes('saveSkierSkiLocally(buffer,file.name)'), 'uploaded ski GLB must be saved locally');
assert.ok(entrySource.includes('loadSavedSkierSki()'), 'custom ski GLB must be restored on startup');
assert.ok(entrySource.includes('removeSavedSkierSki()'), 'reset must remove the locally saved custom ski');
assert.ok(entrySource.includes("if(state.optimizeMode)setOptimizerOpen(false)"), 'Overview must close the optimization panel');

assert.ok(entrySource.includes('const animateModeTransition='), 'cinematic skier/drone mode transition missing');
assert.ok(entrySource.includes('camera.position.y+=3'), 'drone must start exactly 3 m above the skier camera when switching from skier mode');
assert.ok(entrySource.includes('camera.quaternion.copy(transition.fromQuaternion).slerp(transition.toQuaternion,eased)'), 'camera orientation must interpolate smoothly during a mode transition');
assert.ok(entrySource.includes('camera.fov=transition.baseFov+Math.sin(Math.PI*eased)*4.5'), 'cinematic camera FOV easing missing');
assert.ok(entrySource.includes('if(pathGround!==null)camera.position.y=Math.max(camera.position.y,pathGround+1.55)'), 'mode transition camera must stay above terrain');
assert.ok(entrySource.includes('skierController.enableInput()') && entrySource.includes('droneController.enableInput()'), 'target mode input must unlock after cinematic transition');
assert.ok(skierSource.includes('{deferInput=false}={}') && skierSource.includes('this.inputEnabled=!deferInput'), 'skier controller must support deferred input');
assert.ok(skierSource.includes('enableInput(){'), 'skier controller input handoff missing');
assert.ok(droneSource.includes('{deferInput=false}={}') && droneSource.includes('this.inputEnabled=!deferInput'), 'drone controller must support deferred input');
assert.ok(droneSource.includes('enableInput(){'), 'drone controller input handoff missing');

pass('cinematic mode transition, terrain clearance and deferred controls are present');

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
assert.ok(entrySource.includes('skierController.showForDrone()'), 'first-person skier must be shown to the drone during handoff');
assert.ok(entrySource.includes("skierController.stop({keepSceneModel:mode==='drone'})"), 'skier model must remain in the scene when entering drone mode');
assert.ok(entrySource.includes("if(mode==='overview')skierController.hideForOverview()"), 'skier model must be hidden when leaving drone for overview');
assert.ok(skierSource.includes('0.48*this.stanceCameraBlend'), 'first-person camera lowering in speed tuck missing');
assert.ok(skierSource.includes('0.085*this.stanceCameraBlend'), 'camera pitch adjustment in speed tuck missing');
assert.ok(skierSource.includes('this.avatarLegs.forEach'), 'third-person skier legs must bend into speed tuck');
assert.ok(skierSource.includes('0.46*this.stanceCameraBlend'), 'third-person skier torso must lean into speed tuck');
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

console.log('\nAll project checks passed.');
