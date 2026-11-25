# Checkpoint — Forest Lab atmospheric rollback V3.1

Date: 2026-11-25
Parent: `230ac663b0837481d8297a1576654ee1d2adb21c`

## User-visible regression
The added upper cirrus plane was a 32 km square horizontal surface. In the user's camera framing it appeared as a large grey rectangular patch and tinted scene objects. The same update also replaced the previous ambient/fog colour grade with a more neutral palette.

## Fix
- Kept the new volumetric spruce geometry, branch structure, crossed far-LOD cards and their instancing unchanged.
- Forest V3 now imports the previous known cloud module `webgpu-cloud-layer.v1.js`, which removes the extra cirrus plane from the active rendering path.
- Restored the previous known sky Mie values and the prior sun/hemisphere/fog palette from the V2 baseline, removing the experimental cloud-load attenuation and neutral ambient tint.
- Updated the Forest Lab HTML cloud description and added a script query revision to avoid a stale browser cache.
- The experimental `webgpu-cloud-layer.v2.js` remains committed but is no longer used by the active page; keep it as a research branch/reference until redesigned as a true sky-dome/cloud volume without a square horizon boundary.

## Verification
- Static checks confirm the active Forest V3 imports cloud layer V1, the V2 cirrus layer is not on the active execution path, and the prior atmosphere grade is restored.
- JavaScript syntax parse passed after stripping module imports.
- No live Chrome/Edge WebGPU runtime was available; visual regression fix still needs user-side confirmation.
- Main production Grade Optimizer files are untouched.

## Rollback
Previous active state is commit `230ac663b0837481d8297a1576654ee1d2adb21c`. The cloud-layer V2 file is retained in the repository.
