# Grade Optimizer · Web 3D

Interactive 3D ski-resort viewer with terrain optimization tools, terrain-following skier simulation, drone flight mode, and a winter forest.

**Live site:** https://kortul.github.io/Grade_Optimizer/

## Active runtime

- `index.html` loads the current versioned browser entrypoint.
- Current app: `app.v107.js`.
- Camera optics: `camera-optics.v2.js` with GLSL regression checks and direct-render fallback.
- Scene Look uses tabbed inspector pages: Environment, Camera, Lens, Color and Render.
- Skier: `skier-controller.v73.js`.
- Drone: `drone-controller.v72.js`.
- Three.js 0.160.0 is loaded through the import map. The site is static; there is no bundler or server runtime. Imported client models support binary GLB and FBX files.

For a new release, create a new `app.vNN.js` file, update `index.html`, and keep the previous app file for rollback.

## Modes and controls

The in-mode help cards explain the controls in Russian and are visible while skiing or flying.

- **Skier:** W / ↑ tuck, S / ↓ brake, A / D or arrows turn, Shift / Space push.
- **Drone:** W / S forward and backward, A / D strafe, Space / Shift change altitude, Ctrl boost.
- **Mouse:** click the scene to capture the mouse; move it to look around. Esc releases the cursor; click the scene to capture it again.
- **Switch skier ↔ drone:** V. The HUD also has a clickable switch button.
- **Overview:** Q returns to the general scene view.

WASD controls use physical key codes, so they also work with a Russian keyboard layout.

## Forest

`assets/trees/snowy_conifer_atlas.webp` is an RGBA atlas with winter conifer cutouts. Each tree uses one camera-facing instanced plane; crossed planes are avoided because they caused z-fighting.

## Quality checks

GitHub Actions runs `scripts/validate-project.mjs` on pushes and pull requests. It checks the active entrypoint, local imports, JavaScript syntax, HTML IDs and DOM references, Scene Look tab panels / keyboard behavior / gear icon, camera-optics GLSL declarations and render fallback, the tree atlas, forest safeguards, slope GLTF buffers and profile curves, the scene manifest, Maya exporter and project-save wiring.

Run locally with Node.js 22 or later:

```bash
node scripts/validate-project.mjs
```

## Maya project-scene export

Use `maya/grade_optimizer_exporter.py` from Maya's Python Script Editor. Its default Project ID is `alpine-resort`, matching the Web Editor's primary project.

1. Export the entire Maya scene (or the current selection) as one binary FBX with embedded media.
2. The exporter writes `clients/<project-id>/models/resort.fbx` and `clients/<project-id>/scene.json` into the local Git working copy.
3. Push those Maya-exported files to the repository with GitHub Desktop.
4. Open the site. The primary `alpine-resort` project loads automatically; another project can be opened with `?project=<project-id>`.

The FBX keeps object hierarchy, mesh names and shared material assignments. The Web Editor material inspector lists slots as `mesh name · material name`; Terrain and Slope remain optional special roles.

Keep the FBX below 90 MiB for the current regular-Git workflow. Use embedded textures so the project remains self-contained.

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
