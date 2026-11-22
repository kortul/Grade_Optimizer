# QA — Grade Optimizer: Weather, Snow & Camera Optics

**Date:** 2026-11-22  
**Repository:** `kortul/Grade_Optimizer`  
**Branch:** `main`  
**Code state:** `cf360b79ee2faa94534cea5520a96a7447e978cb`

## Implemented

### Weather and snowfall
- Clear weather is the default; snowfall starts at **0%**.
- Snow is now a camera-space layer, so flakes are seeded inside the visible camera frustum and remain in front of the camera in overview, skier and drone views.
- Replaced textured `PointsMaterial` particles with textured `InstancedMesh` quads. This avoids relying on per-point UV attributes and keeps all flakes in a single instanced draw call.
- Snow instances are updated only while snowfall is active. Their count follows the selected snowfall intensity.
- Wind streaks appear only when snowfall and wind are high enough.
- Invisible cloud sprites no longer have their world position recalculated every frame.
- Weather presets still include clear, partly cloudy, cloudy, overcast, snowfall and blizzard.

### Camera optics
- Added `camera-optics.v1.js` and integrated it into the main render loop.
- Post stack: `EffectComposer`, `RenderPass`, optional `BokehPass`, `UnrealBloomPass`, custom lens pass and `OutputPass`.
- Subtle bloom / halation, vignette, very restrained chromatic aberration, screen-space optical ghosts / anamorphic streak, and procedural highlight-only lens dirt.
- Optical flare is driven by the sun's projected screen position and appears only while the sun sprite is visible and in frame.
- Bokeh / depth of field is optional and disabled by default.
- The optics panel allows the user to disable all post-processing and return to direct `renderer.render()`.
- Post-processing render targets are capped at a 1.25 device-pixel ratio to limit GPU cost.
- Optics preferences are stored separately in browser `localStorage` under `grade_optimizer_optics_v1`.

## Static validation

| Check | Result |
|---|---|
| Parse `app.v105.js` after removing module imports | PASS |
| Parse `weather-system.v1.js` after removing module export | PASS |
| Parse `camera-optics.v1.js` after removing module imports / export | PASS |
| Parse `skier-controller.v73.js` after removing module import / export | PASS |
| Optics UI IDs exist in HTML | PASS |
| No duplicate HTML IDs | PASS |
| Main app imports CameraOptics | PASS |
| Main render loop calls CameraOptics | PASS |
| Clear preset snowfall is zero | PASS |
| Snow renderer uses one InstancedMesh, not PointsMaterial | PASS |
| Active snowfall controls instance count | PASS |
| Snow update loop is skipped when snowfall is zero | PASS |
| Bokeh starts disabled | PASS |
| Optics panel and settings listeners are connected | PASS |

## Not verified in a live browser

The repository tooling used for this update did not provide an actual browser/WebGL session. Therefore these items remain unverified:
- Exact on-screen snow appearance and density in all three camera modes.
- Actual bloom / flare / lens-dirt appearance on the user's terrain and monitor.
- Bokeh focus quality on the real scene scale.
- FPS before and after the optics stack on the user's GPU.
- Browser console and WebGL runtime errors.

Static syntax and integration checks passed, but they are not a substitute for live visual/performance QA. Do not claim a measured FPS improvement until it is measured in the browser.
