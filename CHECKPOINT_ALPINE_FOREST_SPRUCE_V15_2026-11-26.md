# Forest Lab V15 — textured spruce spray cards and GPU-cost reduction

Date: 2026-11-26
Parent: V14

## User-reported V14 result
- No visible improvement in crown appearance.
- Approximately 22 FPS.
- Foliage read as angular polygon triangles rather than textured conifer sprays.

## Root cause
V14 still built every needle as an isolated three-vertex triangle. The material had no foliage atlas or alpha-cutout path, so the entire crown was untextured faceted geometry. Increasing the triangle count could not produce the soft, overlapping spruce sprays visible in Ponlai's vegetation.

## Ponlai implementation pattern adapted
- Leaf clumps place randomized quads throughout a 3D shell-biased ellipsoid, with card normals bent toward the clump and overall crown.
- A 2x2 procedural atlas carries the fine foliage silhouette, with a separate alpha texture.
- Alpha mip levels preserve silhouette coverage so distant cards do not vanish or become opaque rectangles.
- Vegetation material uses alpha test / alpha-to-coverage rather than modelling every tiny needle as an independent polygon.

No Ponlai art assets or source code were copied. The implementation uses an original procedural alpine-spruce spray atlas.

## V15 changes
- Replaced isolated needle triangles with textured alpha-cut spray cards. One card per clump, with a second crossed card on a subset of near clumps, gives 3D volume without a full triangle per needle.
- Added four distinct irregular spruce spray patterns in a procedural 512x512 atlas.
- Added separate coverage-preserving alpha mipmaps and a dedicated white texel patch for the bark/twig vertices sharing the same material.
- Added UVs to the combined branch/foliage geometry; twig UVs sample the opaque white texel while foliage cards sample atlas tiles.
- Reduced near twig stations to four, per-twig clumps to two, primary sprays to three and tertiary branching probability to 18%.
- Reduced branch tube tessellation and leader sprays; kept the existing Norway / Alpine / Broad silhouettes, tier count, curved limbs and irregular branch azimuths.
- Reduced near / mid LOD radius and restored 520 m spatial cells to limit detailed tree work and draw-call count.
- Kept MSAA, alpha-to-coverage and 1080p output. Balanced starts at native scale; adaptive internal render scale can descend to 55% to protect frame rate when the GPU is overloaded.
- V13 and V14 source files remain unchanged for A/B comparison and rollback.

## Verification
- Static source assertions and JavaScript syntax checks run in GitHub Actions.
- No live hardware benchmark or in-browser screenshot capture is available from the connector session. User-side FPS and appearance comparison is still required.
