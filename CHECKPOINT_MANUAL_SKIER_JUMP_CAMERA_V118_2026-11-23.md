# Checkpoint — Manual Skier Jump & Unified Camera Inspector v118

Date: 2026-11-23

## Release
- Active entrypoint: `index.html` → `app.v118.js`
- Active skier controller: `skier-controller.v79.js`
- Rollback: `app.v117.js` + `skier-controller.v78.js`

## Skier controls
- Space triggers a manual jump once per key press. Holding Space does not auto-repeat.
- Shift remains the only pole-push key.
- Jump requires the skier to be grounded on the terrain and not already airborne.
- Manual take-off impulse: 4.8 m/s, with a 1.1 s shared jump cooldown to avoid chained manual / bump take-offs.
- HUD shows ПРЫЖОК while airborne.
- Drone controls are unchanged: Space still ascends in drone mode.

## Scene Editor
- Six tabs: General, Environment, Camera, Color, Materials, Render.
- Camera now contains FOV, exposure, white balance, focus / aperture, lens character, bloom, flare, bokeh and lens-dirt settings.
- Separate Lens and Optics tabs and panels have been removed; existing control IDs remain unchanged inside Camera.

## Verification boundary
- CI checks six independent tab panels, every camera / lens / optics control, Space edge-triggering, grounded jump checks and Shift-only pole push.
- JavaScript syntax and the remaining project regression suite run in GitHub Actions.
- Actual jump feel, camera movement while airborne and visual appearance still need a live browser check.
