# H3 safety-net alignment — 2026-11-28

## User-visible issue

H3 safety-net panels became visible, but the panels appeared level and did not follow the piste's longitudinal grade or tighter bends.

## Root cause

The previous builder used only a horizontal centreline heading (X/Z) and a yaw-only rotation. The panel's vertical axis stayed in world Y while the width axis ignored the Y component of the route. The heading was also averaged over a long window, and it came from the centreline rather than the actual Stage 1 piste edge.

## Changes in v3

- Sample left and right edge points from the classified Stage 1 Slopes / AngledSlopes surface while scanning the centreline.
- Derive each candidate panel's local 3D direction from its corresponding sampled piste edge, including X, Y and Z. Use a 4.5 m local tangent window.
- Construct the panel transform with its width axis along the 3D piste edge and its height axis along world-up. The top and bottom edges therefore inherit the longitudinal piste grade while the fence posts stay vertical.
- Keep the existing sparse placement rules (turns and steep external edges), H3-only source selection, panel dimensions and material look.
- Preserve and enforce the max-panel limit after deferred edge-tangent calculation.

## Active release

- `index.html` activates `app.v219.js?v=228`.
- H3 geometry and placement are provided by `safety-fences.v3.js?v=3`.
- Legacy terrain height lookup remains imported from `safety-fences.v1.js?v=6`.

## Regression coverage

- Stage 1 surface lookup and H3 selection.
- A sloped surface verifies that panel width vectors carry the real Y grade.
- A 90-degree piste bend verifies that successive panels rotate with the sampled piste edge.
- Instanced panel matrices verify that the posts remain world-vertical while the top and bottom edges follow the grade.
- A max-panel test guards the deferred placement path.

Browser rendering on the live alpine-resort scene still needs visual confirmation in Maya / the browser; CI tests validate the geometry math and placement logic, not a user-side screenshot.
