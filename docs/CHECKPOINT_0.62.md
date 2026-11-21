# Checkpoint 0.62 — PBR workflow and GLB round-trip

**Base:** v0.61 (app.v61.js is retained unchanged for rollback)
**Active app:** app.v62.js

## Added

- Separate texture-map import for Base Color, Normal, Roughness, Metalness, AO and Emissive.
- Correct color-space assignment: Base Color and Emissive use sRGB; data maps use a linear/no-color-space interpretation.
- AO maps get a UV2 attribute copied from UV when the imported mesh has no second UV set.
- PBR starter profiles: groomed/fresh snow, pine needles, bark/wood, concrete, asphalt, painted metal and simple glass.
- Load previously saved resort-scene-config.json after importing the matching GLB assets. Object transforms, phase/category flags, visibility and material parameters are restored.
- Export the selected edited object as a binary GLB using Three.js GLTFExporter. Uploaded maps and current material values are included in the exported model where supported by glTF 2.0.

## Workflow

1. Import one or more self-contained GLB files.
2. Select a mesh/material slot.
3. Apply a PBR preset and/or import texture maps.
4. Export the selected edited model as *_edited.glb.
5. Save the scene config JSON separately. On a later session, import the same source GLBs first and then load that JSON.

## Limitations

- JSON configuration stores settings and object metadata, not copies of standalone texture images. Export GLB to bake the currently assigned images into a portable model.
- This is a PBR material editor, not an arbitrary GLSL/shader-graph authoring tool.
- The simple Glass preset uses opacity; it is not a physically complete architectural-glass shader.
- The AO UV fallback duplicates UV into UV2. For assets needing a distinct AO unwrap, prepare UV2 in Maya.
- GLB export is wired against the Three.js r160 addon API. Actual export of a representative Maya model still needs browser-side validation, especially for unusual material extensions or very large textures.

## Validation

- Checked all new DOM IDs are defined once and referenced by the active module.
- Verified patch anchors and produced a new immutable app entrypoint.
- GitHub Actions result is recorded after push.