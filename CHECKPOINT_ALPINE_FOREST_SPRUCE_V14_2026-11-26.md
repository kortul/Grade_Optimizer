# Forest Lab V14 — fuller spruce crowns and stable camera motion

Date: 2026-11-26
Parent: V13

## Requested target
- Approximately twice the visible foliage fill compared with V13.
- 1920×1080 output target, with balanced quality rendering at native scale.
- Reduce shimmer, aliasing and CPU spikes while orbiting the camera.

## V14 changes
- Near/mid/far needle blade counts raised from 14/9/5 to 20/12/6.
- Needle spray volume expanded in all three axes; needle length and blade width increased moderately to close visible holes without creating a solid green blob.
- Added more irregular lateral twig stations and primary sprays; mid/far LODs retain more crown structure to reduce the visual quality cliff.
- Enabled the WebGPU renderer's 4-sample antialiasing path.
- Removed camera-yaw-triggered full forest rebuilds. Rotation is handled by normal frustum culling and no longer reallocates every InstancedMesh batch.
- Added distance hysteresis around shadow/near/mid/far transitions. LOD batches rebuild only after a real distance-band change.
- Forest batches are built off-scene and swapped atomically; spatial cells reduced from 520 m to 300 m for tighter frustum culling.
- Balanced/Cinematic use 1.0 render scale by default; Performance uses 0.85. Adaptive resolution has an 0.85 lower bound and reacts around a 60 FPS frame budget.

## Verification
- Source replacement guards passed for every edited block.
- Geometry remains deterministic; tree placement, slope sampling, existing silhouettes and scene assets are unchanged.
- No browser run, screenshot comparison or hardware FPS measurement was available in this editing session. Confirm the WebGPU backend, foliage stability and frame time in the actual scene after deployment.
