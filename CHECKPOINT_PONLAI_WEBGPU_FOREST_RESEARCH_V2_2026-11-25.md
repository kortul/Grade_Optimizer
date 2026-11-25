# Checkpoint — Ponlai-inspired WebGPU Forest Research V2

Date: 2026-11-25

## Isolation
- Repository: `kortul/Grade_Optimizer`, branch `main`.
- Parent: `1352591645ce798ac9c3659cacd0c1e2724f56a9`.
- Only the standalone WebGPU Forest Lab, its cloud-layer module and this checkpoint are changed. Production Grade Optimizer renderer and `app.v*.js` are untouched.
- Active page: `webgpu-forest-lab.html`; V2 source remains as a rollback point.

## Forest
- Replaced flat ribbons as the dominant canopy surface with tapered 3D needle clumps built from irregular radial rings, vertex-colour depth, small snow catch and fine terminal sprays.
- Rebuilt near/mid spruce silhouettes around curved trunks, whorled primary branches, lateral branchlets, layered clumps and irregular leaders.
- Increased deterministic variation between the three tree variants.
- Kept instanced LOD. Far trees now use three crossed atlas planes rather than a single camera-facing plane.
- Updated the approximate foliage back-light response to use the new clump normals. This is still artistic back-light, not a complete thin-needle scattering BRDF.

## Atmosphere
- Mie scattering now responds to turbidity.
- Horizon/fog tint and hemisphere fill respond to sun cycle, twilight, cloud load and turbidity.
- Direct sun is mildly attenuated by the overall cloud load. This is not a per-pixel cloud-shadow solution.
- Added an upper anisotropic cirrus deck sharing time, wind, sun and weather state with the lower cloud layer.

## Ponlai reference and licensing
The implementation is independently authored and inspired by Ponlai's architectural principles: vegetation instancing, LOD, branch motion, clumped foliage, material-aware light-through response, and day-linked atmosphere. It does not copy Ponlai source or use its creative assets.

## Verification / remaining work
- Static linkage checks passed; both JavaScript modules passed syntax parsing after stripping their static import/export declarations.
- No live Chrome/Edge WebGPU session or visual capture was run. Runtime shader compilation, actual tree appearance, cloud visibility, shadow artifacts and GPU timings remain to be verified in the browser.
- The apron still estimates ground height from the nearest Stage 1 footprint edge when terrain source data is absent.
- Tree shadows remain limited to near instances. Foliage transmission is approximate. Cloud layers are procedural horizontal decks, not a full 3D atmosphere.
- Next milestones: ambient probes/ground bounce, branch-level wind phase, LOD cross-fades, real cloud shadows, and measured runtime captures.

## Rollback
Point `webgpu-forest-lab.html` back to `webgpu-forest-lab.v2.js` and its import back to `webgpu-cloud-layer.v1.js`. Production files remain unchanged.
