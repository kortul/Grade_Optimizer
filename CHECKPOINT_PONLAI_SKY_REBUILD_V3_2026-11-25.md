# Checkpoint — Forest Lab physical sky + snow PBR baseline V3

Date: 2026-11-25

## Why V2 was rejected
The user's new browser capture showed a uniformly white sky and grey/dirty terrain, with approximately 8 FPS (about 125 ms/frame). V2 is not accepted as visually successful.

## Source findings
- The official Three.js r187 `webgpu_sky.html` example constructs `SkyMesh`, uses a normalized unit sun vector, and sets `renderer.toneMappingExposure` to 0.05 through its GUI defaults. This lab had a global exposure of 0.52, causing the physical sky radiance to clip white.
- The previous lab used two independent procedural cloud shells, a low-resolution volumetric haze pass, two depth-aware upsampling filters, a God-rays pass and GTAO. Even with rays set to zero, the render graph still executed the ray pass.
- Stage 1's two semantic Maya materials and vertex-color attributes were carried into PBR output. The result displayed strong gold/purple/grey patches that are not acceptable for a winter ski-resort look.

## V3 changes
### Atmosphere
- Replaced the custom cloud shells with the cloud controls built into Three.js `SkyMesh`. The visible sky and clouds now share the same physical scattering shader and solar direction.
- Kept the scene exposure at 0.52 for terrain/PBR, but multiplied the SkyMesh radiance by 0.096. This is calibrated against the 0.05 exposure used by the official r187 sky example.
- PMREM is generated from that same SkyMesh. Environment intensity is compensated to 3.8 so the sky-energy reduction does not simply remove PBR image-based lighting.
- Replaced the multi-pass haze/GTAO/god-rays pipeline with direct `renderer.render(scene,camera)` and a native `FogExp2`. This is a deliberately simpler baseline to establish correct sky/ground color and responsive frame time before reintroducing expensive volumetrics.
- Sky and atmosphere controls remain linked to the single solar clock.

### Snow material
- Replaced the generated grass/soil/stone albedo with a restrained snow/packed-snow/blue-ice procedural map.
- Both the real-terrain path and Slopes_Stage1 use the same neutral snow PBR material.
- Source albedo colors and vertex colors are intentionally ignored for the winter look-dev render; geometry, groups, normals, shadow receiving and forest placement remain.
- The procedural slope apron uses the same snow material rather than separate green/rock/snow vertex colors.

### Performance
- Direct render replaces the previous multi-pass screen-space pipeline.
- Balanced resolution is now 0.85 pixel ratio; Performance 0.65; Cinematic 1.0.
- Shadow map reduced from 2048 to 1024.
- Only near detailed trees cast shadows. Mid and far LOD no longer cast into the shadow map.

## Active files
- `webgpu-forest-lab.html` -> `webgpu-forest-lab.v4.js?v=20261125n`
- `webgpu-forest-lab.v4.js` -> Forest Lab scene, snow surface conversion, terrain loading, forest LOD and solar controller.
- `webgpu-forest-atmosphere.v1.js` -> physical SkyMesh, native clouds, PMREM IBL and native distance fog.

## Static verification
- Active renderer and atmosphere modules parse as JavaScript after stripping imports/exports.
- All app UI IDs resolve to unique HTML IDs.
- Old `fogPipeline`, GTAO, custom cloud-shell and screen-space god-ray code is no longer active.
- Terrain and Stage 1 material conversion routes to the same cached neutral snow PBR material.
- Procedural apron uses the same snow PBR map and no longer builds a separate grass/rock vertex-color field.

## Not claimed
No live browser WebGPU shader-compilation or visual verification is available in this pass. This is an architectural simplification and a grounded correction of the two visible color causes, not a claim that the final visual look or FPS is now approved. The next browser capture must be checked before adding volumetric clouds/haze back.
