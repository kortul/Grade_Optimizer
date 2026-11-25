# Checkpoint — Alpine Forest V5 snowy spruce refinement

Date: 2026-11-25
Parent renderer: `webgpu-forest-lab.v4.js`
Active entrypoint: `webgpu-forest-lab.html` → `webgpu-forest-lab.v5.js?v=20261125p`

## Goal
Correct the procedural trees' seaweed-like silhouette while preserving the improved physical sky and all terrain / placement behaviour.

## V5 changes
- Increased the number of vertical branch tiers and the branches per tier for a fuller spruce outline.
- Changed the main foliage clumps from upward-leaning elongated forms to compact, outward-growing bough clusters.
- Added more short, alternating secondary shoots that fan outward and droop gently.
- Increased upper-surface snow coverage on the clumps so snow reads as a visible layer on branch tops.
- Reduced the foliage material's clearcoat and specular response for a more natural matte evergreen finish.
- Applied controlled per-tree crown-width variation to near, mid and far LOD instances.
- Kept the existing eight-image atlas for far LOD billboards.
- Kept the V4 atmosphere module, physical SkyMesh, solar cycle, cloud controls, snow PBR terrain, cached terrain lookup, piste footprint and forest placement unchanged.

## Verification
- Updated `scripts/validate-project.mjs` to point to V5 and assert the denser tier structure, horizontal foliage, stronger upper snow and matte material.
- Static verification is wired into the existing GitHub Actions project validator.
- No live browser WebGPU capture is claimed by this commit; the actual silhouette and GPU cost still need visual confirmation in Forest Lab.

## Rollback
Restore `webgpu-forest-lab.html` to load `webgpu-forest-lab.v4.js?v=20261125n`. V4 source remains unchanged.
