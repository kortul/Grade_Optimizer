# Forest Lab V8 — stable natural spruce whorls

Date: 2026-11-25

## V7 issue
The generated crown looked like a vortex because each successive branch tier rotated by the golden angle (`level * 2.399`). Combined with broad fan-shaped branch surfaces, this produced a conspicuous spiral / turbine silhouette. The previous geometry was not acceptable.

## V8 correction
- Removed golden-angle rotation between vertical tiers. Whorls now share a stable compass orientation with only a tiny alternating offset.
- Reduced branch count to 5 / 4 / 3 by LOD and reduced tier count to 11 / 8 / 6.
- Removed broad solid fan surfaces. Each bough is now a woody radial branch with paired, drooping secondary twigs and fine tapered needle blades.
- Snow is broken into small caps on the upper side of the main boughs.
- Kept the central trunk and narrow leader; retained subtle branch-only wind and the physical SkyMesh / snow PBR pipeline.
- V8 has a new renderer and standalone HTML entrypoint with a new cache-busting query.

## Reference repository
Reviewed `HuberyLL/ponlai`, particularly `packages/render/vegetation/TreeMesh.ts`, `TreeSurfaces.ts`, `Material.ts`, and the vegetation wind/deformation modules. The project provides useful reference for physically based foliage shading, per-branch wind deformation, and leaf-card rendering; it does not supply a spruce model. V8 therefore uses its material / deformation principles as reference while keeping a purpose-built alpine spruce mesh.

## Files
- Renderer: `webgpu-forest-lab.v8.js`
- Main page: `webgpu-forest-lab.html`
- Standalone page: `webgpu-forest-lab-v8.html`
- Geometry study: `docs/refs/snow-spruce-v8.svg`

## Validation
- Quality and Pages workflows triggered on the V8 commit; check their latest run status before treating deployment as complete.
- CI does not visually inspect the WebGPU render. Browser screenshot verification remains necessary.
