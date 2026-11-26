# Forest Lab V12 — three full spruce varieties and adaptive WebGPU resolution

Date: 2026-11-26

## WebGPU backend
The page creates `THREE.WebGPURenderer` and checks `renderer.backend.isWebGPUBackend` after initialization. The visible status reports either WebGPU or WebGL fallback.

## Tree varieties
- Norway: full classic conical crown, medium-wide lower boughs.
- Alpine: taller, narrower silhouette with more vertical tiers.
- Broad: wider mature spruce with longer drooping limbs.
- Tree heights are assigned in three bands: 6.5–12 m, 11–17 m and 17–23 m.
- Needle tufts contain ten broader, individually oriented blades whose roots are randomized inside a small volume. Needle length/width overlaps along the branchlets to close visible holes.

## Performance
- WebGPURenderer antialiasing is disabled.
- Adaptive resolution reduces the render scale by 8% after sustained frame times above 34 ms, down to 70%, and slowly restores it when frame times stay under 25 ms.
- Shadow map is 512; shadow camera far is 2,200 m.
- Shadow LOD radius: 140 m; near LOD radius: 260 m; mid LOD radius: 950 m.
- Tree batches are spatially divided into 520 m cells with frustum culling.
- Only near LOD receives shadows.
- V12 does not claim a measured FPS. Confirm in the actual browser scene.

## Files
- Renderer: `webgpu-forest-lab.v12.js`
- Atmosphere: `webgpu-forest-atmosphere.v2.js`
- Main page: `webgpu-forest-lab.html`
- Standalone: `webgpu-forest-lab-v12.html`
