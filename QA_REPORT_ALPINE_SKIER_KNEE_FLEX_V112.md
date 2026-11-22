# QA Report — Alpine Skier Knee Flex & Animation v112

## Changes
- `skier-controller.v76.js`: turn-weight smoothing, asymmetric knee flex, pelvis compression, body / arm / pole / ski damping, added kneepad and gaiter detail.
- `app.v112.js`: imports v76 controller.
- `index.html`: points to v112.
- `scripts/validate-project.mjs`: checks knee flex, outside support, inside-knee compression, smoothing and model details.

## Regression coverage
- Both knees gain flexion during a carve.
- Inside knee flexion exceeds outside knee flexion while outside leg retains longer support.
- Signed turn direction and carve strength are smoothed independently to avoid snapping when changing edges.
- Pelvis compression uses a base position and resets on spawn.
- Knee protection and shin detail belong to the articulated lower-leg hierarchy.
- Existing camera, optics, Scene Editor and project checks remain.

## Not verified
- Real browser appearance, knee silhouette under motion, camera composition and actual animation timing.
- Performance impact / FPS.
Static validation is not a visual sign-off.
