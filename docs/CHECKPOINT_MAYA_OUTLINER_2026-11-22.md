# Grade Optimizer — Development Checkpoint
Date: 2026-11-22
Branch: `main`
Repository: https://github.com/kortul/Grade_Optimizer

## Current direction

The Maya exporter writes a complete client scene as **one FBX file**, rather than forcing separate Terrain / Slope / Building files. The FBX hierarchy is the source of truth: groups, transforms, mesh nodes and material slots remain nested and individually addressable in the web editor.

Default import role is `model` / General model. Terrain remains an optional special role for a whole imported asset when it must become the active ground surface.

## Implemented

### Maya → Git workflow
- Maya exporter: `maya/grade_optimizer_exporter.py`
- Setup and usage: `maya/README.md`
- Writes `clients/<client-slug>/models/resort.fbx` and `clients/<client-slug>/scene.json`.
- Exports the whole scene by default; optional selected-only mode.
- Attempts to enable FBX materials and embed media.
- Flow: Maya export → inspect changed files in GitHub Desktop → Commit → Push.
- No GitHub token is needed by this local exporter workflow.

### Web FBX support
- Active app: `app.v95.js`, loaded from `index.html`.
- Uses Three.js `FBXLoader`.
- Existing GLB scenes remain supported.
- FBX scene manifest entries are accepted by the client scene loader.

### Maya-style Outliner
- Expandable hierarchy for imported models and existing scene content.
- Transform / Object3D nodes and mesh nodes can be selected independently.
- Material slots appear under their mesh nodes.
- Recursive search matches node names, object types, asset names and material names.
- Expand All / Collapse All controls.
- Viewport picking selects the actual hit mesh inside an imported FBX, not just the FBX root.
- Inspector transform controls target the selected hierarchy node.
- Visibility can be toggled on a selected child node.
- Components can be removed independently; deletion avoids disposing geometry/material resources still referenced elsewhere.
- Selected-node GLB export is available.

### Persistence added
- Edited imported scene content is serialized before local browser save.
- Client manifest stores non-visible descendant nodes and restores them when loading a client scene.
- Local browser records also store descendant visibility state and serialized edits.
- Shared-material presets, texture imports and texture removals mark all imported models using the same material as dirty.

## Latest validation / deployment

- Latest app and validation commit: `97984b7c7f06329fc1e8fefdbd2ac9fb1152ce44`
- GitHub Actions quality checks: **success**
  https://github.com/kortul/Grade_Optimizer/actions/runs/45021161097
- GitHub Pages build and deployment: **success**
  https://github.com/kortul/Grade_Optimizer/actions/runs/45021160484

Automated checks verify active entrypoint, DOM IDs, JavaScript syntax, FBX loader integration, Outliner controls, nested selection, selected-node transforms, nested visibility serialization, scene-wide material assignment, per-slot uniqueness and shared-owner dirty propagation. These checks are not a substitute for loading a representative Maya-exported FBX in a real browser.

### Maya native plug-in and node metadata

- Maya plug-in: `maya/plug-ins/grade_optimizer.py`, registered command `gradeOptimizerOpen`, menu `Grade Optimizer`.
- Module descriptor: `maya/GradeOptimizer.mod`.
- Windows installer: `maya/install_maya_module.bat` and `install_maya_module.ps1`; adds the repository's `maya` directory to the user's `MAYA_MODULE_PATH`.
- Exporter UI: `maya/grade_optimizer_exporter.py`, default local repository `C:/zGit/GradeOptimizer`.
- Maya nodes can receive optional Role, Tags, Collision hint and Forest blocker hint metadata. The exporter writes this as `nodeMetadata` in the client `scene.json`.
- Web Outliner v95 restores metadata by Maya `namePath` or hierarchy index path, supports custom free-form roles, and persists metadata through client manifests, local browser records and Scene Config JSON.
- Metadata is descriptive only at this stage; Collision hint / Forest blocker hint do not yet enable runtime collision or forest-placement behavior.

## Important limitations / next work

1. **Test a real Maya FBX.** No representative binary FBX has yet been round-tripped through Maya → exporter → GitHub Pages. Verify nested groups, names, material assignments, embedded textures, scale/axis orientation and large-scene performance.
2. **Shared material editing — implemented.** The library is keyed by actual Three.js material instance identity, not by display name. Editing a shared instance changes all its uses. Every imported model using that instance is marked dirty for publishing.
3. **Scene-wide material library — implemented.** A scene-level list exposes existing materials and slot usage. Assign an existing material to the selected slot to create an intentional link, or use **Make slot unique** to clone that material and its texture objects for independent editing. Different materials with coincidentally equal names are not merged.
4. **Per-node metadata.** Optional per-node metadata is implemented. Next, decide which metadata roles should drive actual scene behavior (without forcing classifications).
5. **Client editing and publishing.** Test nested transform/material/visibility edits inside a client URL and verify the publishing flow end-to-end.
6. **Maya FBX options and shader fidelity.** Verify embedded textures in the target Maya/FBX versions. Three.js FBXLoader 0.160 parses Lambert and Phong material models; complex Maya/Arnold shader networks should not be assumed to round-trip faithfully. See [FBXLoader material parsing](https://github.com/mrdoob/three.js/blob/r160/examples/jsm/loaders/FBXLoader.js#L459-L522).

## Suggested next session sequence

1. Import a real Maya test FBX with 2–3 nested groups, multiple meshes, one shared material, one two-slot mesh and one hidden child.
2. Verify hierarchy, search, transform edits, node visibility, deletion and reload in a browser.
3. Check embedded maps, unit scale, axis orientation, material model conversion and large-scene performance.
4. Add optional per-node tags / metadata while keeping General model as the default.
5. Test client editing, publication and texture persistence end-to-end.

## Key files

- `index.html` — active entry point and UI
- `app.v95.js` — current app implementation
- `maya/plug-ins/grade_optimizer.py` — native Maya plug-in entrypoint
- `maya/GradeOptimizer.mod` — Maya module descriptor
- `maya/grade_optimizer_exporter.py` — Maya exporter
- `maya/README.md` — exporter usage
- `scripts/validate-project.mjs` — automated project checks
- `docs/MAYA_EXPORT_WORKFLOW.md` — Maya → GitHub Desktop workflow


## Material library details

- The inspector now contains a scene-wide material selector.
- **Assign to selected slot** replaces the selected mesh material slot with the chosen material instance. Reusing the same instance intentionally links the slots.
- **Make slot unique** clones the material and its texture objects, allowing this slot to be edited independently.
- The PBR inspector indicates whether the selected material instance is shared and how many slots use it.
- PBR edits, presets, texture imports and texture removals mark every imported asset that uses the material as dirty, so publishing can rebuild every affected model.
- The library does not merge materials solely because their names match; this avoids accidentally combining distinct Maya materials.
- FBXLoader 0.160 parses FBX material nodes into a material map keyed by FBX ID, then reuses those mapped instances on connected mesh objects. This preserves intended sharing in the source FBX where the same material ID is connected to multiple meshes: [material map construction](https://github.com/mrdoob/three.js/blob/r160/examples/jsm/loaders/FBXLoader.js#L459-L477), [mesh assignment](https://github.com/mrdoob/three.js/blob/r160/examples/jsm/loaders/FBXLoader.js#L1197-L1226).
- Active app module: `app.v94.js`.

## Outstanding real-world verification

- A sample FBX exported from Maya is still required to confirm FBXLoader's material identity mapping and embedded texture handling for the target Maya version.
- Browser-level QA is still needed for assignment, uniqueness, shared edit propagation, local persistence and client publishing.
