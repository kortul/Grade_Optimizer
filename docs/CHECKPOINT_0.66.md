# Checkpoint 0.66 — eye-height camera and Sketchfab-style editor

**Base:** v0.65. Previous app/controller retained for rollback.
**Active app:** `app.v66.js`
**Active skier controller:** `skier-controller.v66.js`

## Skier camera
- Eye point is 1.80 m vertically above the snow contact point in GLTF world coordinates.
- Previous implementation offset along the terrain normal, reducing vertical camera height on steep pistes.
- Ski pair is now anchored near snow level ahead of the boot/contact point, not parented to the camera view position.

## Scene Editor
- Two-panel Sketchfab-inspired workspace: Scene Hierarchy left, Inspector right, viewport centre.
- Hierarchy groups native resort meshes and imported GLBs, with filtering, object count, source tags and active-row highlighting.
- Selecting a row or clicking a model in the viewport fills the Inspector and PBR material slots.
- GLB import and drag/drop are in the hierarchy column; drop is also supported over the inspector.

## Toolbar
- Time-of-day control is always in its own second toolbar row.
- Optimizer/editor panels start below the reserved toolbar area; mobile layout uses a higher panel offset.

## Validation
- JavaScript syntax smoke checks passed after stripping module imports/exports.
- All app DOM references exist; no duplicate HTML IDs.
- Browser-side WebGL visual test on the actual Maya model remains necessary.