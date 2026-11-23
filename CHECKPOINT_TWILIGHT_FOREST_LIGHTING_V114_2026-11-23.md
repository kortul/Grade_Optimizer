# Checkpoint — Twilight Forest Lighting v114

Date: 2026-11-23

## Release
- Base commit: dc95d04cd079378f1abf2bb84e28c235c6df5883
- Active entrypoint: `index.html` → `app.v114.js`
- Skier controller unchanged: `skier-controller.v77.js`
- Rollback: `app.v113.js`

## Changes
- Replaced the AI atlas tree billboard material from `MeshBasicMaterial` with light-responsive `MeshStandardMaterial`.
- Removed `toneMapped:false` from the atlas trees; the atlas now responds to the same sun / hemisphere lighting and tone mapping as the rest of the scene.
- Removed emissive contribution from both procedural foliage and fallback tree billboards, preventing green foliage and snowy cutouts from staying artificially bright in darkness.
- Preserved instanced single-card tree geometry, atlas textures, alpha test, fog and billboard camera-facing updates.

## Verification boundary
- Static regression checks assert that AI forest billboards use a lit material, do not bypass tone mapping, and have zero emissive contribution; the two fallback tree material paths are checked too.
- CI and Pages results are reported separately.
- Actual visual nighttime appearance in Chrome/WebGL has not been independently inspected in this pass.
