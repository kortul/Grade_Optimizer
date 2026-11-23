# Checkpoint — Alpine Skier Knee Flex & Animation v112

Date: 2026-11-23

## Release
- Base commit: `d9a4046efb227ff11b17be6f3d091e989179f4ee`
- Active entrypoint: `index.html` → `app.v112.js`
- Active skier controller: `skier-controller.v76.js`
- Rollback: `app.v111.js` + `skier-controller.v75.js`

## Animation
- Added separate smoothed signals for signed turn direction and carve compression.
- Both knees flex during a turn; the inside knee folds more deeply while the outside leg remains longer and supports the arc.
- Hip flexion, pelvis compression, torso pitch/roll, arm balance, pole sweep and ski edging share the same damped turn envelope.
- Compression responds to speed and steering demand, not merely a binary key press; releasing or reversing a turn eases through neutral.
- Pelvis position is restored from its base value on spawn, preventing accumulated offsets.

## Character detail
- Added a layered oval kneepad, upper/lower stitched straps and reflective shin piping attached to the moving lower-leg group.
- Added a gaiter seam and further boot fabric detail.

## Physics / scope
- No ski physics parameters or movement forces changed.
- DoF default, Scene Editor optics, first-person eye height and v111 controls remain intact.

## Verification boundary
- Static source regressions cover shared turn flex, deeper inside-knee bend, outside support, damped joint rotations and knee detailing.
- GitHub Actions and Pages must pass for this SHA.
- Real browser/WebGL animation timing and FPS are not visually verified in this pass.
