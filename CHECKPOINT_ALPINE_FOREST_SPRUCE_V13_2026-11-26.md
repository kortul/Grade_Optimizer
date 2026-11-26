# Forest Lab V13 — irregular high-resolution spruce crowns

Date: 2026-11-26
Parent: V12 active Forest Lab

## Ponlai technology audit

Reviewed the repository's vegetation implementation, not just the first tree file:

- \`packages/render/vegetation/TreeMesh.ts\`: a mesh builder separates bark tubes from foliage cards. Tubes follow curves using parallel-transported frames. \`leafClump\` samples a 3D ellipsoid with a shell bias, random card yaw/size/atlas tile, and normals bent from the local clump toward the whole crown. Vertex exposure darkens interior foliage.
- \`TreeSurfaces.ts\` and \`LeafTexture.ts\`: bark height/normal maps are baked from a surface function; leaf sprays use separate colour, silhouette and per-leaf ID maps. Alpha mip levels preserve silhouette coverage instead of averaging foliage into solid squares; ID mip levels use point-preserving selection.
- \`Material.ts\`, \`VegetationLighting.ts\` and \`LeafLight.ts\`: foliage has a dedicated material path, alpha coverage, thin-layer response, wrapped diffuse, low cuticle specular and light-through/back-light controls. Bark, foliage, depth prepass and shadow filtering are not treated as one generic opaque material.
- \`Deform.ts\`, \`Wind.ts\` and \`TreeSurfaces.ts\`: deformation is layered from whole-plant bend to branch bend to spray bend and individual leaf flutter. Each plant and limb gets a stable hash-derived phase; a time-evolving spatial gust field moves across the scene.
- \`PlantInstances.ts\`, \`VegetationCull.ts\` and \`Lod.ts\`: a small set of reusable prototypes is instanced, GPU-culled and switched between near/far representations with a pixel/stipple fade. Shadow draws are handled separately from camera visibility.
- \`Bamboo.ts\`: actual branch examples use variable internode lengths, alternating main/lesser branches, randomized branch azimuth, rise, length, curved paths and irregularly positioned sprays; far geometry reduces ring sides and foliage count.
- The inspected Ponlai world vegetation examples are bamboo and herbaceous plants, not a drop-in alpine spruce generator. V13 adapts the general methods rather than copying Ponlai code or assets.

## V12 defect identified

The V12 spruce generator used 9–11 evenly spaced branch levels, evenly distributed branch azimuths, fixed lateral-shoot stations and paired left/right twig directions. Needle tufts arranged ten blades around a regular radial ring. These patterns explain the shelf-like and bush-like appearance.

## V13 changes

- Near tree prototypes now use 22, 24 and 26 jittered vertical tiers (2.2–2.5x V12) while mid/far LODs retain progressively reduced counts.
- Tier branch counts vary; gaps are weighted randomly, branches can be omitted, starts are slightly staggered, and length, droop, azimuth and branching direction vary independently.
- Main boughs and lateral/tertiary shoots use quadratic curves and higher-resolution tapered tube rings.
- Lateral shoots are distributed at irregular positions and directions rather than fixed mirrored pairs.
- Needle sprays are sampled through a 3D ellipsoid, biased toward its shell, with per-needle direction, position, length, width and hue variation. They overlap along both main boughs and secondary shoots.
- The three silhouettes remain Norway, Alpine and Broad; placement keeps existing height, width, yaw and tint variation.
- Spatial cell batching, InstancedMesh, WebGPU backend detection, adaptive resolution, and near/mid/far LOD architecture are retained.

## Verification status

- Static source assertions and JavaScript syntax checks are included in the quality workflow.
- CI can validate source structure and syntax but cannot establish the user's visual result or real GPU frame rate.
- No live browser capture or hardware FPS benchmark was run during this change. The new geometry has more near-LOD detail; measured user-side FPS is still required.
