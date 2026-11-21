# Checkpoint 0.64 — Scene picking and non-overlapping UI

**Base:** v0.63 (`app.v63.js` retained for rollback)
**Active app:** `app.v64.js`

## UI layout
- The 3D viewport fills the app; optimizer/editor are overlay panels rather than flex siblings that shrink the view.
- Toolbar stays in its own top band. Panels begin below it, preventing the time-of-day row from sitting over optimizer controls.
- At narrower widths the time control moves to a second toolbar row and panel top offsets increase accordingly.
- Legend is hidden while the optimizer or editor is open.

## Scene Editor
- Meshes from the currently loaded resort GLTF appear in the same list as separately imported GLB assets.
- Clicking a visible mesh in the 3D viewport while Scene Editor is open selects its material slots in the PBR inspector.
- Selected object gets a temporary green bounds outline.
- Original terrain/scene meshes cannot be removed; imported GLB objects can still be removed.
- Scene config now saves/restores source scene mesh metadata and material parameters as well as imported GLB objects.

## Validation
- JavaScript syntax smoke check passed.
- All `getElementById()` references exist; no duplicate HTML IDs.
- Browser visual/WebGL picking test still needs confirmation with the actual Maya scene.