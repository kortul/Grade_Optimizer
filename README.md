# Grade Optimizer · Web 3D

Interactive 3D ski-resort viewer with terrain optimization tools, terrain-following skier simulation, drone flight mode, and a winter forest.

**Live site:** https://kortul.github.io/Grade_Optimizer/

## Active runtime

- `index.html` loads the current versioned browser entrypoint.
- Current app: `app.v178.js` (asset-wide shared FBX materials; Maya Stage 1 exposes only the shared Slopes / Angled material pair).
- Weather: `weather-system.v7.js`; layered procedural clouds, directional horizon scattering, a color-varied star field, snowfall and wind streaks render through the scene weather layers.
- Camera optics: `camera-optics.v2.js` with GLSL regression checks and direct-render fallback.
- Scene Look is part of the Scene Editor and uses six category-card tabs: General, Environment, Camera, Color, Materials, and Render. Camera includes lens character and optical processing. Depth of field starts disabled.
- Skier: `skier-controller.v98.js`, with a 75 kg skier-equipment point-mass reference, mass-scaled pole / jump impulses, 3D ballistic take-off inheriting slope velocity and terrain-aware landing, grounded ski-snow friction, speed-limited edge force, calculated inside / outside ski loads, load-aware stance animation and first / third-person cameras. Third-person camera orbit is independent of physical skier / ski heading; switching from the drone starts the first-person view aligned with the skis. When an imported `Slopes_Stage1` asset is present, skier physics uses that group and selects the highest skiable point with downhill clearance, including when switching from drone. Skier-mode preparation is non-modal and keeps the current view interactive. Forest placement uses cached terrain vertices to avoid large synchronous raycast batches. Terrain contact queries use a 192×192 triangle lookup with a Raycaster fallback; live counters and timings are available through `window.__GRADE_OPTIMIZER_MODE_API.diagnostics().terrainPerformance`.
- Drone: `drone-controller.v76.js`.
- Three.js 0.160.0 is loaded through the import map. The site is static; there is no bundler or server runtime for the viewer. The optional public multiplayer relay lives in `server/` and uses one shared Cloudflare Durable Object. Imported client models support binary GLB and FBX files. FBX materials are consolidated by their source Maya shader name; the Stage 1 Maya export maps copied Slopes aliases and its technical OpenPBR fallback into two scene-wide material instances shared by all 22 mesh components. The Scene Editor Materials tab lists unique asset-wide materials, so editing Slopes or Angled changes every corresponding material group across the FBX.

For a new release, create new versioned app / controller files, update `index.html`, and keep the previous files for rollback.

## Slope analysis overlays

Maya exports only dense samples of central NURBS curve geometry in project-world metres to `slopeCurves` in the client `scene.json`; it does not calculate grades, difficulty, labels or colors. These raw points are the browser-side source for deriving 20 m section angles, the green / blue / red / black difficulty line and slope names. The browser-side calculation is separate from the Maya exporter. The three overlays have independent switches in the **Layers** panel and are hidden in skier and drone modes. The viewer uses Three.js line segments and CSS2D labels rather than mesh geometry. Maya reuses unchanged raw curve samples by geometry / transform fingerprint.

## Multiplayer

All visitors automatically join one public resort session when `multiplayer-config.v1.js` contains the deployed WebSocket URL. There are no rooms, invitations or accounts. Skier and drone physics remain local to each browser; player transforms and the skier's articulated pose are relayed at 30 Hz with stale WebSocket state frames dropped under backpressure. Each browser tab has a unique session identity, so reconnects replace the stale socket instead of appearing as a second skier. Each browser keeps its own camera and may switch modes independently. Shared flags are numbered 1–10 per participant and can be cleared locally with a server-authoritative update. Ruler placements retry after reconnect and are acknowledged by the relay. See [server/README.md](server/README.md) for one-time relay deployment.

## Modes and controls

The in-mode help cards explain the controls in Russian and are visible while skiing or flying.

- **Skier:** W / ↑ tuck, S / ↓ brake, A / D or arrows turn, Shift pole push, Space jump.
- **Drone:** W / S forward and backward, A / D strafe, Space up, Ctrl down, Shift boost up to 200 km/h.
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
4. To replace Stage 1, select the `Slopes_Stage1` branch (or an object inside it) in Maya. In the Maya tree choose `Slopes_Stage1` and use the replacement button. The exporter resolves the `Slopes_Stage1` DAG branch from the selected geometry and excludes sibling `Stage2_40M` / `Slopes_Stage2` branches, even if the initial Maya selection is broader. Every mesh inside the Stage 1 branch remains a separate FBX object; do not combine them.
5. Review the changed files in GitHub Desktop, then commit and push. Replacing the main terrain changes `assets/real-terrain.fbx` and `assets/real-terrain.json`; replacing Stage 1 changes the FBX and `clients/alpine-resort/scene.json`.

The canonical base Terrain currently uses exporter 0.8.7 metadata with `cadBridge.inverseApplied=false`: its FBX already contains the CAD working-world coordinates, so the browser leaves its vertices unchanged and converts Maya centimetres to metres. Stage 1 was re-exported with exporter 0.8.8 and `cadBridge.inverseApplied=true`: its FBX has the CAD Bridge wrapper removed before the world-space vertex bake. The browser restores that asset to the shared working-world frame using the saved `originalOffset` and `originalScale` before applying the same centimetre-to-metre conversion. This keeps Stage 1 aligned with the existing canonical Terrain without re-exporting or modifying Terrain. The correction applies only to source FBX files; GLB browser backups are already in the restored frame and are not transformed twice. **The original Maya objects are never moved, rescaled, frozen or deleted.** Hierarchy and individual mesh shapes remain separate, and material assignments are retained.

The exporter refuses a mixed base-terrain selection containing Stage / slope or unrelated mesh components. Select a dedicated terrain branch for the base terrain and a dedicated Stage 1 branch for the client asset. It also verifies the temporary FBX size before replacing either published file.

The base-terrain export is written to the canonical pair:

- `assets/real-terrain.fbx`
- `assets/real-terrain.json`

The JSON sidecar records the source scene, Maya version, units, bounds, components, materials and the CAD Bridge working-world metadata. The viewer uses `inverseApplied` to determine whether the exported FBX vertices need to be restored to the shared working-world frame. Keep the FBX below 90 MiB for the current regular-Git workflow.

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

A second isolated [WebGPU Atmosphere Lab](https://kortul.github.io/Grade_Optimizer/webgpu-atmosphere-lab.html) loads the canonical `assets/real-terrain.fbx` + `assets/real-terrain.json` pair. It prototypes `SkyMesh` atmospheric scattering and cloud layers, a shared Twinmotion-style rotating solar/day-night cycle with play/pause and full-day speed controls, adjustable direct sunlight, animated 3D-noise ground fog, exponential distance haze, depth reconstruction and depth-aware upsampling. The display exposure is matched across the two labs. A follow-up [WebGPU Alpine Forest Lab](https://kortul.github.io/Grade_Optimizer/webgpu-forest-lab.html) loads `Slopes_Stage1`, restores the saved CAD Bridge transform, frames the camera on the piste, and builds deterministic trees from the actual track boundaries. If the FBX is non-manifold or its boundary edges cannot supply enough placements, a deterministic terrain-projected forest belt fills around the piste while keeping a clear buffer from the ski surface. Terrain projection uses a cached triangle-height lookup; trees use near/mid spline-spruce geometry and far atlas billboards. It also includes a half-resolution screen-space god-ray pass with depth-aware upsampling. Both are isolated look-development testbeds; the production viewer remains on Three.js 0.160.0 / WebGL until visual parity, browser testing and device performance are verified.


### Ponlai rendering reference

The look-development workflow is informed by [Ponlai](https://github.com/HuberyLL/ponlai): keep scene materials physically based, and tune the image through shared lighting, atmosphere and display controls rather than hiding lighting errors in material albedo. The MIT render pipeline in Ponlai also demonstrates a deeper WebGPU architecture for atmospheric LUTs, volumetric clouds, GPU vegetation culling, GTAO and exposure. The current labs are **not a direct port** of those interdependent systems: they still use Three.js `SkyMesh`, the existing TSL fog/god-ray passes and the project's procedural spruce meshes. The full Ponlai frame graph depends on its own stage assembly and data formats, so transplanting isolated files would not reproduce its renderer. No Ponlai game, island or non-MIT creative content is copied into this repository.

Open the page through HTTPS (for example, the GitHub Pages preview for the feature branch) or localhost. The lab is intentionally not imported by `index.html`: the production app remains on Three.js 0.160.0 / WebGLRenderer while the WebGPU prototype is measured independently. This first prototype validates the modern renderer, TSL shader path, scene rendering and fallback without touching production materials, GLSL effects, loaders, or controls. It is GPU vertex animation, not yet a compute-shader simulation; GPU compute and a production integration require a separate measured follow-up.


## Sky and atmosphere v7

- Directional horizon scatter follows the sun azimuth and warms naturally around sunrise / sunset.
- The volumetric cloud field combines broad cloud masses, mid-scale structure, fine erosion and thin upper cirrus, with six vertical integration samples instead of eight.
- Night stars have subtle warm / cool color variation and twinkle in one point draw call.
- Snowfall motion is computed from static instance attributes in the vertex shader, removing the per-flake CPU matrix-update loop. Hidden volumetric clouds no longer receive per-frame camera / time uniform updates; scene matrices are left to the renderer's normal update pass.
- The previous `app.v154.js` and `weather-system.v6.js` remain in the repository for rollback.


## Public multiplayer ruler and flags

Overview double-click places a shared flag on the same visible geometry used by camera focus; the camera focus keeps its current distance. Each participant may keep three flags, with the new flag broadcast before older flags are removed. The Overview ruler broadcasts its selected point and completed measurement line / distance / angle to everyone in the shared session. Active measurements are included for new joiners and are cleared when the owner turns the ruler off or disconnects. These are relayed by the existing Cloudflare Worker; no separate service is required.
