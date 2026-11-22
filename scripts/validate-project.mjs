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
assert.ok(entrySource.includes('drone-controller.v70.js'), 'active app must use the bounded drone controller');
const droneSource = read('drone-controller.v69.js').toString('utf8');
assert.ok(droneSource.includes('intersectObject(this.terrain,true)'), 'drone terrain raycast missing');
assert.ok(droneSource.includes('minimumTerrainClearance=2.5'), 'drone terrain clearance missing');
assert.ok(droneSource.includes('enforceTerrainClearance(nextPosition)'), 'drone movement collision guard missing');
assert.ok(droneSource.includes('terrainBoundsMargin=100'), 'drone 100 m terrain bounds margin missing');
assert.ok(droneSource.includes('clampToTerrainBounds(this.camera.position)'), 'drone entry position is not clamped to the terrain bounds');
assert.ok(droneSource.includes('clampToTerrainBounds(nextPosition)'), 'drone movement is not clamped to the terrain bounds');
assert.ok(entrySource.includes('function fitModeHudToViewport(){'), 'viewport-aware HUD fitting function missing');
assert.ok(entrySource.includes('new ResizeObserver(scheduleModeHudFit)'), 'HUD resize observer missing');
pass('forest rendering, collision bounds and viewport-aware HUD safeguards present');

assert.match(entrySource, /e\\.code==='KeyV'\\|\\|\\(e\\.code==='Tab'&& !focusIsControl\\)/, 'V / TAB mode-switch shortcut missing');
assert.match(entrySource, /focusIsControl/, 'keyboard Tab focus navigation guard missing');
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
assert.ok(html.includes('id="skierTutorialContent" class="mode-hud-collapsible"'), 'skier tutorial wrapper missing');
assert.ok(html.includes('id="droneTutorialContent" class="mode-hud-collapsible"'), 'drone tutorial wrapper missing');
assert.ok(html.includes('max-height:none!important;height:auto!important;overflow:visible!important;'), 'HUD must not scroll or clip vertically');
assert.ok(html.includes('height:auto!important;overflow:visible!important;padding:0!important;margin:0!important;'), 'tutorial content must not scroll');
assert.ok(html.includes('grid-template-columns:minmax(0,.88fr) minmax(0,1.12fr)'), 'tutorial and key guide must use side-by-side layout');
assert.ok(html.includes('transform-origin:bottom left!important'), 'HUD must scale from its bottom edge to stay inside the viewport');
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
