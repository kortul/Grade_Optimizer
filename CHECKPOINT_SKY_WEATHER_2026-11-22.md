# CHECKPOINT — Grade Optimizer: Scene Look, Weather & Camera Optics

**Date:** 2026-11-22  
**Repository:** `kortul/Grade_Optimizer`  
**Working branch:** `main` only  
**Code state:** `b294f6a990735d74ba3eb45a1edc95fa598343d2`

## 1. Main architecture

- `index.html` loads `app.v105.js`.
- Three.js is pinned to `0.160.0`.
- All implementation is committed to `main`; no separate feature branch is used.
- Existing Scene Editor, object hierarchy, PBR materials, imported assets, client project manifests and browser/local-folder autosave remain the persistence foundation.

## 2. Environment defaults

- Default weather preset: `light` — sunny sky, **18% cloud cover**, 0% snowfall, 3 km/h wind.
- `clear` remains an explicitly available cloud-free preset.
- Weather browser storage uses `grade_optimizer_weather_v3`; old v1 / v2 values migrate. Previous saved fully-clear defaults migrate to the new light-cloud default; previously enabled legacy snowfall is reset to zero.
- Weather controls are available in the quick Weather panel and Scene Editor → Scene Look.

## 3. Scene Editor — global Scene Look

A new global section appears at the top of the Scene Editor inspector. It is grouped and collapsible.

### Environment & Lighting
- Cloud coverage, snowfall, wind.
- Sun on/off, intensity, rotation / azimuth.
- Ambient fill.
- Shadow-map resolution: 1024, 2048, 4096.

### Camera & Exposure
- FOV and exposure bias in EV.
- White balance in Kelvin and green/magenta tint.
- Auto focus to the camera target or manual focus distance.
- Focus distance and aperture f-stop.

### Lens & Post
- Master post-processing.
- Bloom / halation and threshold.
- Lens flare, lens ghosts, anamorphic streak and lens dirt.
- Vignette, chromatic aberration, film grain, sharpening and lens distortion.
- Optional Bokeh / depth of field.

### Color Grading
- Contrast and saturation.
- Shadow lift / local exposure.
- Highlight compression.

### Render quality
- Performance, Balanced, High and Cinematic.
- ACES Filmic, AgX, Reinhard and Linear tone mapping.

A Reset Look button restores the shipped default look and light-cloud weather. The old bottom-toolbar sun and shadow controls are synchronized to the same settings object.

## 4. Camera optics module

File: `camera-optics.v1.js`

- EffectComposer pipeline: RenderPass → optional BokehPass → UnrealBloomPass → custom lens pass → OutputPass.
- Lens shader features include bloom support, screen-space optical ghosts and horizontal streak from the visible sun, highlight-sensitive lens dirt, vignette, chromatic aberration, film grain, sharpness, lens distortion, shadow lift / highlight compression, white balance, tint, contrast and saturation.
- Auto focus uses the camera target; manual mode uses configured focus distance. Aperture is controlled as f-stop.
- The master post-processing switch bypasses the composer to direct renderer output.
- Render quality profiles adjust the composer's pixel ratio; Bokeh remains opt-in because it adds a depth pass.

## 5. Project persistence

- `collectProjectEditorSettings()` now stores `visualSettings` and `weatherSettings` alongside per-asset editor settings.
- These values are written into client `scene.json`, browser project backups and manual Scene Config exports.
- Project loading applies global settings even if `editorSettings.assets` is empty.
- Scene Look and weather edits mark the project dirty and use existing debounced autosave.
- Browser-only preferences remain separate fallbacks; the published project settings are portable across devices.

## 6. Other completed visual fixes retained

- Black first-person sphere issue fixed by hiding the skier avatar immediately in first-person view.
- Sky sphere geometry removed; procedural gradient is rendered as scene background.
- Snow is zero by default and uses camera-space instanced textured quads. Particle updates are skipped while snowfall is disabled.
- Sky texture upload is throttled to actual gradient changes rather than re-uploading every frame.

## 7. Static checks

- JavaScript parser checks pass for app, weather and optics modules.
- All app DOM lookups were checked against HTML; no missing IDs or duplicate IDs.
- Light weather preset is 18% clouds / zero snow.
- The new Scene Look controls are connected to runtime values, project serialization and project restore.
- Legacy sun / rotation / shadow controls remain synchronized.
- Scene Config export/import includes visual and weather settings.

See `QA_REPORT_SKY_WEATHER_V105.md` for the detailed checklist.

## 8. Live browser checks still required

No actual browser/WebGL session was available for this update. Still to test on the deployed page:
- Visual quality and intensity of bloom, flares, ghosts, dirt, distortion and grading.
- Auto vs manual focus and Bokeh aperture at the model's real scale.
- Weather cloud appearance.
- Measured FPS at each render quality and with Bokeh.
- Cross-device project save / restore after publishing.
- Browser console and WebGL runtime errors.

Static syntax / wiring checks are not a substitute for live visual and performance QA.
