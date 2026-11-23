# Checkpoint — Saved Overview Camera Preset v137

**Date:** 2026-11-23  
**Repository:** `kortul/Grade_Optimizer`  
**Branch:** `main`  
**Baseline:** `app.v136.js`

## Scene Editor

- Added a camera icon to the Inspector header beside Close.
- The icon captures the current overview camera position and OrbitControls focus target.
- Camera presets are stored per slope in the client project's `scene.json` manifest under `overviewCameras`.
- Existing project browser autosave and connected local-project-folder sync carry the saved camera data with the project.
- The existing Home button now returns to the saved overview camera when one exists; otherwise it keeps the automatic scene framing.
- Different slopes retain independent overview presets.
- Saving is disabled until the scene/project is ready and while the app is in skier or drone mode.

## Compatibility

- Existing manifests without `overviewCameras` remain valid and continue to use automatic framing.
- Skier/drone camera transitions and the overview snapshot path are not changed.
- Previous app versions remain available for rollback.

## Verification boundary

- `scripts/validate-project.mjs` now checks the icon, capture helpers, project-manifest persistence, restore path and Home behavior.
- GitHub Actions must pass on this commit.
- Live browser/WebGL verification is still required for the icon appearance and actual saved-camera framing.
