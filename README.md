# Grade Optimizer · Web 3D

Interactive 3D ski-resort viewer with terrain optimization tools, terrain-following skier simulation, drone flight mode, and an OpenAI-generated winter forest.

**Live site:** https://kortul.github.io/Grade_Optimizer/

## Active runtime

- `index.html` loads the current versioned browser entrypoint.
- Current app: `app.v91.js`.
- Skier: `skier-controller.v73.js` (terrain-following physics and first-person ski rig).
- Drone: `drone-controller.v72.js` (keyboard flight, smooth acceleration and mouse-look).
- Three.js 0.160.0 is loaded through the import map. The site is static; there is no bundler or server runtime. Imported client models support binary GLB and FBX files.

For a new release, create a new `app.vNN.js` file, update `index.html`, and keep the previous app file for rollback.

## Modes and controls

The in-mode help cards explain the controls in Russian and are visible while skiing or flying.

- **Skier:** W / ↑ tuck, S / ↓ brake, A / D or arrows turn, Shift / Space push.
- **Drone:** W / S forward and backward, A / D strafe, Space / Shift change altitude, Ctrl boost.
- **Mouse:** click the scene to capture the mouse; move it to look around. Esc releases the cursor; click the scene to capture it again.
- **Switch skier ↔ drone:** V or Tab. The HUD also has a large clickable switch button.
- **Overview:** Q returns to the general scene view.

WASD controls use physical key codes, so they also work with a Russian keyboard layout.

## Forest

`assets/trees/snowy_conifer_atlas.webp` is an RGBA atlas with eight OpenAI-generated winter conifer cutouts. Each cell is copied into its own canvas texture before mipmaps are generated. Each tree uses one camera-facing instanced plane; crossed planes are avoided because they caused z-fighting.

## Quality checks

GitHub Actions runs `scripts/validate-project.mjs` on pushes and pull requests. It checks the active entrypoint, local imports, JavaScript syntax, HTML IDs and DOM references, the RGBA tree atlas, forest safeguards, slope GLTF buffers and profile curves, and the scene manifest.

Run locally with Node.js 22 or later:

```bash
node scripts/validate-project.mjs
```


## Maya client-scene export

Use `maya/grade_optimizer_exporter.py` from Maya's Python Script Editor:

1. Set the local path to your cloned `Grade_Optimizer` repository and enter the client slug.
2. Export the entire Maya scene (or the current selection) as one binary `FBX` with embedded media.
3. The exporter writes `clients/<slug>/models/resort.fbx` and a compatible `clients/<slug>/scene.json`.
4. Review the changed files in GitHub Desktop and Push. GitHub Pages serves the scene at `?client=<slug>`.

The FBX keeps its object hierarchy, mesh names and shared material assignments. The web material inspector lists slots as `mesh name · material name`, so a material can be edited per component without forcing a fixed object-category taxonomy. The default imported category is General model; Terrain and Slope remain optional special roles.

Keep the FBX below 90 MiB for the current regular-Git workflow. Use embedded textures so the client scene remains a self-contained model file.


## Scene Editor: shared project saving

For a client project, open the Project ID in **Client Workspace**, connect the GitHub Publisher, then press **SAVE ALL PROJECT CHANGES TO GITHUB**. This commits directly to the repository; no downloaded settings file has to be copied manually. The same client URL loads the committed scene and editor settings on another device after GitHub Pages deploys.

The shared `clients/<slug>/scene.json` includes imported model state and `editorSettings.assets` for the built-in scene: node transforms / visibility / metadata, PBR values, user-imported textures, and shared vs unique material slot identity. The JSON export button in the editor is only an optional backup.
