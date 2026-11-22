# QA — Grade Optimizer: Scene Look, Weather & Camera Optics

**Date:** 2026-11-22  
**Repository:** `kortul/Grade_Optimizer`  
**Branch:** `main`  
**Code state:** `b294f6a990735d74ba3eb45a1edc95fa598343d2`

## 1. Environment defaults

- Default preset is `light`: sunny / bright conditions with **18% cloud coverage**, no snowfall, and 3 km/h wind.
- A separate `clear` preset remains available for a completely cloudless sky.
- Weather storage was bumped to v3. Legacy v1/v2 browser values are migrated; a previously saved plain-clear default is upgraded to light cloud cover. Legacy snowfall is reset to zero while other user weather selections remain.
- Weather can be adjusted from both the quick Weather panel and the Scene Editor's global Scene Look section.

## 2. Scene Editor — Scene Look

A global inspector section now exposes collapsible groups:

### Environment & Lighting
- Cloud coverage, snowfall and wind.
- Directional sun enable, intensity and azimuth rotation.
- Ambient fill.
- Shadow-map quality (1024 / 2048 / 4096).

### Camera & Exposure
- Field of view.
- Exposure bias in EV.
- White balance in Kelvin and green/magenta tint.
- Focus mode (camera-target auto focus or manual focus distance).
- Focus distance and aperture (f-stop).

### Lens & Post-processing
- Master post-processing toggle.
- Bloom strength and threshold.
- Screen-space lens flare / optical ghosts / anamorphic streak.
- Lens dirt, vignette and chromatic aberration.
- Film grain, sharpening and lens distortion.
- Optional depth of field / Bokeh.

### Color Grading
- Contrast and saturation.
- Shadow lift / local exposure.
- Highlight compression.

### Render quality
- Performance, Balanced, High and Cinematic profiles.
- Tone-mapping choices: ACES Filmic, AgX, Reinhard and Linear.

Existing sun / rotation / shadow controls in the lower toolbar now synchronize with the Scene Look inspector rather than maintaining separate values.

## 3. Camera optics implementation

File: `camera-optics.v1.js`

- `EffectComposer` with RenderPass, optional BokehPass, UnrealBloomPass, custom lens pass and OutputPass.
- Bloom / halation, lens flare with screen-space ghosts and horizontal streak, lens dirt responding to highlights, vignette and chromatic aberration.
- White balance, tint, exposure, contrast and saturation.
- Subtle grain, sharpness, lens distortion, shadow lift and highlight compression.
- Sun flare uses the sun's projected camera position and is suppressed when the sun is disabled, hidden or outside the frame.
- Bokeh is optional; target-focus and manual focus modes are exposed.
- Quality modes adjust composer pixel ratio. The master toggle bypasses the post-processing chain and returns to direct renderer output.
- Optics settings are browser-backed under `grade_optimizer_optics_v2` and separately serialized into project `editorSettings.visualSettings`.

## 4. Persistence

Global environment and camera settings are now part of `collectProjectEditorSettings()`:
- `visualSettings` contains the complete camera / lighting / grading configuration.
- `weatherSettings` contains the weather preset and cloud / snowfall / wind values.
- They are included in client `scene.json`, browser project backups and Scene Config JSON exports.
- Opening a project restores these settings even when that project has no imported scene assets.
- Editing Scene Look controls marks the project dirty and uses the existing debounced browser / local-folder autosave flow.
- Reset Look restores the new default look and the light-cloud preset.

## 5. Static QA results

| Check | Result |
|---|---|
| Parse `app.v105.js` after stripping module imports | PASS |
| Parse `weather-system.v1.js` after stripping export | PASS |
| Parse `camera-optics.v1.js` after stripping module imports / export | PASS |
| No duplicate HTML IDs | PASS |
| All app `getElementById` references exist in HTML | PASS |
| New focus / distortion / local exposure controls exist and are bound | PASS |
| Light preset has 18% cloud coverage and zero snowfall | PASS |
| Legacy clear preset migrates to light default | PASS |
| Scene Look passes new values into CameraOptics | PASS |
| Visual and weather settings serialize with project editorSettings | PASS |
| Opening a project applies global settings even with no scene assets | PASS |
| Legacy toolbar lighting controls synchronize with Scene Look | PASS |
| Reset Look is wired | PASS |

## 6. Live browser validation still required

The connector and static checks do not provide a running browser/WebGL session. These checks remain open:
- Exact visual strength and taste of lens flare / bloom / dirt over the live slope scene and at different times of day.
- FOV / Bokeh focus behavior at the model's real scale, both target and manual focus.
- Compare shadows / highlights, white balance and local exposure visually.
- Measure FPS at Performance / Balanced / High / Cinematic and with Bokeh enabled.
- Confirm settings restore across two real devices after publishing the project.
- Browser console and actual WebGL runtime errors.

Do not claim that FPS or live visual quality have been measured until tested in a browser.

## 7. Suggested live test

1. Hard refresh with `Ctrl+F5`; the sky should load with light clouds and no snow.
2. In Scene Editor → Scene Look, compare lens flare / bloom by disabling Post-processing and re-enabling it.
3. Point the camera toward the sun; check that lens ghosts and the horizontal flare follow the sun in frame.
4. Test Auto and Manual focus modes, then adjust aperture from f/4 toward f/1.4.
5. Save the project, reopen it or open the same project on another device, and confirm environment / camera values restore.
6. Compare FPS in Performance and Cinematic modes; switch Bokeh off if GPU load becomes excessive.
