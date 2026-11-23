# Grade Optimizer · Deployment notes

The project is hosted as a static GitHub Pages site. A push to `main` triggers the Pages build and deployment workflow.

## Current release

- Active browser entrypoint: `index.html` → `app.v115.js`.
- Skier character and animation rig: `skier-controller.v77.js` (v73 retained for rollback).
- Previous app releases remain in the repository for rollback.
- Skier and drone controllers are versioned separately.
- Generated forest texture: `assets/trees/snowy_conifer_atlas.webp`.

## Safe release procedure

1. Read the current active module, camera-optics module, Scene Look UI and controllers before editing.
2. Create a new versioned app file rather than overwriting the previous release.
3. Update only the module script in `index.html` to point at the new file. Keep the previous app and optics modules for rollback.
4. Run `node scripts/validate-project.mjs`, or let the quality-check workflow run on the commit. This includes six Scene Look / Optics tab / DOF migration checks, skier camera-height, layered kneepad, inside-knee flexion, bilateral knee angulation, depth-safe skier visibility and 16:00 default-time checks, and a GLSL local-declaration check for the active lens shader.
5. Confirm both **Grade Optimizer quality checks** and **pages build and deployment** succeed for the same commit SHA, including camera-follow weather rendering, weather preset controls in all modes and daylight-responsive tree fill.
6. Hard-refresh the live site with Ctrl + F5 and test overview, skier eye-level first-person / third-person views, tuck, smooth carving counter-rotation, pole strokes, jump pose, drone, mode switching, and slope loading.

## Regression-sensitive areas

- Preserve the skier's ski rig and the drone's W/S forward/back controls.
- Keep tree billboards single-plane. Crossed planes caused visible depth-buffer flicker.
- Crop atlas cells into independent textures before mipmap generation.
- Keep async slope loads guarded so an older request cannot replace a newer selection.
- If a slope is changed while piloting or skiing, return to overview before replacing its terrain.
