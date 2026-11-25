# Forest Lab V10 — dense spruce crowns

Date: 2026-11-25

## Goal
Keep the accepted V9 tree silhouette, but make the crowns dense and full rather than skeletal.

## Changes
- Increased the crown density with closely spaced secondary twiglets along every main bough.
- Added matching twiglets on both flanks of each main branch instead of alternating a single twig from side to side.
- Each twig now carries several compact needle whorls along its length. Each whorl uses 3D tapered needles distributed around the twig axis, with different directions and slight variation in length / shade.
- Added short terminal sprays to cover bare twig ends.
- Kept V9's branching silhouette, independent per-tier azimuths, narrow snow caps, neutral snow PBR, physical SkyMesh and placement pipeline.
- Whole-tree wind remains disabled. The wind control is explicitly disabled until branch-local `branchFrom` / `branchTo` / spray deformation attributes are implemented.

## Reference study
`HuberyLL/ponlai` source reviewed: `TreeMesh.ts` `leafClump` distributes individually oriented leaf cards over a volume around a branch tip; `TreeSurfaces.ts` `LeafPainter` supplies detailed foliage textures; `Bamboo.ts` documents branch-aligned spray placement and separately bending branches and sprays; `Deform.ts` provides separate branch and spray bends. V10 applies the density lesson—overlapping, outward-facing foliage distributed around branch geometry—using low-poly 3D conifer needles rather than bamboo's narrow leaf cards.

## Files
- Renderer: `webgpu-forest-lab.v10.js`
- Main page: `webgpu-forest-lab.html`
- Standalone page: `webgpu-forest-lab-v10.html`

## Validation
CI and Pages runs for V10 are triggered by the final V10 commits. Automated checks verify the branchlet / needle density structure but do not evaluate the browser image. Confirm the silhouette and fill visually from the V10 page.
