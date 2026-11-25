# Checkpoint — Forest Lab unified atmosphere rebuild V1

Date: 2026-11-25

## Scope
- Repository: `kortul/Grade_Optimizer`
- Branch: `main`
- Active entry: `webgpu-forest-lab.html` -> `webgpu-forest-lab.v4.js`
- This is an isolated WebGPU look-development lab change. Production `app.v*.js`, Grade Optimizer scene editing, skier systems, terrain loading, forest generation, and Maya Toolkit are untouched.

## Rebuild
The active Forest Lab no longer uses the previous split atmospheric path:
- Three.js `SkyMesh` with a separate PMREM update function;
- a separate cloud-layer module imported from `webgpu-cloud-layer.v3.js`;
- the previous independent fog / range-fog / god-ray render pipeline in the Forest Lab entry module.

The new independently authored module is `webgpu-forest-atmosphere.v1.js`.

## New system boundaries
1. **Sky radiance:** one TSL sky-radiance function drives a camera-following inward-facing spherical sky dome. It blends horizon and zenith, daylight blue scatter, a sun-directional Mie-like halo, twilight warmth and night sky.
2. **Clouds:** procedural lower cumulus and high cirrus live on spherical shells. Their appearance shares the same sun direction, daylight, twilight, wind, time, coverage and density. No large square cloud plane is used.
3. **Aerial perspective:** local haze integrates extinction through a height-dependent density profile. Long-distance haze uses Beer-Lambert transmittance, grazing-ray path length and mean ray altitude. The in-scattering colour samples the same sky-radiance function rather than adding a separate neutral grey or brown tint.
4. **Lighting:** PMREM is baked from the visible sky dome, so PBR environment reflections and the visible sky share one source. Hemisphere sky fill and ground bounce are driven by the same day/night state.
5. **Post:** depth-aware upsampling is retained for low-resolution haze and solar shafts; GTAO remains part of the Forest Lab render graph.

## Ponlai reference
The rebuild follows Ponlai's architectural separation of sky, weather/cloud transport, haze, day state and shared environment lighting. The implementation is independently authored. No Ponlai source code or creative assets were copied.

Reference architecture studied:
- `packages/render/sky/Atmosphere.ts`, `Sky.ts`, `Clouds.ts`, `CloudModel.ts`, `DayCycle.ts`
- `packages/render/weather/VolumetricHaze.ts`, `HazeDepth.ts`
- `packages/render/lighting/GroundBounce.ts`, `AmbientSample.ts`
- `packages/render/look/SkyLook.ts`

## Static verification
- Forest Lab entry parses as JavaScript after stripping static imports/exports.
- New atmosphere module parses as JavaScript after stripping static imports/exports.
- The Forest Lab entry no longer references `SkyMesh`, the old `createCloudLayer`, `buildFogPipeline`, `fogPipeline`, `cloudLayer`, or the previous PMREM owner.
- HTML points at the updated Forest Lab entry with a cache-busting query revision.
- UI defaults and displayed labels are synchronized for time, sun intensity, turbidity, Rayleigh and starting haze.

## Runtime verification boundary
No live Chrome/Edge WebGPU browser session was available in this pass. Shader compilation, visual dome/cloud ordering, horizon appearance, haze strength, PMREM output, and GPU frame time are **not** claimed as runtime-verified. They must be inspected in the browser before treating the visual rebuild as finished.

## Next visual QA
- Check a clear noon, golden hour, sunset, blue hour and night.
- Check clouds at 0%, medium and full coverage; confirm no square horizon seam or grey rectangle.
- Check low camera / distant horizon and high camera angles for dome continuity.
- Check shaded forest PBR response, shadow contrast and ground bounce; avoid a global grey lift.
- Check low-resolution haze edges and FPS in Performance / Balanced / Cinematic modes.
