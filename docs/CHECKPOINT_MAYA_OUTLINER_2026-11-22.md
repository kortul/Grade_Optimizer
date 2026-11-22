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
- Active app: `app.v93.js`, loaded from `index.html`.
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
- Local browser records also store descendant visibility state.

## Latest validation / deployment

- Shared material library implementation commit: `5057a8381dfee1ae1ec2ea401105c80de0029a93`
- GitHub Actions quality checks: **success**
  https://github.com/kortul/Grade_Optimizer/actions/runs/45021038658
- GitHub Pages build and deployment: **success**
  https://github.com/kortul/Grade_Optimizer/actions/runs/45021038648

Automated checks verify active entrypoint, DOM IDs, JavaScript syntax, FBX loader integration, Outliner controls, nested selection, selected-node transforms, nested visibility serialization, scene-wide material assignment, per-slot uniqueness and shared-owner dirty propagation. These checks are not a substitute for loading a representative Maya-exported FBX in a real browser.

## Important limitations / next work

1. **Test a real Maya FBX.** No representative binary FBX has yet been round-tripped through Maya → exporter → GitHub Pages. Verify nested groups, names, material assignments, embedded textures, scale/axis orientation and large-scene performance.
2. **Shared material editing — implemented.** The library is keyed by actual Three.js material instance identity, not by display name. Editing a shared instance changes all its uses. Every imported model using that instance is marked dirty for publishing.
3. **Scene-wide material library — implemented.** A scene-level list exposes existing materials and slot usage. Assign an existing material to the selected slot to create an intentional link, or use **Make slot unique** to clone that material and its texture objects for independent editing. Different materials with coincidentally equal names are not merged.
4. **Per-node metadata.** Terrain / active-ground / collision / forest-blocker roles are currently asset-root oriented. Add optional metadata to individual hierarchy nodes without imposing mandatory categories.
5. **Client editing and publishing.** Test nested transform/material/visibility edits inside a client URL, then verify exactly how those changes are written back through the current client publishing flow or the local Git exporter workflow.
6. **Maya FBX options.** Verify that the embedded-texture option actually embeds all file textures in supported Maya/FBX versions; report unsupported shader networks rather than silently implying full fidelity.

## Suggested next session sequence

1. Import a small test FBX with: 2–3 nested groups, multiple mesh objects, one shared material used on at least two meshes, one mesh with 2 material slots, and one hidden child.
2. Verify Outliner hierarchy, search, expand/collapse, node selection, transform edits, per-node visibility, deletion and reload.
3. Import and test a real Maya FBX, including shared material instances, multi-slot meshes, hierarchy, embedded textures, scale/axis and performance.
4. Add optional per-node semantic roles, keeping General model as the default.
5. Test client editing/publishing and texture persistence end-to-end.

## Key files

- `index.html` — active entry point and UI
- `app.v93.js` — current app implementation
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
- Active app module: `app.v94.js`.

## Outstanding real-world verification

- A sample FBX exported from Maya is still required to confirm FBXLoader's material identity mapping and embedded texture handling for the target Maya version.
- Browser-level QA is still needed for assignment, uniqueness, shared edit propagation, local persistence and client publishing.
