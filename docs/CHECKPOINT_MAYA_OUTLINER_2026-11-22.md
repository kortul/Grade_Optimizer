# Grade Optimizer — Development Checkpoint
Date: 2026-11-22
Branch: `main`
Repository: https://github.com/kortul/Grade_Optimizer
Current application source commit: `24b2617072ec929e543e132843c3e0f641747a0c`
Latest verified web application source: `app.v97.js`
Latest verified Maya Exporter: `0.2.4`

## Product direction

The main pipeline remains **one full Maya scene → one FBX → one client project**. Preserve Maya hierarchy, nested groups / transforms / meshes, material slots, and shared material identity. Do not force the resort into separate mandatory Terrain / Slope / Building files.

The web Scene Editor is the main place to configure an individual object after import. Maya is the geometry / hierarchy source and an optional place to assign descriptive Role / Tags, not the place where final collision and forest-exclusion flags must be configured.

## Local repository and Maya workflow

User's actual Windows Git working copy:
`C:\zGit\GradeOptimizer\Grade_Optimizer`

Maya exporter source:
`C:\zGit\GradeOptimizer\Grade_Optimizer\maya\grade_optimizer_exporter.py`

Run from Maya Python Script Editor / Shelf; installing the native Maya plug-in is optional. The Shelf script must add the folder above to `sys.path`, import / reload `grade_optimizer_exporter`, and call `show()`.

Maya Exporter v0.2.4:
- Default repository path targets the actual nested Git working copy.
- Remembers repository path, Project ID, last-used metadata preset and optional custom Role / Tags through Maya optionVars.
- Exports selected objects only by default. Empty selection is blocked; uncheck intentionally to export the whole scene.
- Writes `clients/<project-id>/models/resort.fbx` and `clients/<project-id>/scene.json`.
- Ready-made metadata presets fill Role and Tags only.
- Collision and Forest blocker controls have been removed from Maya. These are configured per node in the Web Editor Inspector.
- Native Maya plug-in / test fixture files are in `maya/`; actual plug-in installation and a real Maya runtime / FBX round-trip on the user's workstation are still unverified.

Maya test-scene fixture:
- Nested hierarchy and repeated leaf names in different branches.
- Shared material assigned across separate mesh objects.
- Multiple material slots on one mesh.
- Hidden test object.
- Descriptive Role / Tags only; Collision / Forest blocker should be tested in Web Editor.
- Fixture requires confirmation before replacing the current Maya scene.

## Current web application

Active entry point: `index.html` → `app.v97.js`.

Implemented:
- GLB / FBX import, recursive Maya-style Outliner, nested node selection and viewport picking.
- Per-node transform editing, visibility, Role / Tags, Collision hint and Forest blocker hint. Deletion is supported for imported client models; destructive deletion of built-in base-scene components is disabled because the project manifest cannot rewrite the shipped source model. Hide such components through Visibility instead.
- Shared material library, assignment / uniqueness controls, PBR editing and user texture import.
- Imported client models can be exported to GLB on publish after changes, while the manifest records transforms, categories, phases, visibility and node metadata.
- Local browser IndexedDB is still used for local drafts when not working in a client workspace. This is not cross-device project storage.

## Shared project persistence — critical architecture

The desired source of truth is the GitHub project, not IndexedDB in one browser. The normal workflow is now:

1. Open a Client Workspace by Project ID / client URL.
2. Connect the GitHub Publisher with a fine-grained token that has Contents read/write access to `kortul/Grade_Optimizer`. The token is held in memory in the current tab; it is not committed or stored in browser storage.
3. Edit the scene.
4. Press **SAVE ALL PROJECT CHANGES TO GITHUB**.
5. The app commits directly to `clients/<slug>/scene.json` and changed model files. There is no need to download and manually copy a config JSON file.
6. Open the same client URL on another browser / device after GitHub Pages deploys; the workspace loads the committed project settings.

### What is now included in `clients/<slug>/scene.json`

- Imported client models: file path, category, phase, root transform, visibility, collision / forest flags.
- Imported model nested visibility overrides and per-node Role / Tags / Collision / Forest blocker.
- Built-in application scene objects as `editorSettings.assets`.
- For built-in scene objects: transforms, root visibility, nested visibility overrides (both hide and unhide), metadata and material settings.
- PBR values: base color, roughness, metalness, normal scale, AO intensity, emissive, opacity, tiling, transparency, sidedness and wireframe.
- User-imported texture image data for supported material maps, embedded as data URLs so another browser can reconstruct the texture.
- Stable IDs for material references, allowing the project loader to restore shared material slots vs unique slots rather than merely copying the same numeric values.

### Save / restore implementation

- `collectProjectEditorSettings()` serializes built-in `sourceType === 'scene'` objects.
- `collectEditorAssetConfig()` serializes node metadata / visibility, PBR state, user textures and shared material IDs.
- `collectClientManifest()` awaits project settings and includes them under `editorSettings`.
- `publishClientWorkspace()` commits `scene.json` and any dirty imported model GLBs to GitHub.
- `openClientWorkspace()` loads manifest model files and restores `manifest.editorSettings` into the built-in scene.
- A visibility baseline is captured for nodes so the manifest can store explicit `visible: true` overrides as well as hidden nodes. Without this, an unhide override could be lost on another browser.

The Scene Editor JSON download is now explicitly labeled as an **optional backup**. It is not the normal save method.

### Draft vs committed state

Changes in the current tab remain a project draft until the GitHub save action completes successfully. The dirty indicator is updated for transforms, root and nested visibility, node metadata, Collision / Forest flags, category / phase, material parameters, shared-material assignment / uniqueness, texture import / removal, active terrain changes, imported-model / component deletion, and JSON-config import. JSON-config import also marks imported model files dirty so PBR changes are included in the next GLB export. After a successful publish the status reports the GitHub commit and clears the dirty state. Leaving the page with a dirty client project triggers the browser's unsaved-changes warning. Reopening a different client project asks before discarding edits and reloads the base scene so built-in settings from one client cannot bleed into another.

Known follow-up / test items:
- Verify the round-trip in a real second browser / device: edit built-in scene node metadata and visibility, PBR values, shared material assignments and a custom texture; save to GitHub; open the same client URL in a clean browser and confirm every setting restores.
- Test the dirty-state behavior for every editor control, including shared material assignment, texture removal, active-terrain switching, imported nested-component deletion, whole-model deletion, and loading a JSON backup. These actions are now wired to the project dirty state; validate them in a real browser session.
- Review large custom textures: data URLs increase the size of `scene.json`; decide whether to impose a size guard or move large media to standalone Git LFS / object storage if needed.
- Cross-sharing a single material instance between an imported client asset and a built-in scene object is not yet guaranteed across the GLB + `editorSettings` boundary. Shared-vs-unique material identity is recorded for built-in scene assets.
- The app currently stores Collision / Forest blocker flags as project metadata. Runtime collision behavior and automatic forest exclusion are future implementation work.

## Current verified commits and CI

Latest application source commit:
`24b2617072ec929e543e132843c3e0f641747a0c`

Quality checks:
https://github.com/kortul/Grade_Optimizer/actions/runs/45036859148

GitHub Pages deployment:
https://github.com/kortul/Grade_Optimizer/actions/runs/45036859499

Both checks completed successfully for the v97 application source commit. Validation covers repository assertions, DOM references, JavaScript syntax and Pages build/deployment. It does not replace a real browser round-trip test.

## Suggested next session sequence

1. Sync GitHub Desktop (Pull) into `C:\zGit\GradeOptimizer\Grade_Optimizer`.
2. Confirm the deployed site loads `app.v97.js`.
3. Open the intended client Project ID and connect GitHub Publisher in the tab used for editing.
4. Run the cross-browser persistence test described above, starting with one built-in node's Collision / Forest blocker and visibility.
5. Fix any restore / identity / dirty-state problems found before implementing automatic collision physics or forest exclusion.
6. Continue real Maya FBX round-trip testing separately; do not claim Maya runtime validation until it has been run on the user's machine.

## Important honesty / environment notes

The user's Windows filesystem and a running Maya instance are not available to this development session. Repository files and GitHub CI can be updated and inspected, but local Maya plugin installation, real Maya FBX export and interactive browser testing on a second device must be performed on the user's side.
