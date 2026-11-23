# QA Report — Weather Rendering, Snowfall & Twilight Trees v115

## Files
- `weather-system.v2.js`: camera-follow scene root, stronger snow particles and increased Snow preset.
- `app.v115.js`: activates weather system v2 and daylight-linked tree fill.
- `index.html`: keeps the weather overlay available in skier / drone modes.
- `scripts/validate-project.mjs`: adds regression coverage for all requested fixes.
- `README.md` / `README-DEPLOY.md`: current release documentation.

## Regression coverage
- Weather camera-follow rig is added to the scene and updates from the live camera world position / quaternion.
- Snow and wind streaks are children of the camera-follow rig, not an unrendered camera child.
- Snow preset set includes all seven existing presets and the matching UI buttons.
- Snow count, flake size and opacity are increased.
- Presets remain wired to the runtime handler.
- Weather panel is not closed or hidden when skier / drone mode is active.
- Atlas trees use texture-matched emissive fill driven by daylight; fallback 3D trees and billboards share the same daylight-driven intensity.
- Existing tree atlas, skier, drone, Scene Editor, optics and project-persistence regressions remain active.

## Not verified by static checks
- Actual Chrome / WebGL appearance of snowfall density and tree brightness.
- Visual balance for each weather preset at all times of day.
- Actual GPU / FPS impact of the higher snow particle count.
Static validation is not a visual browser sign-off.
