import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8');
const maya = read('maya/grade_optimizer_exporter.py');
const html = read('index.html');
const entryMatch = html.match(/<script\s+type=["']module["']\s+src=["']([^"']+)["']/i);
assert.ok(entryMatch, 'index.html must declare its active app module');
const entryPath = entryMatch[1].replace(/^\.\//, '').split('?')[0];
assert.match(entryPath, /^app\.v\d+\.js$/, 'index.html must activate a versioned app module');
const app = read(entryPath);
const terrain = JSON.parse(read('assets/real-terrain.json'));
const clientScene = JSON.parse(read('clients/alpine-resort/scene.json'));

assert.ok(maya.includes('VERSION = "0.9.0"'), 'Maya exporter must be 0.9.0');
assert.ok(html.includes('src="./' + entryPath + '"'), 'index.html must activate the current app module');
assert.ok(app.includes('function restoreCadBridgeWorkingCoordinates('), 'browser CAD Bridge restoration helper is missing');
assert.ok(maya.includes('SLOPE_ANALYSIS_INTERVAL_METERS = 20.0'), 'Maya slope analysis must use 20 m sections');
assert.ok(maya.includes('def export_slope_centerlines(*_):'), 'Maya centerline analysis export handler is missing');
assert.ok(maya.includes('def _slope_curve_digest(') && maya.includes('sourceDigest'), 'Maya slope analysis must cache results by curve geometry fingerprint');
assert.ok(maya.includes('def _slope_route_class_from_shares(') && maya.includes('allowance = 20.0'), 'Maya slope route grading must preserve the 20 percent harder-category rule');
assert.ok(maya.includes('АНАЛИЗ ЦЕНТРАЛЬНЫХ ЛИНИЙ СКЛОНОВ') && maya.includes('ЭКСПОРТИРОВАТЬ АНАЛИЗ СКЛОНОВ'), 'Maya exporter UI must expose the separate centerline analysis action');
assert.ok(app.includes('function renderSlopeAnalysisOverlays(') && app.includes('new THREE.LineSegments'), 'browser must render slope difficulty as lightweight line segments');
assert.ok(app.includes('new CSS2DObject') && app.includes('SlopeAnalysis_Angles') && app.includes('SlopeAnalysis_Names'), 'browser must use independent CSS2D angle and name label layers');
assert.ok(app.includes('renderSlopeAnalysisOverlays(manifest.slopeAnalysis||null)') && app.includes('slopeAnalysis:state.slopeAnalysisData||undefined'), 'slope analysis data must load and persist with the client scene');
assert.ok(html.includes('id="slopeLayersToggle"') && html.includes('id="slopeLayer_angles"') && html.includes('id="slopeLayer_difficulty"') && html.includes('id="slopeLayer_names"'), 'overview layers panel must expose all three independent toggles');

assert.ok(app.includes('gradeOptimizerTerrainTexture') && app.includes('low-frequency-albedo-no-bump'), 'terrain snow must not use the old high-frequency bump detail');

assert.ok(app.includes('logarithmicDepthBuffer:true'), 'large-scale terrain renderer must enable logarithmic depth buffering');

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
const stageOneFbx = 'clients/alpine-resort/' + stageOne.file.replace(/\.(?:glb|fbx)$/i,'.fbx');
assert.ok(existsSync(stageOneFbx), 'Original Stage1 FBX source is missing');
assert.equal(statSync(stageOneFbx).size, stageOne.mayaExport.modelSizeBytes, 'Original Stage1 FBX byte size does not match its export manifest');

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

console.log('✓ Maya exporter 0.9.0: nested CAD Bridge context, exact selection and separate mesh baking');
console.log('✓ Stage1: 22 selected meshes, valid FBX / manifest pair, inverse Bridge metadata');
console.log('✓ Canonical Terrain: existing working-world FBX retained unchanged');
console.log('✓ Browser: restores Stage1 FBX into the Terrain working-world frame and preserves metadata');
