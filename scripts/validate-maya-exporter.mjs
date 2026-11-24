import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const maya = readFileSync('maya/grade_optimizer_exporter.py', 'utf8');
const app = readFileSync('app.v157.js', 'utf8');
const terrain = JSON.parse(readFileSync('assets/real-terrain.json', 'utf8'));
const clientScene = JSON.parse(readFileSync('clients/alpine-resort/scene.json', 'utf8'));

assert.ok(maya.includes('VERSION = "0.7.9"'), 'Maya exporter must be 0.7.9');
assert.ok(maya.includes('"_canonical_terrain": True'), 'canonical base terrain must appear in the replacement tree');
assert.ok(maya.includes('"_relative_file": "assets/real-terrain.fbx"'), 'canonical terrain must use the global FBX path');
assert.ok(maya.includes('if asset.get("_canonical_terrain"):'), 'tree selection must route canonical terrain to its dedicated replacement handler');
assert.ok(maya.includes('def replace_canonical_terrain(*_):'), 'dedicated canonical terrain replacement handler is missing');
assert.ok(maya.includes('def _bake_export_root_to_world_meshes('), 'temporary world-space FBX copy routine is missing');
assert.ok(maya.includes('def _apply_inverse_bridge_to_root_matrix('), 'CAD Bridge inverse matrix routine is missing');
assert.ok(maya.includes('float(matrix[12]) / scale + offset[0]') &&
          maya.includes('float(matrix[13]) / scale + offset[1]') &&
          maya.includes('float(matrix[14]) / scale + offset[2]'),
          'CAD Bridge inverse must restore all three world-coordinate axes');
assert.ok(maya.includes('mesh_fn.getPoints(om2.MSpace.kWorld)') &&
          maya.includes('mesh_fn.setPoints(points_world, om2.MSpace.kObject)'),
          'temporary FBX copies must bake world-space points into identity transforms');
assert.ok(maya.includes('if stage_one:') && maya.includes('node.rsplit("|", 1)[-1].lower() == "tosketchfab"'),
          'Stage1 export must normalize CAD/ToSketchfab scale hierarchy before baking');
assert.ok(maya.includes('target_entry["mayaExport"]["geometryBakedToMayaWorld"] = True') &&
          maya.includes('target_entry["mayaExport"]["stageOneHierarchyNormalizedAtExport"] = bool(stage_one_export)'),
          'Stage1 replacement must record that CAD and hierarchy transforms were baked');
assert.ok(maya.includes('os.replace(temporary_model_path, model_path)') &&
          maya.includes('os.replace(temporary_manifest_path, manifest_path)'),
          'terrain FBX and manifest must be replaced together');
assert.ok(maya.includes('if shape in seen:'), 'mesh shapes under the same transform must remain separately recorded');
assert.ok(!maya.includes('Защита: базовый рельеф assets/real-terrain.fbx не входит в список'), 'obsolete base-terrain exclusion warning must be removed');

assert.equal(terrain.assetId, 'real-terrain');
assert.equal(terrain.file, 'assets/real-terrain.fbx');
assert.ok(clientScene.assets.some(asset => asset.id === 'slopes_stage1'), 'Stage1 client asset must remain registered');
assert.ok(app.includes('function loadCanonicalTerrainFbx('), 'runtime canonical terrain loader is missing');

assert.ok(maya.includes('def find_working_group(node):'), 'nested CAD Bridge working-group lookup is missing');
assert.ok(maya.includes('def get_bridge_data(working_group):'), 'CAD Bridge metadata reader is missing');
assert.ok(maya.includes('cmds.listRelatives(current, parent=True, fullPath=True)'), 'working-group lookup must walk nested DAG parents');
assert.ok(maya.includes('leaf.startswith("MAYA_WORKING_SCENE")'), 'working-group lookup must resolve the enclosing Maya working scene');
console.log('✓ Maya 0.7.9 nested CAD Bridge lookup, base terrain and Stage1 baking are wired correctly');
console.log('✓ Stage1 remains an independent client-scene asset; no mesh-merge requirement was introduced');
