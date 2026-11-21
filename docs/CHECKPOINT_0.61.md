# Checkpoint 0.61 — First-person camera + Scene Editor

**Base:** `23c51aaf65346392088ebd2774572973a6888b6a`

## Camera
- First-person eye position raised from 1.62 m to 1.80 m above the local terrain surface (along the interpolated terrain normal).
- Ski meshes remain visual foreground geometry; they do not determine camera height.

## Scene Editor
Open **SCENE EDITOR** in the top toolbar.

### Import
- Import one or more self-contained binary `.glb` files.
- GLTFLoader parses the binary GLB directly, so textures embedded in the GLB are available in the material inspector.
- External-resource `.gltf` files and loose texture folders are not supported by this first pass.

### Objects
- Select imported object.
- Edit position X/Y/Z, yaw rotation, and uniform scale.
- Assign category and construction phase metadata: `always`, `stage_1`, `stage_2`.
- Toggle visibility and record collision / forest-blocker metadata.
- Remove imported objects.

Note: phase, collision, and forest-blocker values are stored as metadata in this version; they are not yet connected to cumulative phase filtering, physics colliders, or tree scattering.

### PBR material inspector
For each mesh material slot, edit:
- Base Color
- Roughness and Metalness
- Normal Strength
- AO Intensity (effective only when an AO map is present)
- Emissive Color and Strength
- Texture tiling / repeat
- Opacity
- Double Sided and Wireframe

Changes apply immediately to the in-memory material instance. They do not rewrite the original GLB file.

### Save
- **СОХРАНИТЬ НАСТРОЙКИ СЦЕНЫ · JSON** exports object metadata, transforms, and material parameters.
- This JSON is a settings snapshot. Loading it back into a later browser session and baking materials into a new GLB are future tasks.

## Validation
- JavaScript module syntax smoke checks passed.
- All static DOM element IDs referenced through `getElementById` exist in `index.html`.
- Manifest JSON checks from checkpoint 0.60 remain intact.
- GitHub Actions deployment run: https://github.com/kortul/Grade_Optimizer/actions/runs/44915149503 (build, report status, deploy all succeeded).

## Next milestones
1. Add a texture-map loader for individual Base Color / Normal / Roughness / AO / Emissive maps.
2. Add material profile presets and reload/apply saved scene config.
3. Add GLB export to bake edits into a distributable asset.
4. Connect phases, colliders, and forest masks to runtime scene behavior.
