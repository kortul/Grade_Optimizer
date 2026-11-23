# QA Report — Skier Input, Terrain Spawn & Inspector v117

Date: 2026-11-23

## Release
- Active entrypoint: `index.html` → `app.v117.js`
- Active skier controller: `skier-controller.v78.js`
- Rollback: `app.v116.js` + `skier-controller.v77.js`

## Fixes
- Pole strokes now follow the skier's ski heading instead of the independent camera look direction.
- Push impulse / cadence tuned to a more controlled repeated stroke.
- Movement keys are cleared when pointer lock is lost, avoiding a stuck turn / tuck / brake after ESC.
- The HUD reports airborne state during automatic bump jumps, including when snow-friction controls refresh status.
- Spawn search traverses grouped Terrain meshes and samples large vertex buffers with a bounded workload.
- Custom ski replacement is transactional: the existing pair stays installed until the incoming GLB has passed geometry validation and both mounts are prepared.
- Lens and Optics remain one Inspector tab, with all lens and optical controls inside it.

## Regression checks
- CI validates all seven Scene Editor tabs and rejects a separate Optics tab.
- CI checks every control is present inside the merged Lens & Optics panel.
- CI checks key-release safety, ski-heading push direction, airborne HUD state, grouped Terrain spawn support, bounded spawn sampling and transactional model replacement.
- Active app and imported modules are checked with Node.js syntax validation.

## Verification boundary
- Static source checks and GitHub Actions quality checks are used.
- Actual browser / WebGL driving feel, collision behaviour and FPS still require a live visual pass.
