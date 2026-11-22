# Grade Optimizer — Development Checkpoint
Date: 2026-11-22
Branch: `main`
Repository: https://github.com/kortul/Grade_Optimizer
Latest verified application commit before this update: `3c7d6995ecc48152ed90463a977c6fa819f544ca`
Latest checkpoint commit before this update: `ffa02f4c8cc724ed7c654970e50d116b6cd9706e`

## Product direction

The workflow is **one full Maya scene → one FBX → one client scene manifest**. The FBX hierarchy remains the primary scene structure: groups, transforms, mesh nodes and material slots stay individually selectable in the web editor.

Do not force users to split the resort into Terrain / Slope / Building files or impose mandatory classifications. The default role remains General model. Optional node metadata is available where it helps describe individual hierarchy nodes.

Local project folder requested by the user:
`C:\zGit\GradeOptimizer`

GitHub repository:
`kortul/Grade_Optimizer`

The local folder itself is not mounted in the development session. New plugin files are committed to GitHub and must be synced into that local clone using GitHub Desktop before installing them in Maya.

## Current web application — v95

Active entry point: `index.html` → `app.v95.js`.

Implemented:
- GLB and FBX import using Three.js loaders.
- Full recursive Maya-style Outliner for imported models and existing scene geometry.
- Expand / collapse, recursive search and selection of individual groups, transforms, meshes and material slots.
- Viewport picking selects the actual nested FBX mesh.
- Transform editing targets the selected hierarchy node, not only the root asset.
- Selected-node visibility control and component deletion with shared-resource-aware disposal.
- Selected-node GLB export.
- Per-node Role, Tags, Collision hint and Forest blocker hint controls.
- Per-node metadata participates in Outliner search and appears as the node tag.
- Per-node metadata is stored in client `scene.json`, restored when a client scene loads, and included in local browser records and Scene Config JSON.
- Metadata path lookup supports stable child-index paths in web-generated records and Maya hierarchy name paths in Maya-exported manifests.

Important: per-node Collision / Forest blocker flags are descriptive metadata only. They do not yet change collision simulation, terrain selection or forest generation automatically.

## Material library

Implemented in v94 and active in v95:
- Scene-wide PBR material library lists materials and the number of slots using each material instance.
- Assign an existing library material to the selected slot to intentionally share it.
- Make Slot Unique clones one material and its texture objects so the selected slot can be edited independently.
- Shared material edits, presets, texture imports and texture removals mark every imported model using that instance as dirty for publishing.
- Materials are not merged just because their names match; separate Maya materials with the same display name remain distinct.
- FBXLoader 0.160 creates material instances from FBX material IDs and reuses them for connected mesh assignments. Real Maya export still needs a round-trip check.

## Native Maya plug-in v0.2.1

Files in the repository:
- `maya/plug-ins/grade_optimizer.py` — native Maya Python plug-in entrypoint.
- `maya/GradeOptimizer.mod` — Maya module descriptor.
- `maya/install_maya_module.bat` / `maya/install_maya_module.ps1` — current-user Windows module installer.
- `maya/grade_optimizer_exporter.py` — exporter UI and FBX / manifest writer.
- `maya/grade_optimizer_test_scene.py` — new deterministic test-scene generator.
- `maya/README.md` and `docs/MAYA_EXPORT_WORKFLOW.md` — setup and usage.

Plug-in behavior:
- Registers Maya command `gradeOptimizerOpen`.
- Adds menu actions **Open Exporter…** and **Create FBX Test Scene…**.
- Uses Maya Python API 2.0 and standard `initializePlugin` / `uninitializePlugin` lifecycle.
- Exporter defaults to local repo `C:/zGit/GradeOptimizer`, client `alpine-resort`, and full-scene FBX export.
- Creates `clients/<client-slug>/models/resort.fbx` and `clients/<client-slug>/scene.json`.
- Attempts to enable FBX materials and Embed Media.

Test-scene fixture:
- Requires explicit confirmation before replacing the current Maya scene.
- Creates nested groups / transforms and several mesh objects.
- Assigns one shared Lambert material to Terrain and Station Roof.
- Assigns two materials to different faces of one Station_Building mesh.
- Includes a hidden survey marker.
- Includes two nodes named `Pylon` under different DAG branches, with different node metadata.
- Adds example Role, Tags, Collision and Forest blocker metadata.
- Sets the fixture's linear unit to metres.

After syncing the repo, use **Grade Optimizer → Create FBX Test Scene…**, then **Open Exporter…** and export with Client ID `maya-fbx-test`. Inspect the resulting FBX and manifest in the web app before using a real client scene.

## Maya installation

1. Sync the GitHub repository into `C:\zGit\GradeOptimizer` using GitHub Desktop.
2. Close Maya.
3. Run `C:\zGit\GradeOptimizer\maya\install_maya_module.bat` (standard user; no admin required).
4. Start Maya.
5. Open Windows → Settings/Preferences → Plug-in Manager.
6. Enable `grade_optimizer.py` under Loaded and Auto load.
7. Use the **Grade Optimizer** menu.

The installer has not yet been run on the user's Windows machine, and the plug-in has not yet been loaded inside Maya. Automated Python syntax checks are not a substitute for a real Maya runtime test.

## FBX limitations to verify

- FBX materials and embedded media depend on Maya FBX plug-in version and source shader types.
- Three.js FBXLoader 0.160 handles Lambert / Phong-style FBX material conversion; do not assume complex Arnold or other custom shader networks will round-trip faithfully.
- Confirm unit conversion, axis orientation, embedded texture extraction, hierarchy names and multi-material slots on a real export.
- A single FBX should remain below 90 MiB for the current normal Git workflow; larger binary assets need another storage approach.

## Client editing and publishing

The client publishing path converts edited imported FBX models to GLB for publication when a model becomes dirty. The manifest keeps the model file path and nested visibility / metadata. Still needs an end-to-end test with a client URL:
- nested transform changes;
- node visibility and node metadata;
- shared material edit used by multiple meshes / models;
- imported / removed texture maps;
- publish, reload and verify the client sees the edited result.

Do not claim local browser IndexedDB edits automatically sync across browsers or devices. The Maya → local Git → GitHub Desktop Push path is intended for asset authoring without a browser GitHub token.

## Validation status before this feature commit

- Parent commit Quality checks: **success**
  https://github.com/kortul/Grade_Optimizer/actions/runs/45022835569
- Parent commit GitHub Pages deployment: **success**
  https://github.com/kortul/Grade_Optimizer/actions/runs/45022715309

This update adds source-level Maya fixture tests and Python syntax validation. GitHub Actions will validate the new code after commit. A real Maya runtime / FBX round-trip is still pending.

## Next work

1. Sync and install module in Maya.
2. Generate `maya-fbx-test`, export it and inspect the FBX hierarchy / materials / metadata in the web app.
3. Fix any Maya FBX export or Three.js FBXLoader mismatches exposed by the fixture.
4. Verify client publishing and reload of edited models.
5. Decide which optional metadata should drive actual collision / forest behavior, without making categories mandatory.

## Key files

- `index.html` — web app entry point
- `app.v95.js` — current application
- `maya/plug-ins/grade_optimizer.py` — Maya plug-in entrypoint
- `maya/GradeOptimizer.mod` — Maya module descriptor
- `maya/install_maya_module.bat` — Windows installer
- `maya/grade_optimizer_exporter.py` — Maya exporter UI / logic
- `maya/grade_optimizer_test_scene.py` — FBX test-scene generator
- `maya/README.md` — Maya plug-in setup
- `docs/MAYA_EXPORT_WORKFLOW.md` — Maya to GitHub Desktop workflow
- `scripts/validate-project.mjs` — automated project validation
