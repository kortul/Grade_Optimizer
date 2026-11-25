# Checkpoint — Forest Lab V6: complete snowy spruce rebuild

Date: 2026-11-25

## Intent
Replace the previous foliage-clump tree model and its far-distance atlas billboards. Keep the improved V4 physical sky and all terrain / tree placement logic unchanged.

## Reference
`docs/refs/snow-spruce-v6.svg` — original silhouette study: tall leader, broad descending whorls, layered dark evergreen boughs and continuous snow caps.

## V6 tree system
- New geometry generator built from individual whorled boughs, tapered branch axes and short needle sprays.
- Strong conical spruce silhouette with 15 / 11 / 7 branch tiers for near / mid / far LOD.
- White snow ridges sit on top of each bough, with heavier caps near outer tips.
- Removed the old clump-based foliage generator from the active renderer.
- Removed the crossed billboard / eight-image atlas path; far LOD uses the same new spruce geometry at reduced detail.
- Retains existing placement, terrain sampling, wind animation, instance batching and sky/atmosphere module.

## Active entrypoint
`webgpu-forest-lab.html` → `webgpu-forest-lab.v6.js?v=20261125q`

## Rollback
V5 remains in the repository; restore the HTML script reference to `webgpu-forest-lab.v5.js?v=20261125p` if required.
