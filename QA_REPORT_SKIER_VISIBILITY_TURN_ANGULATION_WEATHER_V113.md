# QA Report — Skier Visibility, Turn Angulation & Weather UI v113

## Files
- `skier-controller.v77.js`: depth-safe full-opacity character rendering and signed bilateral hip/knee turn angulation.
- `app.v113.js`: imports controller v77 and sets the default scene time to 16:00.
- `index.html`: shows 16:00 in the initial time controls and places the cloud weather button before the Scene Editor gear.
- `scripts/validate-project.mjs`: adds regression assertions for all requested changes.
- `README.md` / `README-DEPLOY.md`: active release references updated.

## Regression coverage
- Character materials switch from transparent/no-depth-write during a camera transition to opaque/depth-write when fully visible.
- All avatar meshes keep individual frustum culling disabled.
- Both left and right turn directions share the same signed knee angulation; leg side does not invert the shared lean.
- Runtime and HTML fallback time defaults are 16:00.
- Weather control is a cloud icon and appears immediately before the gear.
- Existing turn flexion, ski rig, first-/third-person camera, Scene Editor, optics, forest, slope, Maya and project-persistence checks remain active.

## Not verified by static checks
- Actual distance-dependent visual result in Chrome/WebGL.
- Visual silhouette and exact knee lean while steering at speed.
- Frame rate / GPU performance.
Static source validation is not a visual browser sign-off.
