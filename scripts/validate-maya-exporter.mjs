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
const sceneSchema = JSON.parse(read('scene-manifest.schema.json'));
assert.ok(sceneSchema.properties?.treeMarkers?.properties?.markers?.items?.properties?.markerType, 'Scene schema must allow tree point and circle marker records');
assert.ok(sceneSchema.properties.treeMarkers.properties.markers.items.properties.radiusMeters, 'Scene schema must allow optional point radius and circle radius metadata');

assert.ok(maya.includes('VERSION = "0.9.4"'), 'Maya exporter must be 0.9.4');
assert.ok(html.includes('src="./' + entryPath + '"'), 'index.html must activate the current app module');
assert.ok(app.includes('function restoreCadBridgeWorkingCoordinates('), 'browser CAD Bridge restoration helper is missing');
assert.ok(maya.includes('def _sample_slope_curve_points(') && maya.includes('"points": _sample_slope_curve_points('), 'Maya must export raw sampled NURBS points');
assert.ok(maya.includes('def _slope_points_cm_to_meters('), 'Maya raw curve export must convert API world centimetres to metres');
assert.ok(maya.includes('def export_slope_centerlines(*_):'), 'Maya centerline geometry export handler is missing');
assert.ok(maya.includes('def _slope_curve_digest(') && maya.includes('sourceDigest'), 'Maya curve export must cache raw geometry by curve fingerprint');

assert.ok(maya.includes('ЭКСПОРТ ЦЕНТРАЛЬНЫХ ЛИНИЙ СКЛОНОВ') && maya.includes('ЭКСПОРТИРОВАТЬ КРИВЫЕ СКЛОНОВ'), 'Maya exporter UI must expose raw centerline geometry export');
assert.ok(maya.includes('manifest["slopeCurves"]') && maya.includes('"coordinateSystem": "project-world"') && maya.includes('"worldFrame": "maya-working-world"') && maya.includes('"units": "meters"'), 'Maya must store raw curve geometry in Maya working-world metres');
assert.ok(maya.includes('"coordinateFrame": "maya-working-world-v2"') && maya.includes('"coordinateFrameVersion": 2'), 'Maya curve digest and manifest must version the corrected working-world coordinate frame');
assert.ok(maya.includes('curve_fn.getPointAtParam(parameter, om2.MSpace.kWorld)') && maya.includes('return _slope_points_cm_to_meters(sampled)'), 'Slope centerlines must retain the full Maya world transform and only convert API centimetres to metres');
assert.ok(!maya.includes('def _slope_correct_bridge_points(') && !maya.includes('original_scene_point'), 'Slope centerlines must not have the CAD Bridge inverse applied a second time');
assert.ok(maya.includes('record["workingGroup"] = bridge_context["group"]'), 'Each exported centerline must retain its enclosing MAYA_WORKING_SCENE provenance');
assert.ok(!maya.includes('def _slope_route_class_from_shares(') && !maya.includes('def _build_slope_analysis_record('), 'Maya exporter must not calculate slope grades or difficulty');
assert.ok(app.includes('function renderSlopeAnalysisOverlays(') && app.includes('new THREE.LineSegments'), 'browser must render slope difficulty as lightweight line segments');
assert.ok(app.includes('new CSS2DObject') && app.includes('SlopeAnalysis_Angles') && app.includes('SlopeAnalysis_Names'), 'browser must use independent CSS2D angle and name label layers');
assert.ok(app.includes('await buildSlopeAnalysisFromManifest(manifest)') && app.includes('manifest?.slopeCurves'), 'browser must calculate slope analysis from raw Maya centerline geometry on project load');
assert.ok(app.includes('function analyzeSlopeCenterline(') && app.includes('SLOPE_ANALYSIS_INTERVAL_METERS = 20.0'), 'browser must calculate average grade every 20 m');
assert.ok(app.includes('Math.atan2(vertical,horizontal)') && app.includes('function classifySlopeAnalysisRoute('), 'browser analysis must mirror Maya section angles and route difficulty classification');
assert.ok(app.includes('indexedDB.open(\'grade-optimizer-slope-analysis\',1)') && app.includes('curve.sourceDigest'), 'browser must persist per-curve analysis cache by Maya source digest');
assert.ok(app.includes('slopeAnalysis:state.slopeAnalysisData||undefined') && app.includes('slopeCurves:state.slopeCurvesData||undefined'), 'raw curves and derived analysis must both survive client scene autosave');
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
assert.ok(app.includes(String.raw`if(/\.fbx$/i.test(sourcePath))restoreCadBridgeWorkingCoordinates(root,item.mayaExport,item.name||item.id);`),
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


assert.ok(maya.includes('def refresh_slope_curve_list(') && maya.includes('SLOPE_CURVE_TREE_MAP'), 'Maya exporter must list current slope curves from scene.json');
assert.ok(maya.includes('"queue": _normalize_slope_queue(') && maya.includes('(cached or {}).get("queue"), default_queue'), 'each slope curve must retain a Queue 1 / Queue 2 assignment');
assert.ok(maya.includes('def assign_selected_slope_curve_queue(') && maya.includes('def replace_selected_slope_curve('), 'Maya exporter must support queue assignment and targeted curve replacement');
assert.ok(maya.includes('def _selected_closed_nurbs_curve_transforms(') && maya.includes('def export_tree_marker_positions('), 'Toro closed NURBS circle markers must be exportable as tree positions');
assert.ok(maya.includes('manifest["treeMarkers"]') && maya.includes('position_meaning = "world-space circle center"') && maya.includes('"radiusMeters"'), 'Toro circle markers must retain world-space center coordinates and radii in metres');
assert.ok(maya.includes('def _selected_tree_spawn_locator_transforms(') && maya.includes('def _tree_marker_locator_position_meters(') && maya.includes('"markerType": "maya-point-locator"'), 'QGIS tree spawn locators must export one world-space point per Maya locator');
assert.ok(maya.includes('"sourceKey": source_key') && maya.includes('"qgis_geometry_role"'), 'QGIS tree point IDs and source provenance must remain stable across re-imports');
assert.ok(maya.includes('marker_geometry = "point-locator"') && maya.includes('"positionMeaning": position_meaning'), 'point-only marker exports must be identified as point locators without a fabricated radius');
assert.ok(maya.includes('WINDOW + "_tree_marker_frame"') && maya.includes('ЭКСПОРТИРОВАТЬ ПОЛНЫЙ НАБОР ТОЧЕК / КРУЖКОВ'), 'Maya UI must expose point and circle tree marker export');
assert.ok(maya.includes('collapsable=True, collapse=True'), 'Maya exporter categories must be collapsible');
console.log('✓ Maya exporter 0.9.3: queue-aware slope curve inventory, queue assignment and single-curve replacement');
console.log('✓ Toro survey: closed NURBS circles and QGIS point Locators export as project-world tree positions');
console.log('✓ Stage1: 22 selected meshes, valid FBX / manifest pair, inverse Bridge metadata');
console.log('✓ Canonical Terrain: existing working-world FBX retained unchanged');
console.log('✓ Browser: restores Stage1 FBX into the Terrain working-world frame and preserves metadata');
