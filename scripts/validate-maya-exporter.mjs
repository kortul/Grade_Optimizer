import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const maya = readFileSync('maya/grade_optimizer_exporter.py', 'utf8');
const app = readFileSync('app.v157.js', 'utf8');
const terrain = JSON.parse(readFileSync('assets/real-terrain.json', 'utf8'));
const clientScene = JSON.parse(readFileSync('clients/alpine-resort/scene.json', 'utf8'));

assert.ok(maya.includes('VERSION = "0.7.7"'), 'Maya exporter must be 0.7.7');
assert.ok(maya.includes('"_canonical_terrain": True'), 'canonical base terrain must appear in the replacement tree');
assert.ok(maya.includes('"_relative_file": "assets/real-terrain.fbx"'), 'canonical terrain must use the global FBX path');
assert.ok(maya.includes('if asset.get("_canonical_terrain"):'), 'tree selection must route canonical terrain to its dedicated replacement handler');
assert.ok(maya.includes('def replace_canonical_terrain(*_):'), 'dedicated canonical terrain replacement handler is missing');
assert.ok(maya.includes('def _create_canonical_terrain_export_copy('), 'temporary terrain copy routine is missing');
assert.ok(maya.includes('point.x / bridge_scale + offset[0]') &&
          maya.includes('point.y / bridge_scale + offset[1]') &&
          maya.includes('point.z / bridge_scale + offset[2]'),
          'CAD Bridge inverse must be applied to all three vertex coordinates');
assert.ok(maya.includes('if working_group and not bridge_data:'), 'working-scene export must refuse missing CAD Bridge metadata');
assert.ok(maya.includes('os.replace(temporary_model_path, model_path)') &&
          maya.includes('os.replace(temporary_manifest_path, manifest_path)'),
          'terrain FBX and manifest must be replaced together');
assert.ok(maya.includes('if shape in seen:'), 'mesh shapes under the same transform must remain separately recorded');
assert.ok(!maya.includes('Защита: базовый рельеф assets/real-terrain.fbx не входит в список'), 'obsolete base-terrain exclusion warning must be removed');

assert.equal(terrain.assetId, 'real-terrain');
assert.equal(terrain.file, 'assets/real-terrain.fbx');
assert.ok(clientScene.assets.some(asset => asset.id === 'slopes_stage1'), 'Stage1 client asset must remain registered');
assert.ok(app.includes('function loadCanonicalTerrainFbx('), 'runtime canonical terrain loader is missing');

console.log('✓ Maya 0.7.7 base-terrain replacement and CAD Bridge inverse are wired correctly');
console.log('✓ Stage1 remains an independent client-scene asset; no mesh-merge requirement was introduced');
