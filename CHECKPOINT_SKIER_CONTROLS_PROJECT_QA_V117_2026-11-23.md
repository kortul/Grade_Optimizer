# Checkpoint — Skier Controls & Project QA v117

Date: 2026-11-23

## Release
- Active entrypoint: `index.html` → `app.v117.js`
- Active skier controller: `skier-controller.v78.js`
- Rollback: `app.v116.js` + `skier-controller.v77.js`

## Skier controller
- Pole strokes use the actual ski heading, independent of camera look yaw.
- Pole stroke impulse / repeat interval are tuned to avoid the previous overly strong repeated acceleration.
- Keyboard state clears on pointer-lock loss to prevent stuck movement after ESC.
- HUD grounded state respects the automatic bump-jump arc.
- Terrain spawn search supports a single Mesh or a Group containing multiple Mesh objects and caps vertex sampling on very dense geometry.
- Custom ski GLB replacement validates the new model and prepares both mounts before removing the old pair. Failed uploads preserve the installed skis.

## Scene Editor
- Seven independent categories: General, Environment, Camera, Lens & Optics, Color, Materials, Render.
- Lens and optical-processing controls remain combined in one panel.
- The quality validator now checks the current seven-tab structure.

## Verification boundary
- JavaScript syntax, HTML IDs, imports and static regression checks run in GitHub Actions.
- Browser / WebGL appearance, actual ski handling and frame-rate changes are not visually verified in this commit.
