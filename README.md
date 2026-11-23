# Grade Optimizer · Web 3D

Interactive 3D ski-resort viewer with terrain optimization tools, terrain-following skier simulation, drone flight mode, and a winter forest.

**Live site:** https://kortul.github.io/Grade_Optimizer/

## Active runtime

- `index.html` loads the current versioned browser entrypoint.
- Current app: `app.v154.js`.
- Weather: `weather-system.v2.js`; snowfall and wind streaks render through a scene-root camera-follow layer, with visible snow density and persistent controls in skier / drone modes.
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

1. In Maya, select the root transform/group of the terrain, or select the terrain mesh objects directly. Only the selection and its descendant meshes are exported; the rest of the Maya scene is never included.
2. In the exporter, choose the local `Grade_Optimizer` repository root (the folder containing `index.html` and `assets/`).
3. The exporter writes the canonical project files:
   - `assets/real-terrain.fbx`
   - `assets/real-terrain.json`
4. Open GitHub Desktop, review the two changed files, then commit and push. The Maya exporter does not create commits or push by itself.

The runtime converts Maya centimetres to metres without changing the source world origin or physical proportions. Camera zoom, fog and directional shadow bounds adapt to the imported terrain dimensions; the geometry is not normalized to the old A1 test slope.

The FBX preserves hierarchy, transforms, mesh names, smoothing, tangents, material assignments and embedded textures. The JSON sidecar records the source scene, Maya version, linear unit, world bounds, component names, material names and Role / Tags metadata. Collision and Forest blocker remain Web Editor settings.

The exporter removes the old Project ID / `clients/<id>` requirement. There is one fixed destination for the main terrain. Keep the FBX below 90 MiB for the current regular-Git workflow.

**Runtime:** for the primary A1 slot, the app now prefers `assets/real-terrain.fbx` + `assets/real-terrain.json`, resolves the mesh by its manifest name (`terrainShape`), converts Maya source units to metres and applies snow materials. If either canonical file is missing or invalid, it falls back to the original `assets/A1.gltf`. The A1 optimizer profiles remain loaded from `A1.curves.json`.
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

An experimental snow-rendering lab is available at `webgpu-snow-lab.html` on the `feature/webgpu-snow-lab` branch. It uses a separately pinned Three.js r187 WebGPU build and TSL-driven vertex animation for a configurable 10k–100k particle field. `WebGPURenderer` selects its WebGPU backend when available and otherwise uses its WebGL 2 fallback.

Open the page through HTTPS (for example, the GitHub Pages preview for the feature branch) or localhost. The lab is intentionally not imported by `index.html`: the production app remains on Three.js 0.160.0 / WebGLRenderer. This first prototype validates the modern renderer, TSL shader path, scene rendering and fallback without touching production materials, GLSL effects, loaders, or controls. It is GPU vertex animation, not yet a compute-shader simulation; GPU compute and a production integration require a separate measured follow-up.
