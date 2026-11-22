# CHECKPOINT — Grade Optimizer: Sky, Lighting & Weather

**Date:** 2026-11-22  
**Repository:** `kortul/Grade_Optimizer`  
**Working branch:** `feature/sky-weather-v105`  
**Base branch:** `main`  
**Current working commit:** `a85ed65a823ac3740edc5207abed879f00a67530`  
**Scope:** remove the black procedural sky failure and introduce a first complete procedural weather layer without disturbing the existing editor or project saving.

## 1. Source baseline

- The current site before this work loaded `app.v104.js` from `index.html`.
- Baseline app SHA: `ff8938ab8388d2498e4eb4b145455cb15d6dc178`.
- Work is isolated on `feature/sky-weather-v105`; `main` has not been modified.
- `index.html` on the feature branch now loads `app.v105.js`.

## 2. Black sphere finding and fix

The v104 source created a 12,000-unit sphere named `skyDome` with a custom `THREE.ShaderMaterial`, used as the procedural sky. It was moved with the camera every frame. This is the source-level match for the huge black spherical shape in the supplied screenshot. The precise shader failure has not been confirmed in a live browser, but the fragile custom GLSL sky path has now been removed from v105.

Replacement:
- Large sky sphere with a locally generated CanvasTexture gradient and ordinary `MeshBasicMaterial`.
- No custom GLSL / `ShaderMaterial` in the v105 app or weather module.
- The sky follows the camera and remains behind the scene geometry.
- A soft sun-glow sprite is driven by the existing day cycle and sunlight checkbox.

## 3. Implemented files

### `weather-system.v1.js`
- Procedural sky gradient generated locally on canvas.
- Soft sun glow.
- Procedural soft cloud texture and 48 moving cloud sprites.
- Six weather presets: clear, partly cloudy, cloudy, overcast, snowfall, blizzard.
- 2,200 camera-following snow particles.
- Wind-driven snow streaks for stronger snowfall / blizzard.
- Wind-driven cloud drift.
- Weather-dependent direct-light reduction and ambient-light adjustment.
- Weather-dependent fog distance / visibility.
- Standard Three.js materials only.

### `app.v105.js`
- Imports and instantiates `WeatherSystem`.
- Existing time-of-day control updates the sky, sun and weather lighting.
- Weather updates run in the existing render loop in overview, skier and drone modes.
- The weather panel closes when entering immersive skier / drone modes.
- Browser-local weather preferences use the separate key `grade_optimizer_weather_v1`.

### `index.html`
- Adds a ПОГОДА toolbar button and weather panel.
- Six preset buttons and controls for cloud coverage, snowfall intensity and wind speed.
- Loads `app.v105.js`.

## 4. Weather behavior

| Preset | Cloud cover | Snow | Wind |
|---|---:|---:|---:|
| Clear | 0% | 0% | 2 km/h |
| Partly cloudy | 34% | 0% | 5 km/h |
| Cloudy | 66% | 0% | 9 km/h |
| Overcast | 96% | 0% | 13 km/h |
| Snowfall | 76% | 38% | 18 km/h |
| Blizzard | 100% | 100% | 46 km/h |

The sliders convert a preset into a custom configuration. Cloud cover dims direct sunlight and softens / increases ambient fill. Snowfall and wind reduce visibility through fog. Strong wind adds visible streaks.

## 5. Preservation and isolation

- A reverse-diff reconstruction test confirmed `app.v105.js`, after removing only the deliberate weather insertions, matches the original `app.v104.js` **byte-for-byte**.
- The original slope optimizer, red-snow material test, terrain materials, model import, Scene Editor, hierarchy, client workspace, GitHub saving and local-folder auto-sync code remain unchanged.
- Weather preferences are kept in browser `localStorage`; they are intentionally not written into client `scene.json` in this first pass.
- No user scene objects, models, collision data, or imported assets are created or changed by the weather module.

## 6. Static validation performed

- JavaScript syntax parse: `app.v105.js` — PASS (imports stripped for parser-only check).
- JavaScript syntax parse: `weather-system.v1.js` — PASS (module export stripped for parser-only check).
- App imports the weather module — PASS.
- Old sky shader references removed from v105 app — PASS.
- Sky CanvasTexture + MeshBasicMaterial present — PASS.
- Cloud sprites, snow particle system, blizzard streaks present — PASS.
- All six preset buttons and corresponding presets present — PASS.
- Weather UI element IDs match app bindings — PASS.
- Weather localStorage key exists and is separate from scene project serialization — PASS.
- Existing app preservation audit — PASS (byte-for-byte reconstruction).

## 7. Remaining validation before merge to main

- [ ] Open the feature build in a real browser and inspect sky rendering / horizon mapping.
- [ ] Confirm the black sphere is gone in the original camera view.
- [ ] Test all six presets at normal and maximum slider values.
- [ ] Test sunrise / noon / sunset / night with clouds.
- [ ] Test fog and snow visibility at low altitude, in overview, skier and drone modes.
- [ ] Check FPS and visual density with maximum blizzard.
- [ ] Confirm sunlight toggle and sun rotation controls still behave as expected.
- [ ] Inspect browser console for WebGL / runtime errors.
- [ ] Only after live validation, consider merging v105 into `main`.

## 8. Current status

**Implemented and committed on the feature branch:** v105 app integration, procedural sky replacement, clouds, presets, snowfall, wind streaks, fog response, separate browser persistence, and UI.

**Not yet done:** live browser rendering / performance validation. This environment has not run the Three.js app in an actual browser, so visual quality and FPS are not claimed as verified.

**Next action:** run the feature branch in the user's browser, fix any visual issues found, then update the QA report and decide whether to merge to `main`.
