import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8');
const maya = read('maya/grade_optimizer_exporter.py');
const app = read('app.v158.js');
const html = read('index.html');
const terrain = JSON.parse(read('assets/real-terrain.json'));
const clientScene = JSON.parse(read('clients/alpine-resort/scene.json'));

assert.ok(maya.includes('VERSION = "0.8.8"'), 'Maya exporter must be 0.8.8');
assert.ok(html.includes('src="./app.v158.js"'), 'index.html must activate app.v158.js');
assert.ok(app.includes('function restoreCadBridgeWorkingCoordinates('), 'browser CAD Bridge restoration helper is missing');

assert.ok(maya.includes('def find_working_group(node):'), 'nested CAD Bridge working-group lookup is missing');
assert.ok(maya.includes('def get_bridge_data(working_group):'), 'CAD Bridge metadata reader is missing');
assert.ok(maya.includes('cmds.listRelatives(current, parent=True, fullPath=True)'), 'working-group lookup must walk nested DAG parents');
assert.ok(maya.includes('leaf.startswith("MAYA_WORKING_SCENE")'), 'working-group lookup must resolve the enclosing Maya working scene');
assert.ok(maya.includes('working_world = bridge_scale * (original_maya - bridge_offset)'), 'CAD Bridge coordinate relation must be documented and explicit');

assert.ok(maya.includes('def _apply_inverse_bridge_to_root_matrix(export_root, bridge_context):'), 'CAD Bridge inverse matrix routine is missing');
assert.ok(maya.includes('float(matrix[12]) / scale + offset[0]') &&
          maya.includes('float(matrix[13]) / scale + offset[1]') &&
          maya.includes('float(matrix[14]) / scale + offset[2]'),
          'CAD Bridge inverse must transform all three translation axes');
assert.ok(maya.includes('_apply_inverse_bridge_to_root_matrix(baked_root, bridge_context)'), 'temporary FBX copy must remove the CAD Bridge wrapper');
assert.ok(maya.includes('mesh_fn.getPoints(om2.MSpace.kWorld)') &&
          maya.includes('mesh_fn.setPoints(points_world, om2.MSpace.kObject)'),
          'temporary FBX copies must bake world-space points into identity transforms');
assert.ok(maya.includes('cmds.xform(node, objectSpace=True, matrix=identity)'), 'temporary FBX hierarchy nodes must be reset after world-space baking');
assert.ok(maya.includes('if stage_one_export or any(find_working_group(item.get("dagPath")) for item in components):'),
          'Stage1 and any CAD Bridge working-group selection must use the temporary world-space export path');
assert.ok(maya.includes('Asset phase and Maya node names must never rewrite or filter that selection'),
          'export selection must not be filtered by phase or node names');
assert.ok(maya.includes('target_entry["mayaExport"]["components"] = list(components)'),
          'Stage1 manifest must record the exact selected mesh components');
assert.ok(maya.includes('"inverseApplied": bool(bridge_summaries)') &&
          maya.includes('"workingTransformPreserved": False'),
          'export sidecar must record whether its CAD Bridge wrapper was removed');

assert.ok(maya.includes('def replace_canonical_terrain(*_):'), 'canonical terrain replacement handler is missing');
assert.ok(maya.includes('"_canonical_terrain": True') &&
          maya.includes('"_relative_file": "assets/real-terrain.fbx"'),
          'canonical terrain must remain a separate global asset');
assert.ok(maya.includes('os.replace(temporary_model_path, export_info["model_path"])') &&
          maya.includes('os.replace(temporary_manifest_path, export_info["manifest_path"])'),
          'client FBX and scene manifest must be replaced only after export succeeds');
assert.ok(maya.includes('if shape in seen:'), 'mesh shapes under the same transform must remain separate FBX components');

const stageOne = clientScene.assets.find(asset => asset.id === 'slopes_stage1');
assert.ok(stageOne, 'Stage1 client asset must remain registered');
assert.equal(stageOne.name, 'Slopes_Stage1');
assert.equal(stageOne.category, 'slope');
assert.equal(stageOne.activeTerrain, false, 'Stage1 must not replace the canonical base terrain');
assert.deepEqual(stageOne.transform?.scale, [0.01, 0.01, 0.01]);
assert.equal(stageOne.mayaExport?.pluginVersion, '0.8.8');
assert.equal(stageOne.mayaExport?.meshComponentCount, 22);
assert.equal(stageOne.mayaExport?.components?.length, stageOne.mayaExport?.meshComponentCount);
assert.equal(stageOne.mayaExport?.cadBridge?.inverseApplied, true);
const stageOneFbx = 'clients/alpine-resort/' + stageOne.file;
assert.ok(existsSync(stageOneFbx), 'Stage1 FBX is missing');
assert.equal(statSync(stageOneFbx).size, stageOne.mayaExport.modelSizeBytes, 'Stage1 FBX byte size does not match its manifest');

assert.equal(terrain.assetId, 'real-terrain');
assert.equal(terrain.category, 'terrain');
assert.equal(terrain.file, 'assets/real-terrain.fbx');
assert.equal(terrain.mayaExport?.cadBridge?.inverseApplied, false, 'the existing canonical terrain working-world export must remain untouched');
assert.ok(existsSync(terrain.file), 'canonical terrain FBX is missing');
assert.equal(statSync(terrain.file).size, terrain.mayaExport.modelSizeBytes, 'canonical terrain FBX byte size does not match its manifest');
assert.ok(app.includes("restoreCadBridgeWorkingCoordinates(root,manifest?.mayaExport,'canonical terrain')"),
          'canonical terrain loader must honor its export metadata');
assert.ok(app.includes(String.raw`if(/\.fbx$/i.test(item.file))restoreCadBridgeWorkingCoordinates(root,item.mayaExport,item.name||item.id);`),
          'client loader must restore only source FBX files');
assert.ok(app.includes('relative?x*scale:(x-offset[0])*scale') &&
          app.includes('relative?y*scale:(y-offset[1])*scale') &&
          app.includes('relative?z*scale:(z-offset[2])*scale'),
          'browser must reverse the CAD Bridge inverse across all three vertex axes');
assert.ok(app.includes('root.scale.multiplyScalar(metersPerUnit)'),
          'canonical terrain must convert Maya linear units into metres');
assert.ok(app.includes('mayaExport:item.mayaExport||null') &&
          app.includes('mayaExport:asset.meta.mayaExport||undefined'),
          'CAD Bridge metadata must survive client load and browser backup serialization');

console.log('✓ Maya exporter 0.8.8: nested CAD Bridge context, exact selection and separate mesh baking');
console.log('✓ Stage1: 22 selected meshes, valid FBX / manifest pair, inverse Bridge metadata');
console.log('✓ Canonical Terrain: existing working-world FBX retained unchanged');
console.log('✓ Browser: restores Stage1 FBX into the Terrain working-world frame and preserves metadata');
