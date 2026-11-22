# Checkpoint — Skier Camera, Animation & Scene Editor Optics v111

Date: 2026-11-23

## Release
- Base commit: `59c893ec9cf74f04917ea48144f95e3115df4fc4`
- Active entrypoint: `index.html` → `app.v111.js`
- Active skier controller: `skier-controller.v75.js`
- Rollback: `app.v110.js` + `skier-controller.v74.js`

## Optics and Scene Editor
- Removed the separate Optics toolbar button and floating optics panel.
- Integrated optical processing controls into a dedicated sixth Scene Look tab inside Scene Editor.
- Redesigned category navigation as a 3×2 inspector card grid with icon, label, category kicker and selected state.
- Kept Camera (FOV / exposure / focus / aperture), Lens Character, Optical Processing, Color and Render settings distinct.
- Bumped browser settings to `grade_optimizer_optics_v3`. Existing v1/v2 preferences are migrated without importing the old Bokeh preference; DOF remains off by default. A deliberate v3 / scene setting can still enable it.

## Skier
- Reset third-person blend and tuck state on every spawn. Re-entering skier mode starts in first person.
- Raised the first-person eye point to 2.05 m and reduced the speed-tuck camera drop to 0.26 m.
- Added a pelvis pivot and more equipment seams, reinforcements, boot and glove details.
- Replaced direct pose assignment with frame-rate-independent exponential damping.
- Added turn-driven chest lean, pelvis counter-rotation, outside-leg loading, arm balance, pole sweep and smoother ski edging.
- The ski physics, mass, drag, friction, turn-rate limit, push impulse and speed cap are unchanged.

## Verification boundaries
- GitHub Actions checks JavaScript syntax, imports, DOM references and expanded static regressions.
- Pages build / deployment must pass for the same commit.
- No interactive browser / WebGL session is available in this pass. Actual silhouette, camera composition and animation timing still need visual QA in Chrome; FPS impact is not measured.

## Rollback
Restore `index.html` to `./app.v110.js`; that app imports `skier-controller.v74.js`.
