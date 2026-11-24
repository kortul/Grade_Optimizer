# Checkpoint — Scene Editor Shared FBX Materials v175

Date: 2026-11-24

## Release
- Active entrypoint: `index.html` → `app.v175.js`
- Previous release retained: `app.v174.js`
- Main production renderer and Scene Editor schema unchanged.

## Problem
Maya can export one logical shader as multiple FBX material nodes / IDs on separate mesh components. The Materials inspector groups by material instance UUID, so distinct instances were displayed as repeated materials even when they represented the same Maya shader. Stage 1 also contains copied Slopes aliases and a technical `openPBR_shader1` slot.

## Changes
- `prepareFbxMaterials` now canonicalizes repeated FBX source materials by normalized Maya shader name before the per-surface pass. Distinct Maya material IDs with the same source shader name now point to one Three.js material object across all meshes.
- Stage 1 detection no longer depends only on the exact filename. It recognizes a Stage 1 FBX by filename, Maya hierarchy, or the expected Maya Slopes / Angled source-material names.
- Stage 1 surface normalization maps `zzMainlandscape_Slopes` and `pasted__pasted__zzMainlandscape_Slopes` to one `Slopes` instance, and `zzShapka_Angled` to one `Angled` instance.
- The technical `openPBR_shader1` slot inherits its surface class from the Maya hierarchy; if the hierarchy does not provide one, it falls back to the Slopes class instead of creating a third material.
- The 22 mesh components remain separate. Only their material references are shared; geometry and material groups are not merged.
- Stage 1 normalization records mesh count, source slot count and canonical material count in root userData / console diagnostics.

## Expected Stage 1 result
- One `Slopes` material for all Slopes-class faces across the FBX.
- One `Angled` material for all Angled-class faces across the FBX.
- The Materials inspector should list two unique materials for the current Maya Stage 1 export, with their mesh usage shown in each material label.
- Editing either shared instance changes all slots that reference it.

## Verification boundary
- CI checks module syntax, the Maya Stage 1 source-material inventory in `clients/alpine-resort/scene.json`, Stage 1 detection / canonicalization logic, and asset-wide material bindings.
- A live browser visual test of editing Slopes / Angled across all 22 meshes is still required; static QA does not claim visual sign-off.
