# Checkpoint — Forest Lab atmospheric correction V2

Date: 2026-11-25

## Trigger
The first unified atmosphere V1 was published to the isolated Forest Lab, but the user's browser capture showed a severe visual failure:
- inverted/unnatural olive-yellow zenith and saturated purple horizon;
- procedural cloud shells read as oversized coloured blotches;
- snow highlights were clipped / terrain contrast was weak;
- measured browser performance was about 8 FPS (129.8 ms per frame).

V1 is not accepted as visually successful.

## Correction committed
- Replaced the hand-authored RGB sky dome gradient with Three.js r187 `SkyMesh` physically based sky scattering.
- Bound its sun position, turbidity and Rayleigh values directly to the same solar state that drives the directional sun.
- Kept the same `SkyMesh` as the source for PMREM, so visible sky and PBR environment no longer use separate sky approximations.
- Replaced the broken custom-gradient fog in-scattering colour with a restrained blue daylight / deep-blue night / warm-twilight palette.
- Reduced cloud-shell opacity, desaturated the cloud underside, capped the cirrus opacity and enabled tone mapping on cloud materials.
- Reduced default god rays to zero to avoid an expensive extra screen-space effect by default.
- Reduced the Balanced profile's render scale to 1.0, haze resolution to 0.30, haze steps to 8 and AO resolution to 0.32. Performance and Cinematic remain selectable.
- Reduced AO samples from 16 to 8, reduced AO radius/scale, lowered environment intensity to 0.38, and kept hemisphere fill restrained.
- Capped direct sun intensity and lowered renderer tone-mapping exposure to preserve snow highlights.

## Active files
- `webgpu-forest-lab.html` -> `webgpu-forest-lab.v4.js?v=20261125m`
- `webgpu-forest-lab.v4.js` -> sole active Forest Lab scene renderer, solar controller and forest.
- `webgpu-forest-atmosphere.v1.js` -> active physical sky / clouds / PMREM / haze / AO / solar shaft module.

## Static checks
- Both active JavaScript files parse after stripping static imports/exports.
- All UI element IDs referenced by the entry module exist in the HTML.
- HTML element IDs are unique.
- Active entry no longer contains references to the previous custom RGB sky, old cloud module, old standalone fog pipeline or old PMREM owner.
- Active HTML cache tag is updated.

## Not claimed
A live WebGPU browser session is unavailable in this pass. The corrected visual result, actual FPS, sky/cloud shader compilation and snow exposure must be checked in Chrome/Edge. Do not mark the atmosphere complete until the user confirms the new capture.
