# CHECKPOINT — Grade Optimizer: Sky, Lighting & Weather

**Date:** 2026-11-22  
**Repository:** `kortul/Grade_Optimizer`  
**Working branch:** `feature/sky-weather-v105`  
**Base branch:** `main`  
**Scope:** repair the black procedural sky dome and build a coherent environment / weather system without disturbing Scene Editor, client projects, or saving.

## 1. Exact source baseline inspected

- `index.html` loads `./app.v104.js`.
- `app.v104.js` SHA at inspection: `ff8938ab8388d2498e4eb4b145455cb15d6dc178`.
- The current app already contains the latest visible UI for Scene Editor, hierarchy, client workspace, local repository auto-sync, and the time-of-day control.
- Work must continue from the current `main` source, not from the older `Grade_Optimizer_v59.zip` archive.
- This checkpoint is committed only to `feature/sky-weather-v105`; do not merge to `main` until runtime checks pass.

## 2. Black sphere — source-level finding

The current `app.v104.js` creates a large procedural sky mesh:

- `skyDome = new THREE.Mesh(new THREE.SphereGeometry(12000, 32, 18), new THREE.ShaderMaterial(...))`
- The shader computes a vertical sky gradient (top / horizon / bottom) and a small sun glow.
- The mesh is rendered as a back-face sky dome with `depthWrite: false`, `depthTest: false`, and `renderOrder: -1000`.
- Every animation frame moves the dome to the camera: `skyDome.position.copy(camera.position)`.

This is the clear source of the giant spherical silhouette. The screenshot's black low-poly sphere is consistent with this mesh. **The exact shader failure has not yet been proven in a live browser**; the root-cause check must include browser console / WebGL shader diagnostics. Do not tell the user this is a scene asset, imported object, collision object, or anything they created.

The prior estimate of radius 9000 was incorrect for the current source: the inspected current value is **12000**.

## 3. Current environment implementation

### Lighting
- `THREE.HemisphereLight` provides ambient sky / ground fill.
- `THREE.DirectionalLight` provides direct sunlight and shadow casting.
- `updateDaylight(hours)` calculates sun altitude / azimuth and updates sky colors, sun direction/intensity, hemisphere colors, and `scene.fog.color`.
- Time control is exposed in `#dayCycle` via `#timeOfDay` and `#autoDay`.
- Existing light tuning controls are `#pLightOn`, `#pLight`, `#pSunRot`, and `#pShadow`.

### Atmosphere / snow
- There is a fixed `THREE.Fog(0x9bb4c8, 1800, 9000)`.
- Procedural canvas textures in `makeSnowTextures()` are for the **snow surface material** only. They are not falling snow or weather.
- No actual cloud/weather controls or animated snowfall system were found in `app.v104.js`.

## 4. Agreed direction for the next implementation

Build a native, procedural Three.js environment. Avoid external HDRIs, remote weather APIs, and heavy asset dependencies.

### Sky and daylight
- Remove the fragile black-producing sky-dome shader path.
- Replace it with a robust sky implementation using standard Three.js materials / vertex colors or another verified fallback.
- Preserve a coherent horizon gradient, correct sky orientation, and sun position.
- Improve the daylight curve through dawn, midday, sunset, and night; keep the current time slider and automatic day cycle.
- Tune exposure / ambient fill so snow remains readable without clipping to pure white.

### Clouds
- Add layered, soft stylized-realistic cloud formations with slow wind-driven movement.
- Support clear, partly cloudy, cloudy, and overcast states.
- Cloud coverage should affect sky brightness, direct sun intensity, contrast, and atmospheric visibility.
- Initial version need not cast volumetric cloud shadows; do not fake heavy shadows on the terrain.

### Weather presets and controls
Add a compact **ПОГОДА** toolbar control and a panel with presets:
- Ясно
- Переменная облачность
- Облачно
- Пасмурно
- Снегопад
- Метель

Expose independent controls for cloud coverage, snowfall intensity, and wind speed. Include a custom state when a slider is adjusted.

### Snowfall and wind
- Add camera-local particle snowfall so snow remains visible in overview, skier, and drone modes.
- Wind should drive lateral drift and stronger streaks at high snowfall / wind values.
- Scale particle count / visibility with intensity; keep performance bounded.
- Snowfall should reduce visibility through fog, but terrain and nearby models must remain legible.
- This is a visual effect only; it must not change slope geometry, terrain snow material, skier physics, or collision logic in the first pass.

### Persistence / project isolation
- Store environment preferences separately in browser localStorage (suggested key: `grade_optimizer_weather_v1`).
- Do **not** write weather settings into client `scene.json` in the first pass.
- Do not change GitHub publishing, local folder auto-sync, project autosave, Scene Editor serialization, model import, or client viewer behavior.

## 5. Planned file changes

1. Add `weather-system.v1.js` for sky, clouds, sun visuals, fog, and snowfall.
2. Copy `app.v104.js` to `app.v105.js`; integrate the weather module while preserving all existing features.
3. Update `index.html` to load `app.v105.js` and add the weather toolbar / panel markup and CSS.
4. Keep the feature isolated on `feature/sky-weather-v105` until verified.

## 6. Validation checklist before merging

- [ ] No black sphere / no giant visible sky mesh silhouette.
- [ ] Sky remains correctly oriented while orbiting, zooming, and moving the camera.
- [ ] Time slider: sunrise, noon, sunset, night; auto-day cycle works.
- [ ] All six weather presets work.
- [ ] Custom cloud, snowfall, and wind sliders update the scene.
- [ ] Snowfall and wind remain stable in overview, skier, and drone modes.
- [ ] Fog reduces distant visibility progressively without hiding the nearby terrain.
- [ ] No major frame-rate collapse at maximum blizzard settings.
- [ ] No changes to terrain color/material controls or red-snow test.
- [ ] Scene Editor selection, transforms, visibility, tags, collision/blocker fields, and autosave still work.
- [ ] Client `scene.json` format and GitHub/local folder saving behavior remain unchanged.
- [ ] Browser console has no shader, import, or runtime errors.

## 7. Current status

**Completed:** source inspection, root-object identification (sky dome), architecture review, implementation plan, and isolated feature branch creation.

**Not yet completed:** no weather code has been written or committed in this checkpoint. The live browser has not been used to verify the shader failure or visual quality.

**Next action:** implement the weather module and v105 app on this branch, then run static checks and browser validation before any merge.
