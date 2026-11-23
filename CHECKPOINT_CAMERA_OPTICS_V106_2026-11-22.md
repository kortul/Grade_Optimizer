# CHECKPOINT — Grade Optimizer: Camera Optics Safety & Polish

**Date:** 2026-11-22  
**Repository:** `kortul/Grade_Optimizer`  
**Branch:** `main`  
**Baseline:** `7eda4c6a82094f49be652660efe176d61e7bf72c`

## 1. Critical fix

The lens fragment shader in `camera-optics.v1.js` declared `highlightMask` twice inside the same GLSL `main()` scope. JavaScript syntax checks do not compile GLSL, so the previous static QA passed while WebGL could fail to link the lens shader and leave the post-processing output black.

The new `camera-optics.v2.js` renames the dirt-specific mask to `dirtHighlightMask`. The old module remains in the repository for rollback.

## 2. Runtime safety

- The optics module watches Three.js shader-link diagnostics for its custom lens shader.
- A lens shader compilation/link failure switches the frame back to direct `renderer.render(scene, camera)`.
- JavaScript exceptions in `EffectComposer.render()` also activate the direct-render fallback.
- The fallback is sticky for the current page session: it prefers a visible scene over repeatedly submitting a known-broken compositor.
- The renderer's previous shader-error callback is restored when the optics module is disposed.

## 3. Performance polish

- Composer render targets are resized only when the render-quality pixel ratio or viewport dimensions actually change.
- Ordinary Bloom / grading / lens slider changes no longer resize the composer on every input event.
- Existing quality profiles, Bokeh opt-in behavior, saved settings and project-level Scene Look serialization are preserved.

## 4. Release files

- `index.html` → `app.v106.js`
- `app.v106.js` → `camera-optics.v2.js`
- `scripts/validate-project.mjs` checks for duplicate GLSL local declarations in the custom lens shader, plus the direct-render fallback.
- Existing app v105 and camera-optics v1 are retained for rollback.

## 5. Live QA still required

A real browser/WebGL run is not available from the repository connector. After GitHub Pages deploys, verify:
1. Hard refresh with `Ctrl+F5`.
2. Toggle Post-processing off/on repeatedly; the terrain and sky must remain visible.
3. Compare Bloom, flare, dirt and grading at different sun angles / times of day.
4. Enable Bokeh separately and confirm focus / aperture behavior.
5. Check the browser console for shader errors and compare FPS in Performance / Balanced / High / Cinematic.

FPS and the actual deployed image have not been measured by these static checks.
