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
assert.equal(entry, 'app.v119.js', 'index.html must activate the current app release');
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
assert.ok(entrySource.includes('weather-system.v2.js'), 'active app must use the camera-space weather fix');
const weatherSource = read('weather-system.v2.js').toString('utf8');
assert.ok(weatherSource.includes("this.cameraWeatherRig = new THREE.Group()"), 'weather camera-follow scene root missing');
assert.ok(weatherSource.includes('this.scene.add(this.cameraWeatherRig)'), 'camera-follow weather layer must belong to the renderable scene graph');
assert.ok(weatherSource.includes('this.cameraWeatherRig.add(this.snow)')&&weatherSource.includes('this.cameraWeatherRig.add(this.streaks)'), 'snow and wind streaks must be children of the renderable camera-follow root');
assert.ok(weatherSource.includes('this.camera.getWorldQuaternion(this.cameraWeatherRig.quaternion)')&&weatherSource.includes('this.cameraWeatherRig.position.copy(this.cameraPosition)'), 'weather layer must follow the current camera transform every frame');
assert.ok(weatherSource.includes('this.snowCount = 2200')&&weatherSource.includes('this.snowMaterial.opacity = 0.84 + this.params.snowfall * 0.12'), 'snowfall density and contrast must remain visible');
for (const preset of ['clear','light','partly','cloudy','overcast','snow','blizzard']) {
  assert.ok(weatherSource.includes(preset + ':'), 'weather preset missing from runtime: ' + preset);
  assert.ok(html.includes('data-weather-preset="' + preset + '"'), 'weather preset button missing from UI: ' + preset);
}
assert.ok(entrySource.includes('weatherPresetButtons.forEach(button =>')&&entrySource.includes('applyWeatherPreset(button.dataset.weatherPreset)'), 'weather preset buttons must apply the selected runtime preset');
assert.ok(!entrySource.includes("weather-open'))setWeatherPanelOpen(false)"), 'changing to skier / drone mode must not forcibly close weather settings');
assert.doesNotMatch(html,/#[^\n]*skier-mode #weatherPanel[^\n]*display:none|#[^\n]*drone-mode #weatherPanel[^\n]*display:none/, 'weather panel must remain available in skier and drone modes');
assert.ok(html.includes('#app.weather-open #weatherPanel{display:block}'), 'weather panel open state CSS missing');
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

const sceneLookKeys = ['general','environment','camera','color','materials','render'];
assert.ok(html.includes('role="tablist" aria-label="Scene Look categories"'), 'Scene Look tablist is missing');
for (const key of sceneLookKeys) {
  assert.ok(html.includes('data-look-tab="' + key + '"'), 'Scene Look tab missing: ' + key);
  assert.ok(html.includes('data-look-panel="' + key + '"'), 'Scene Look tab panel missing: ' + key);
}
assert.ok(html.includes('scene-editor-gear'), 'Scene Editor gear icon is missing');
assert.ok(html.includes('aria-label="Scene Editor"'), 'Scene Editor icon button needs an accessible label');
assert.ok(entrySource.includes('function bindSceneLookTabs()'), 'Scene Look tab behavior is missing');
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
assert.ok(entrySource.includes('skier-controller.v80.js'), 'active app must use the current skier controller');
const skierSource = read('skier-controller.v80.js').toString('utf8');
assert.ok(skierSource.includes("tuck: this.keys.has('w') || this.keys.has('arrowup')"), 'skier tuck state missing from HUD payload');
assert.ok(skierSource.includes('pushing:push&&!airborne,airborne,tuck'), 'skier push, airborne and stance state missing from movement HUD payload');
assert.ok(droneSource.includes('boostSpeed=120/3.6'), 'drone boost must cap at 120 km/h');
assert.ok(droneSource.includes("this.keys.has('shift')?this.boostSpeed:this.speed"), 'Shift must activate drone boost');
assert.ok(droneSource.includes("(this.keys.has('control')?1:0)"), 'Ctrl must control drone descent');
assert.ok(entrySource.includes("tuck?'Скоростная стойка':'Обычная езда'"), 'ordinary skiing / speed tuck status labels missing from HUD');
assert.ok(entrySource.includes("panel.content.style.setProperty('display',visible?'grid':'none','important')"), 'tutorial visibility must force display state');
assert.ok(skierSource.includes('this._tryBumpJump(this.velocity.length())'), 'skier bump jump must be integrated into movement');
assert.ok(skierSource.includes('speed<14.5||this.lastLongitudinalAccel<2.8'), 'bump jump must require high speed and strong acceleration');
assert.ok(skierSource.includes('this.airborneVelocityY=this.bumpJumpImpulseNs/this.massKg'), 'bump jump lift must remain small and ballistic');
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
assert.ok(entrySource.includes('dayTime:16'), 'default scene time must start at 16:00');
assert.match(html, /id="timeOfDay"[^>]*value="16"/, 'default time slider must start at 16:00');
assert.ok(html.includes('id="timeValue">16:00') && html.includes('id="timeCompactValue">16:00'), 'both default time labels must show 16:00');
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
assert.ok(skierSource.includes('this.pushImpulseNs = 60;') && skierSource.includes('this.pushInterval = 0.42'), 'pole push must use a mass-scaled impulse');
assert.ok(skierSource.includes("if (e.code === 'Space')"), 'Space jump key handler missing');
assert.ok(skierSource.includes('if (!e.repeat && this.inputEnabled) this._tryManualJump();'), 'Space must trigger once per press and respect transition lock');
assert.ok(skierSource.includes('this.manualJumpImpulseNs = 195;'), 'manual jump impulse missing');
assert.ok(skierSource.includes('this.airborneVelocityY=this.manualJumpImpulseNs/this.massKg;'), 'take-off speed must be impulse divided by mass');
assert.ok(skierSource.includes('this.airborneWorldY=contact.point.y+0.055;'), 'jump must start at ski contact height');
assert.ok(skierSource.includes('this.jumpCooldown=0.68;'), 'manual jump cooldown missing');
assert.ok(skierSource.includes('const contact=this._groundAt(this.position.x,this.position.z);'), 'manual jump must confirm snow contact');
assert.ok(skierSource.includes('Flight has aerodynamic drag only: no ski friction, poles or edge force.'), 'airborne state must not apply ski-snow contact forces');
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
const jumpTakeoffSpeed=195/referenceMassKg;
const jumpApexM=jumpTakeoffSpeed*jumpTakeoffSpeed/(2*9.81);
assert.ok(jumpApexM>0.32&&jumpApexM<0.37, 'manual jump should be a modest ~0.34 m hop');
const skierHudSource = html.slice(html.indexOf('<div id="skierHud"'), html.indexOf('<div id="droneHud"'));
assert.ok(skierHudSource.includes('<kbd>SHIFT</kbd> — толчок палками. <kbd>SPACE</kbd> — прыжок.'), 'skier tutorial must document separate push and jump keys');
assert.ok(skierHudSource.includes('<kbd>SPACE</kbd></div><div><strong>Прыжок</strong>'), 'skier control grid must show Space jump');
assert.ok(!skierHudSource.includes('<kbd>SHIFT</kbd> / <kbd>SPACE</kbd> — толчок'), 'old combined push hint must be removed');
assert.ok(skierSource.includes('const yaw=this.headingYaw;'), 'pole strokes must follow ski heading, not camera look direction');
assert.ok(skierSource.includes('if(!locked)this.keys.clear();'), 'lost pointer lock must clear stuck movement keys');
assert.ok(skierSource.includes('const grounded=!!nextHit&&!airborne;'), 'HUD grounded state must be false while airborne');
assert.ok(skierSource.includes('grounded: this.active&&this.airborneWorldY===null'), 'friction control must preserve airborne HUD state');
assert.ok(skierSource.includes('this.terrain.traverse(object=>{\n      if(object.isMesh&&object.geometry?.attributes?.position)meshes.push(object);'), 'skier spawn search must support grouped Terrain meshes');
assert.ok(skierSource.includes('const sampleStride=Math.max(1,Math.ceil(totalVertices/12000));'), 'grouped terrain spawn sampling must have a bounded vertex workload');
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
assert.ok(mayaExporter.includes('def collect_node_metadata(selection_only=False):'), 'Maya metadata exporter missing');
assert.ok(mayaExporter.includes('"nodeMetadata": node_metadata'), 'Maya manifest must export per-node metadata');
assert.ok(mayaExporter.includes('def apply_metadata_to_selection('), 'Maya metadata UI action missing');
assert.ok(mayaExporter.includes('"C:/zGit/GradeOptimizer/Grade_Optimizer"') && mayaExporter.includes('OPTION_REPO'), 'Maya exporter remembered default path must target the actual nested local repository root');
assert.match(mayaExporter, /WINDOW \+ "_selection",\s*label="Export selected objects only",\s*value=True/, 'Maya exporter must default to selected objects only');
assert.ok(mayaExporter.includes('label="Project ID"'), 'Maya exporter must use the clearer Project ID label');
assert.ok(mayaExporter.includes('Project ID: латиница'), 'Maya exporter project ID validation message missing');
assert.ok(mayaExporter.includes('METADATA_PRESETS = {'), 'Maya exporter metadata presets missing');
const mayaPresetSource = mayaExporter.slice(mayaExporter.indexOf('METADATA_PRESETS = {'), mayaExporter.indexOf('def safe_path'));
assert.ok(!mayaPresetSource.includes('"collision"') && !mayaPresetSource.includes('"forestBlocker"'), 'Maya metadata presets must not assign editor-owned Collision / Forest blocker flags');
assert.ok(mayaExporter.includes('"Рельеф"') && mayaExporter.includes('"Здание"') && mayaExporter.includes('"Подъёмник / опора"'), 'common Maya metadata presets missing');
assert.ok(mayaExporter.includes('cmds.optionMenuGrp(') && mayaExporter.includes('changeCommand=on_metadata_preset_changed'), 'metadata preset dropdown missing');
assert.ok(mayaExporter.includes('OPTION_PRESET') && mayaExporter.includes('OPTION_PROJECT') && mayaExporter.includes('remember_export_settings'), 'Maya exporter settings must persist between launches');
assert.ok(mayaExporter.includes('def clear_metadata_from_selection('), 'clear metadata selection action missing');
assert.ok(mayaExporter.includes('collapsable=True') && mayaExporter.includes('collapse=True'), 'Maya metadata controls must be collapsed by default');
assert.ok(!mayaExporter.includes('WINDOW + "_role"') && !mayaExporter.includes('WINDOW + "_tags"'), 'legacy always-visible Role / Tags text fields must not return');
assert.ok(!mayaExporter.includes('WINDOW + "_node_collision"') && !mayaExporter.includes('WINDOW + "_node_forest"'), 'Collision / Forest blocker controls belong in Web Editor, not Maya Exporter');
const mayaCollector = mayaExporter.slice(mayaExporter.indexOf('def collect_node_metadata('), mayaExporter.indexOf('def _set_string_attribute'));
assert.ok(!mayaCollector.includes('goCollision') && !mayaCollector.includes('goForestBlocker'), 'Maya exporter must not import editor-owned flags from Maya attributes');

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
assert.ok(entrySource.includes('function pulseEditorSelection(target){'), 'scene editor selection pulse effect missing');
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
assert.ok(read('maya/grade_optimizer_exporter.py').toString('utf8').includes('_option_string(OPTION_PROJECT, "alpine-resort")'), 'Maya Exporter default Project ID must match the Web Editor default');
assert.ok(html.includes('ЭКСПОРТ JSON-БЭКАПА'), 'manual JSON export must be clearly marked as an optional backup');



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
assert.ok(!html.includes('id="skierSkiFileInput"') && !html.includes('id="importSkierSkiButton"') && !html.includes('id="resetSkierSkiButton"') && !html.includes('id="skierSkiModelStatus"'), 'dedicated skier ski replacement UI must be absent');
assert.ok(!entrySource.includes('saveSkierSkiLocally') && !entrySource.includes('loadSavedSkierSki') && !entrySource.includes('removeSavedSkierSki'), 'skier-only ski upload and restore handlers must be absent');
assert.ok(entrySource.includes('openLocalAssetDatabase') && entrySource.includes('saveSceneAssetLocally'), 'shared Scene Editor local asset storage must remain');
for(const id of ['outsideSkiLoadValue','insideSkiLoadValue','outsideSkiLoadBar','totalSkiLoadValue'])assert.ok(html.includes('id="'+id+'"'), 'ski load HUD element missing: '+id);
assert.ok(entrySource.includes('outsideSkiLoadValueEl') && entrySource.includes('insideSkiLoadValueEl') && entrySource.includes('outsideSkiLoadBarEl'), 'ski loads must be shown in HUD');
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

console.log('\nAll project checks passed.');
