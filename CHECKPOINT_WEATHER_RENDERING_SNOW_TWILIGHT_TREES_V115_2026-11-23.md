# Checkpoint — Weather Rendering, Snowfall & Twilight Trees v115

Date: 2026-11-23

## Release
- Base commit: 041ba9b04eb255534dde52c9e8becc3d77a82b16
- Active entrypoint: `index.html` → `app.v115.js`
- Active weather system: `weather-system.v2.js`
- Skier controller remains `skier-controller.v77.js`
- Rollback: `app.v114.js` + `weather-system.v1.js`

## Fixes
- Snow and wind streaks no longer live under the camera object (which is not in the scene graph). They now live under a scene-root camera-follow rig whose world position and quaternion are synchronized each frame.
- Snowfall count raised to 2200; the Snow preset is 62% intensity; snow material opacity, alpha threshold and flake size are increased for visible flakes.
- Weather panel no longer closes when switching to skier or drone mode and is no longer hidden by mode-specific CSS. It remains accessible from the persistent cloud button; its overlay is positioned below the toolbar.
- AI tree billboards use their own atlas texture as an emissive map with a daylight-linked intensity. This restores daytime readability without bringing back a constant bright forest at night.
- Procedural 3D foliage and fallback billboards use the same daylight-linked fill.

## Compatibility
- Existing weather preset names, weather storage key, cloud / wind controls, 16:00 default and skier controller v77 remain.
- Ski physics and the Scene Editor project schema are unchanged.
- App v114 and weather system v1 remain available for rollback.

## Verification boundary
- Static regressions cover camera-follow weather rendering, all preset buttons, mode access, snow visibility controls and dynamic forest daylight.
- A live Chrome/WebGL visual inspection is not claimed.
