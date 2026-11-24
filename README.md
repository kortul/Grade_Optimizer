# Grade Optimizer · Web 3D

Interactive 3D ski-resort viewer with terrain optimization tools, terrain-following skier simulation, drone flight mode, and a winter forest.

**Live site:** https://kortul.github.io/Grade_Optimizer/

## Active runtime

- `index.html` loads the current versioned browser entrypoint.
- Current app: `app.v155.js`.
- Weather: `weather-system.v7.js`; layered procedural clouds, directional horizon scattering, a color-varied star field, snowfall and wind streaks render through the scene weather layers.
- Camera optics: `camera-optics.v2.js` with GLSL regression checks and direct-render fallback.
- Scene Look is part of the Scene Editor and uses six category-card tabs: General, Environment, Camera, Color, Materials, and Render. Camera includes lens character and optical processing. Depth of field starts disabled.
- Skier: `skier-controller.v94.js`, with a 75 kg skier-equipment point-mass reference, mass-scaled pole / jump impulses, 3D ballistic take-off inheriting slope velocity and terrain-aware landing, grounded ski-snow friction, speed-limited edge force, calculated inside / outside ski loads, load-aware stance animation and first / third-person cameras. Third-person camera orbit is independent of physical skier / ski heading; switching from the drone starts the first-person view aligned with the skis. When an imported `Slopes_Stage1` asset is present, skier physics uses that group and selects the highest skiable point with downhill clearance, including when switching from drone. Skier-mode preparation is non-modal and keeps the current view interactive. Forest placement uses cached terrain vertices to avoid large synchronous raycast batches. Terrain contact queries use a 192×192 triangle lookup with a Raycaster fallback; live counters and timings are available through `window.__GRADE_OPTIMIZER_MODE_API.diagnostics().terrainPerformance`.
- Drone: `drone-controller.v75.js`.
- Three.js 0.160.0 is loaded through the import map. The site is static; there is no bundler or server runtime. Imported client models support binary GLB and FBX files.

For a new release, create new versioned app / controller files, update `index.html`, and keep the previous files for rollback.

## Modes and controls

The in-mode help cards explain the controls in Russian and are visible while skiing or flying.

- **Skier:** W / ↑ tuck, S / ↓ brake, A / D or arrows turn, Shift pole push, Space jump.
- **Drone:** W / S forward and backward, A / D strafe, Space / Shift change altitude, Ctrl boost.
- **Mouse:** click the scene to capture the mouse; move it to look around. Esc releases the cursor; click the scene to capture it again.
- **Switch skier ↔ drone:** V. The HUD also has a clickable switch button.
- **Overview:** Q returns to the general scene view.

WASD controls use physical key codes, so they also work with a Russian keyboard layout.

## Forest

`assets/trees/snowy_conifer_atlas.webp` is an RGBA atlas with winter conifer cutouts. Each tree uses one camera-facing instanced plane; the atlas billboards use a texture-matched emissive fill linked to daylight, keeping trees readable before sunset while fading naturally at dusk and night. Crossed planes are avoided because they caused z-fighting.

## Quality checks

GitHub Actions runs `scripts/validate-project.mjs` on pushes and pull requests. It checks the active entrypoint, local imports, JavaScript syntax, HTML IDs and DOM references, Scene Look tab panels / keyboard behavior / gear icon, 75 kg skier force / impulse calculations and load transfer, terrain-aware jump landing, skier equipment and articulated animation, camera-optics GLSL declarations and render fallback, the tree atlas, forest safeguards, slope GLTF buffers and profile curves, the scene manifest, Maya exporter and project-save wiring.

Run locally with Node.js 22 or later:

```bash
node scripts/validate-project.mjs
```

## Maya terrain export

Use `maya/grade_optimizer_exporter.py` from Maya's Python Script Editor, or open it from the Grade Optimizer Maya plug-in.

1. In GitHub Desktop, pull the latest repository before opening the exporter. The Maya tree reads the local clone.
2. The replacement tree contains both client-scene FBXs and a separate **Основной рельеф** entry for the canonical global asset.
3. To replace the main terrain, select only the `terrainShape` mesh / its dedicated group inside the CAD-synchronized Maya working scene. Do not select the whole `MAYA_WORKING_SCENE` if it also contains Stage 1 or other geometry. In the Maya tree choose **Основной рельеф** (`real-terrain`) and click **ЗАМЕНИТЬ ВЫБРАННЫЙ ОБЪЕКТ**.
4. To replace Stage 1, select only the `Slopes_Stage1` branch inside `MAYA_WORKING_SCENE`. Its intentional multi-mesh / mixed component hierarchy is exported as separate mesh objects; do not combine it. In the Maya tree choose `Slopes_Stage1` and use the same replacement button.
5. Review the changed files in GitHub Desktop, then commit and push. Replacing the main terrain changes `assets/real-terrain.fbx` and `assets/real-terrain.json`; replacing Stage 1 changes the FBX and `clients/alpine-resort/scene.json`.

For selections inside a `MAYA_WORKING_SCENE` created by CAD Bridge v14, the exporter reads `bridgeOriginalOffset` and `bridgeOriginalScale`. It creates temporary copies, reverses the exact relationship `working_world = scale * (original_maya - offset)`, then bakes the resulting world-space vertices into identity transforms. For Stage 1 it also performs the `ToSketchfab` position / nested scale normalization that the earlier web loader needed. **The original Maya objects are never moved, rescaled, frozen or deleted.** Hierarchy and individual mesh shapes remain separate, and material assignments are retained.

The exporter refuses a mixed base-terrain selection containing Stage / slope or unrelated mesh components. Select a dedicated terrain branch for the base terrain and a dedicated Stage 1 branch for the client asset. It also verifies the temporary FBX size before replacing either published file.

The base-terrain export is written to the canonical pair:

- `assets/real-terrain.fbx`
- `assets/real-terrain.json`

The JSON sidecar records the source scene, Maya version, units, bounds, components, materials and the CAD Bridge inverse used. Keep the FBX below 90 MiB for the current regular-Git workflow.

**Runtime:** for the primary A1 slot, the app prefers `assets/real-terrain.fbx` + `assets/real-terrain.json`, resolves the terrain mesh by its manifest name, converts Maya source units to metres and applies snow materials. If either canonical file is missing or invalid, it falls back to the original `assets/A1.gltf`. The A1 optimizer profiles remain loaded from `A1.curves.json`.

## Scene Editor: browser autosave and direct local repository sync

You are the only Scene Editor administrator. Viewers only need the generated viewer link; no client accounts or editing workflow are required.

- The primary Project ID is `alpine-resort` and opens automatically. The Maya Exporter uses the same default.
- Scene Editor changes are automatically backed up in this browser's IndexedDB. This includes built-in scene settings, transforms, visibility, Role / Tags, Collision / Forest blocker, PBR values, custom textures, imported model binaries, and per-node settings.
- In Chrome or Edge, select the local Git repository root once with **CONNECT LOCAL PROJECT FOLDER**. The folder handle is stored in IndexedDB. After write access is granted, project autosave writes changed model files and `clients/<project-id>/scene.json` directly into that folder.
- The chosen folder must be the local `Grade_Optimizer` repository root (the folder containing `index.html`, `README.md`, and `maya/`). GitHub Desktop then detects the changed files; commit and push as usual.
- On subsequent browser launches Chrome may ask for renewed permission to the stored folder. Click **CONNECT LOCAL PROJECT FOLDER** to re-authorize the saved handle; you normally do not need to browse for the folder again.
- Browser IndexedDB remains a fallback backup. It is local to that browser and can be lost if site data is cleared; it is not cross-device sync.
- The runtime needs `scene.json` plus separate binary GLB model files under `clients/<project-id>/models/`. The app writes them automatically; you do not manage them manually.
- Keep individual model files below 90 MiB for the current regular-Git workflow. Larger assets require Git LFS or another storage strategy.

## WebGPU prototype (isolated)

An experimental snow-rendering lab is available at [webgpu-snow-lab.html](https://kortul.github.io/Grade_Optimizer/webgpu-snow-lab.html) on the published site. It uses a separately pinned Three.js r187 WebGPU build and TSL-driven vertex animation for a configurable 10k–100k particle field. `WebGPURenderer` selects its WebGPU backend when available and otherwise uses its WebGL 2 fallback.

Open the page through HTTPS (for example, the GitHub Pages preview for the feature branch) or localhost. The lab is intentionally not imported by `index.html`: the production app remains on Three.js 0.160.0 / WebGLRenderer while the WebGPU prototype is measured independently. This first prototype validates the modern renderer, TSL shader path, scene rendering and fallback without touching production materials, GLSL effects, loaders, or controls. It is GPU vertex animation, not yet a compute-shader simulation; GPU compute and a production integration require a separate measured follow-up.


## Sky and atmosphere v7

- Directional horizon scatter follows the sun azimuth and warms naturally around sunrise / sunset.
- The volumetric cloud field combines broad cloud masses, mid-scale structure, fine erosion and thin upper cirrus, with six vertical integration samples instead of eight.
- Night stars have subtle warm / cool color variation and twinkle in one point draw call.
- Snowfall motion is computed from static instance attributes in the vertex shader, removing the per-flake CPU matrix-update loop. Hidden volumetric clouds no longer receive per-frame camera / time uniform updates; scene matrices are left to the renderer's normal update pass.
- The previous `app.v154.js` and `weather-system.v6.js` remain in the repository for rollback.
