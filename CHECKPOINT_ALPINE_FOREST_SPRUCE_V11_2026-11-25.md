# Forest Lab V11 — fuller crowns with a lower geometry budget

Date: 2026-11-25

## Target
Keep the recognizable spruce branch hierarchy from V9/V10, make the crowns substantially denser, and recover performance after V10 dropped to about 8 FPS in the user's scene.

## Geometry changes
- Replaced separately generated triangular-prism needles with compact 3D needle tufts. One tuft contains eight individually oriented tapered needle blades and shares its shoot base (24 vertices rather than separate tubular geometry for every needle).
- Each near twig receives three overlapping tufts along its length plus a terminal tuft; mid gets two along its length plus terminal; far gets one compact tuft.
- Main branches remain layered and drooping; paired side twigs are retained on near and mid LODs.
- Branch, twig and snow geometry is simplified by LOD. Near: 9 tiers / 6 branches / 3 stations. Mid: 6 / 5 / 2. Far: 4 / 4 / 1.

## Performance changes
- LOD ranges tightened: shadow subset within 210 m, near LOD within 370 m, mid LOD within 1350 m; far LOD beyond.
- Instanced meshes are split into 420 m spatial cells.
- Each cell/LOD/variant uses a bounded InstancedMesh, computes its bounding sphere and enables frustum culling. The previous global batches forced all trees to render even when outside the camera frustum.
- The renderer logs placements, per-LOD vertex counts and batch counts for browser-side profiling.
- Whole-tree wind remains disabled; avoid adding per-vertex deformation until it can be implemented per branch / spray.

## Estimated geometry budget
From the construction counts, the near mesh is approximately 35k position vertices per tree, mid approximately 10k, and far under 1k (variant 0). These are source-level estimates; the renderer reports the actual counts in the browser console. The V10 near tree was above 100k vertices by the same count method, before accounting for every active instance.

## Files
- Renderer: `webgpu-forest-lab.v11.js`
- Main page: `webgpu-forest-lab.html`
- Standalone page: `webgpu-forest-lab-v11.html`

## Validation
Automated source/project checks and Pages deploy must pass for the final V11 commit. No FPS improvement is claimed until measured in the user's actual browser/device and scene; the changes target the known high vertex count, global non-culled batches, long mid/far LOD ranges and broad shadow radius.
