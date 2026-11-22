# Grade Optimizer — Development Checkpoint
Date: 2026-11-22
Branch: `main`
Repository: https://github.com/kortul/Grade_Optimizer
Latest verified application commit: `3c7d6995ecc48152ed90463a977c6fa819f544ca`

## Product direction

The workflow is **one full Maya scene → one FBX → one client scene manifest**. The FBX hierarchy remains the primary scene structure: groups, transforms, mesh nodes and material slots stay individually selectable in the web editor.

Do not force users to split the resort into Terrain / Slope / Building files or impose mandatory classifications. The default role remains General model. Optional node metadata is available where it helps describe individual hierarchy nodes.

Local project folder requested by the user:
`C:\zGit\GradeOptimizer`

GitHub repository:
`kortul/Grade_Optimizer`

The local folder itself is not mounted in the development session. New plugin files are committed to the GitHub repository and must be synced into that local clone using GitHub Desktop before installing them in Maya.

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
- Custom free-form Role values with preset suggestions.
- Per-node metadata participates in Outliner search and appears as the node tag.
- Per-node metadata is stored in client `scene.json`, restored when a client scene loads, and included in local browser records and Scene Config JSON.
- Metadata path lookup supports stable child-index paths in web-generated records and Maya hierarchy name paths in Maya-exported manifests.

Important: per-node Collision / Forest blocker flags are descriptive metadata only. They do not yet change collision simulation, terrain selection or forest generation automatically.

## Material library

Implemented in v94 and remains active in v95:
- Scene-wide PBR material library lists materials and the number of slots using each material instance.
- Assign an existing library material to the selected slot to intentionally share it.
- Make Slot Unique clones one material and its texture objects so the selected slot can be edited independently.
- Shared material edits, presets, texture imports and texture removals mark every imported model using that instance as dirty for publishing.
- Materials are not merged just because their names match; separate Maya materials with the same display name must remain distinct.
- FBXLoader 0.160 creates material instances from FBX material IDs and reuses them for connected mesh assignments. Real Maya export still needs a round-trip check.

## Native Maya plug-in v0.2.0

Files committed:
- `maya/plug-ins/grade_optimizer.py` — native Maya Python plug-in entrypoint.
- `maya/GradeOptimizer.mod` — Maya module descriptor.
- `maya/install_maya_module.bat` — double-click installer.
- `maya/install_maya_module.ps1` — registers the module folder in the current Windows user's `MAYA_MODULE_PATH`.
- `maya/grade_optimizer_exporter.py` — export UI and FBX/manifest writer.
- `maya/README.md` — installation and usage instructions.

Plug-in behavior:
- Registers Maya command `gradeOptimizerOpen`.
- Adds Maya menu `Grade Optimizer → Open Exporter…`.
- Uses the Maya Python API 2.0 plug-in marker and standard `initializePlugin` / `uninitializePlugin` lifecycle.
- Exporter UI defaults to the user's local repository path `C:/zGit/GradeOptimizer`, which can be changed through Browse.
- Export whole scene by default; optional selected-only export.
- Attempts to enable FBX materials and Embed Media.
- Creates:
  `clients/<client-slug>/models/resort.fbx`
  `clients/<client-slug>/scene.json`
- Client manifest schema remains `1.0`; `nodeMetadata` is an additive field.

Maya node metadata:
- Select Maya Transform / Group / Mesh nodes.
- Set a free-form Role, Tags, Collision hint and/or Forest blocker hint.
- Apply metadata to selection.
- Exporter writes node paths and metadata into the client manifest.
- The web app restores the metadata on matching hierarchy nodes.

Installation steps after syncing the repository locally:
1. Close Maya.
2. Open `C:\zGit\GradeOptimizer\maya`.
3. Run `install_maya_module.bat` (ordinary user; admin not required).
4. Start Maya.
5. Open Windows → Settings/Preferences → Plug-in Manager.
6. Enable `grade_optimizer.py` under Loaded and Auto load.
7. Use the **Grade Optimizer** menu.

The installer has not yet been run on the user's Windows machine and the plug-in has not yet been loaded inside Maya. Automated Python syntax checks are not a substitute for a real Maya runtime test.

## Maya / FBX limitations to verify

- FBX materials and embedded media depend on Maya FBX plug-in version and source shader types.
- Three.js FBXLoader 0.160 handles Lambert / Phong-style FBX material conversion; do not assume complex Arnold or other custom shader networks will round-trip faithfully.
- Confirm unit conversion, axis orientation, embedded texture extraction, hierarchy names and multi-material mesh slots on a real sample export.
- A single FBX should remain below 90 MiB for the current normal Git workflow; larger binary assets require a different storage approach.

## Client editing and publishing

The client publishing path converts edited imported FBX models to GLB for publication when a model becomes dirty. The manifest keeps the model file path and nested visibility / metadata. Still needs an end-to-end test with a client URL:
- nested transform changes;
- node visibility and node metadata;
- shared material edit used by multiple meshes / models;
- imported / removed texture maps;
- publish, reload and verify the client sees the edited result.

Do not claim local browser IndexedDB edits automatically sync across browsers or devices. The Maya → local Git → GitHub Desktop Push path is intended for asset authoring without a browser GitHub token.

## Latest validation / deployment

Latest verified app commit: `3c7d6995ecc48152ed90463a977c6fa819f544ca`

- Quality checks: **success**
  https://github.com/kortul/Grade_Optimizer/actions/runs/45022715683
- GitHub Pages build and deployment: **success**
  https://github.com/kortul/Grade_Optimizer/actions/runs/45022715309

Quality checks include JavaScript validation, active module / DOM checks, metadata persistence checks, Maya plug-in source checks, Maya module / installer presence, and Python syntax parsing for the exporter and plug-in files.

## Next work — recommended order

1. Get a small real Maya FBX test file through the new plug-in and import it into the deployed web app.
2. Verify 2–3 nested groups, multiple meshes, a shared material, a mesh with 2 material slots, hidden child nodes, FBX embedded textures, scale and axis.
3. Verify metadata round-trip for nodes with unique and repeated names.
4. Verify material assign / make-unique / shared edits / texture edits in a real browser.
5. Verify the client publish → reload cycle preserves nested transforms, visibility, metadata and materials.
6. Decide which optional Role / Collision / Forest blocker values should drive actual simulation behavior. Keep defaults generic and do not force categories.

## Key files

- `index.html` — web app entry point
- `app.v95.js` — current application
- `maya/plug-ins/grade_optimizer.py` — Maya plug-in
- `maya/GradeOptimizer.mod` — Maya module descriptor
- `maya/install_maya_module.bat` — Windows installer
- `maya/grade_optimizer_exporter.py` — Maya exporter UI / logic
- `maya/README.md` — Maya plug-in setup
- `docs/MAYA_EXPORT_WORKFLOW.md` — Maya to GitHub Desktop workflow
- `scripts/validate-project.mjs` — automated project validation
