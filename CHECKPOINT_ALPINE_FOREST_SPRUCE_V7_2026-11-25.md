# Forest Lab V7 — alpine spruce rebuild

Date: 2026-11-25

## Why V6 was rejected
The supplied screenshot still read as rounded foliage clusters rather than recognizable spruce boughs. The whole-vertex wind node also displaced the entire crown with a large height-based amplitude, producing algae-like motion.

## V7 changes
- Replaced the prior segmented tube / snow-ridge tree recipe with broad, flattened, descending whorl boughs.
- Each bough has a tapered branch axis, fan-shaped upper foliage surface, paired outward/downward needle blades, and three separated snow patches.
- The tree has a narrow continuous leader; no separate top pin, sphere or billboard.
- Near / mid / far LODs all use the same spruce design with reduced tier and spray counts.
- Wind now scales with horizontal reach from the trunk, not height alone. The trunk and central leader remain almost still; only outer branch fans flex subtly.
- Added a runtime cleanup pass for imported Stage 1 nodes whose names identify legacy tree / pine / spruce / foliage / vegetation / needle assets.
- Added a unique `webgpu-forest-lab-v7.html` entrypoint so a cached old HTML page cannot continue selecting V5/V6.

## Files
- Active renderer: `webgpu-forest-lab.v7.js`
- Main entrypoint: `webgpu-forest-lab.html`
- Cache-busted entrypoint: `webgpu-forest-lab-v7.html`
- Geometry study: `docs/refs/snow-spruce-v7.svg`

## Validation
- Quality workflow: syntax checks, Forest Lab PBR regression tests and project validation passed on the V7 code.
- Pages deployment is tracked separately; visual browser verification is still pending. Inspect the actual V7 page after deployment and tune against a screenshot if needed.
