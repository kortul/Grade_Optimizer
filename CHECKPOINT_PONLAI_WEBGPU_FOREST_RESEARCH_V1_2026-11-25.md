# Checkpoint — Ponlai-inspired WebGPU Forest Research V1

Date: 2026-11-25

## Repository state
- Repository: `kortul/Grade_Optimizer`
- Branch: `main`
- Base commit: `642a77ff7c03914801dce0a031c3ce7ff254cca9`
- Research remains isolated from the production Grade Optimizer renderer and the main `app.v*.js` entrypoint.
- Active lab page: `webgpu-forest-lab.html`.
- `webgpu-atmosphere-lab.html` redirects to the combined Forest + Atmosphere WebGPU lab, so both old entry points reach the same experiment.

## Reference research
Reference: https://github.com/HuberyLL/ponlai

Relevant Ponlai ideas studied in source:
- Vegetation is instanced, has distance/screen-aware LOD and GPU-side wind deformation.
- Plant materials use shared physically based lighting, thin-leaf transmission / back-light, leaf-specific ambient response and shadow handling.
- Sky and sun share a day/weather state; ambient probes and ground bounce keep shaded vegetation related to its environment.
- The atmosphere uses a dedicated sky / cloud / fog / lighting pipeline and tuned post-processing.

Important licence boundary: Ponlai is multi-licensed by layer. This lab is an independently authored experiment inspired by the rendering principles; do not copy substantial code or creative assets from its AGPL / CC layers. Check the exact upstream licence for any future code or asset reuse.

## V2 work saved in this checkpoint
- The forest page now loads the dedicated `webgpu-forest-lab.v2.js` module (Three.js r187 WebGPU + TSL); the old `webgpu-forest-lab.js` remains as a rollback baseline.
- Removed the redirect that previously sent Forest Lab to the older WebGL `alpine-lab.html`.
- The atmosphere entry page now points to the combined WebGPU Forest Lab.
- The lab loads the actual `Slopes_Stage1` asset from `clients/alpine-resort/scene.json`.
- The previous mandatory dependency on `assets/real-terrain.json` and `assets/real-terrain.fbx` is optional. When absent, the lab builds an experimental procedural terrain apron from Stage 1's boundary edges, samples the nearest edge elevation and places trees on that approximation.
- The fallback forest placement bounds are expanded around the Stage 1 footprint, so trees are not clipped to the ski mesh's own bounding box.
- Preserved the three-level forest representation: detailed spline pines near, lighter spline pines at mid distance, atlas billboards far away.
- Added a day-linked, sun-direction-aware foliage back-light approximation for both spline pines and far atlas billboards.
- Added a wind-speed control for branch sway and an artistic back-light strength control.
- Added directional sun shadows, with shadow casting restricted to the nearest tree instances to control cost. Terrain and Stage 1 surfaces receive shadows.
- The tree count is shown explicitly in the lab UI.

## Verification performed
- JavaScript syntax check passed after stripping static imports for parsing.
- Static source checks passed for the optional terrain path, procedural apron, expanded tree-placement bounds, near-tree shadow partition, daylight-linked foliage back-light and new UI controls.
- HTML checks passed for the active V2 module, removed WebGL redirect, tree counter and controls.

## Not yet verified
- No live Chrome / Edge WebGPU browser session was available in this pass; GPU shader compilation and actual rendered appearance are not claimed as verified.
- Verify that the real `Slopes_Stage1` GLB loads and that the fallback apron follows its perimeter as expected.
- Inspect tree placement density, slope clearance, tree scale and camera framing.
- Tune foliage back-light against direct sun and night; current control is an artistic emissive approximation, not Ponlai's full thin-leaf scattering / transmission model.
- Check shadow acne, peter-panning, shadow-map coverage and frame-time impact. Near-tree-only casting is an initial performance guard.
- Next research milestones: real leaf / needle transmission, ambient fill / ground bounce, cloud-shadow integration, more stable LOD transitions, shadow LOD and reproducible screenshot / GPU timing checks.

## Rollback
- Repoint `webgpu-forest-lab.html` to `webgpu-forest-lab.js` and restore the previous redirect if V2 fails.
- The production Grade Optimizer renderer has not been changed by this research checkpoint.
