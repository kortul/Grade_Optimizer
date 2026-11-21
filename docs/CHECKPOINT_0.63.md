# Checkpoint 0.63 — Interface polish and cleanup

**Base:** v0.62 (`app.v62.js` remains available for rollback)
**Active app:** `app.v63.js`

## Interface
- Refined dark UI palette, toolbar surfaces, spacing, panel borders and material cards.
- Added object and material-slot counters.
- Sticky editor header, clearer status/error area and keyboard focus styles.
- Improved tablet/mobile toolbar wrapping and editor sizing.
- Added drag-and-drop import of GLB files directly into the Scene Editor panel.

## Bug fixes
- Added shared resource disposal for geometry, materials and their textures when rebuilding generated groups and clearing measurements.
- Dispose imported mesh resources when an imported GLB is removed, reducing GPU memory retained after repeated import/remove cycles.
- Editor drag state is cleared on drop/leave; only GLB files are routed through the model importer.

## Validation
- JavaScript module body passes a syntax smoke check after stripping static import declarations.
- All `getElementById()` targets used by the application exist in index.html.
- No duplicate HTML IDs.
- Browser-side WebGL visual testing and export round-trip testing with the user's Maya assets remain necessary.

## Rollback
- Change index.html module reference from `app.v63.js` back to `app.v62.js`.