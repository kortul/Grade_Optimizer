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

Latest checked commit:
`2bdbe0c85fcfee7e19af3c291ab7139d44ebce0c`

- GitHub Actions quality checks: **success**
  https://github.com/kortul/Grade_Optimizer/actions/runs/45019677959
- GitHub Pages build and deployment: **success**
  https://github.com/kortul/Grade_Optimizer/actions/runs/45019677774

Automated checks verify active entrypoint, DOM IDs, JavaScript syntax, FBX loader integration, Outliner controls, nested selection, selected-node transforms, and nested visibility serialization. These checks are not a substitute for loading a representative Maya-exported FBX in a real browser.

## Important limitations / next work

1. **Test a real Maya FBX.** No representative binary FBX has yet been round-tripped through Maya → exporter → GitHub Pages. Verify nested groups, names, material assignments, embedded textures, scale/axis orientation and large-scene performance.
2. **Shared material editing.** The Outliner currently labels repeated references to the same Three.js material instance as `SHARED ×N`. The inspector edit is not yet guaranteed to propagate to every mesh that uses a similarly named material if the FBX loader produced separate material instances. Add a proper shared-material registry keyed by imported material identity / stable material key, with explicit apply-to-all behavior.
3. **Material library.** Add a reusable scene-level material list so the user can pick one existing material and assign it to one or multiple selected mesh slots. Preserve the same material instance where sharing is intended.
4. **Per-node metadata.** Terrain / active-ground / collision / forest-blocker roles are currently asset-root oriented. Add optional metadata to individual hierarchy nodes without imposing mandatory categories.
5. **Client editing and publishing.** Test nested transform/material/visibility edits inside a client URL, then verify exactly how those changes are written back through the current client publishing flow or the local Git exporter workflow.
6. **Maya FBX options.** Verify that the embedded-texture option actually embeds all file textures in supported Maya/FBX versions; report unsupported shader networks rather than silently implying full fidelity.

## Suggested next session sequence

1. Import a small test FBX with: 2–3 nested groups, multiple mesh objects, one shared material used on at least two meshes, one mesh with 2 material slots, and one hidden child.
2. Verify Outliner hierarchy, search, expand/collapse, node selection, transform edits, per-node visibility, deletion and reload.
3. Fix shared-material identity / propagation and implement the reusable material library.
4. Add optional per-node semantic roles, keeping General model as the default.
5. Re-run Actions and verify the deployed client link.

## Key files

- `index.html` — active entry point and UI
- `app.v93.js` — current app implementation
- `maya/grade_optimizer_exporter.py` — Maya exporter
- `maya/README.md` — exporter usage
- `scripts/validate-project.mjs` — automated project checks
- `docs/MAYA_EXPORT_WORKFLOW.md` — Maya → GitHub Desktop workflow
