# Checkpoint — Ponlai-inspired WebGPU Atmosphere V3

Date: 2026-11-25
Parent: `93b51f70d637b0676eeeffc59c780bbd3819cebb`

## Scope
- Active page uses `webgpu-forest-lab.v4.js` and `webgpu-cloud-layer.v3.js`.
- Production renderer and `app.v*.js` are untouched.
- Previous V3, cloud V1 and experimental cloud V2 remain available.

## Research
Inspected Ponlai `Atmosphere.ts`, `VolumetricHaze.ts`, `HazeDepth.ts`, `HazeLook.ts`, `SkyLook.ts`, `Sky.ts`, `GroundBounce.ts` and `AmbientSample.ts`.
Key architecture differences: height-dependent participating haze with integrated optical depth; in-scattering linked to the same sky; spherical cloud shells; local ambient volume and ground bounce rather than a global grey lift.
This implementation is independently authored and does not port source code or assets.

## Changes
- Replaced the flat cloud quad with inner-facing spherical lower-cloud and high-cirrus shells.
- The cloud shells share time, wind, cloud coverage, density, sun and camera state; their boundary follows sky curvature rather than a square plane.
- Replaced squared range fade with Beer-Lambert-style height-dependent aerial perspective. Low grazing rays accumulate more atmosphere than steep rays; density drops with mean ray altitude.
- Near volumetric haze and distant perspective combine through transmittances.
- Added a restrained direction-dependent Mie forward-scatter tint near the sun/twilight direction.

## Static verification
- Syntax parse both new JavaScript modules after stripping static import/export declarations.
- Verify HTML references V4, active forest imports cloud V3, and cloud V3 contains no 24 km plane.
- No live WebGPU runtime or shader compilation is claimed. Verify dome visibility/depth order, horizon transitions, color and performance in Chrome/Edge.

## Limits
Clouds remain procedural spherical surface shells, not full volumetric raymarching. Aerial perspective is an analytic height approximation, not Ponlai's froxel LUT atmosphere. Ambient probes/ground bounce and true cloud-shadow maps remain future work. The Stage 1 apron remains approximate when terrain source assets are missing.

## Rollback
Point the HTML back to V3 and restore the V1 cloud import. Production files are untouched.
