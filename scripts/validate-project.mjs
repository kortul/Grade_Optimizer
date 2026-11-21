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
assert.ok(existsSync(resolve(root, entry)), 'active module does not exist: ' + entry);
pass('active entrypoint exists: ' + entry);

const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(m => m[1]);
const duplicateIds = ids.filter((id, i) => ids.indexOf(id) !== i);
assert.deepEqual([...new Set(duplicateIds)], [], 'duplicate HTML ids: ' + [...new Set(duplicateIds)].join(', '));
pass('HTML ids are unique (' + ids.length + ')');

const staticDomRefs = [...read('app.v77.js').toString('utf8').matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map(m => m[1]);
assert.ok(staticDomRefs.length > 0, 'expected to find static DOM lookups in the app');
const missingDomRefs = [...new Set(staticDomRefs.filter(id => !ids.includes(id)))];
assert.deepEqual(missingDomRefs, [], 'app references missing HTML ids: ' + missingDomRefs.join(', '));
pass('all static DOM lookups resolve (' + new Set(staticDomRefs).size + ')');

const entrySource = read(entry).toString('utf8');
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
pass('forest rendering and asynchronous-load safeguards present');

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
