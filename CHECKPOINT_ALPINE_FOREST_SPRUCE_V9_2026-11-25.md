# Forest Lab V9 — spruce geometry rebuilt from branches, not radial fans

Date: 2026-11-25

## Why V7/V8 were still wrong
The prior versions continued to express the crown as repeated radial fans. V7 also used a golden-angle tier rotation; V8 removed that rotation but still made the boughs from broad fan-like surfaces and repeated radial spokes. Removing only the golden angle could not fix the underlying silhouette.

## V9 changes
- Rebuilt the crown around a central trunk and leader, with 8 / 7 / 6 main woody limbs per whorl depending on LOD.
- Each main limb carries multiple secondary branches that droop outward and down.
- Secondary branches carry multiple short, volumetric, tapered needle sprays. There are no flat fan panels or broad leaf-card wedges.
- Each vertical whorl receives its own deterministic azimuth offset, rather than a constant rotation step that can read as a spiral.
- Snow is restricted to short narrow caps on selected main boughs.
- Disabled crown-wide wind displacement completely. Proper wind will be reintroduced only with per-branch and per-spray attributes, following the branch-local model documented in `ponlai`'s `TreeMesh.ts` and `Deform.ts`.
- Preserved Stage 1 placement, LOD instancing, snow PBR, physical SkyMesh, clouds, fog and lighting.
- Added a fresh V9 HTML entrypoint and cache token.

## Reference study
Reviewed `HuberyLL/ponlai` vegetation source: `TreeMesh.ts`, `TreeSurfaces.ts`, `Deform.ts`, `Material.ts`, and `LeafTexture.ts`. Relevant principles are separate woody branches and foliage geometry, per-branch / per-spray deformation attributes, controlled matte leaf shading, and coverage-aware foliage. The repository's active island species is bamboo, not an alpine spruce model, so V9 remains a purpose-built spruce implementation.

## Files
- Renderer: `webgpu-forest-lab.v9.js`
- Main page: `webgpu-forest-lab.html`
- Standalone page: `webgpu-forest-lab-v9.html`

## Validation
- CI and Pages were triggered for V9; check the latest run before calling deployment complete.
- Automated checks validate source structure and project regressions; they do not render the WebGPU page or judge the tree silhouette. Browser screenshot review is still required.
