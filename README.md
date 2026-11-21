# Grade Optimizer · Web 3D

Interactive 3D ski-slope visualizer with terrain optimization tools, skier simulation, drone flight mode, and a lightweight winter forest.

**Live site:** https://kortul.github.io/Grade_Optimizer/

## Active runtime

- `index.html` is the GitHub Pages entrypoint.
- `app.v77.js` is the active browser application.
- `skier-controller.v68.js` implements terrain-following skier physics and the first-person ski rig.
- `drone-controller.v68.js` implements keyboard flight, acceleration smoothing, and mouse-look.
- Three.js 0.160.0 is loaded through the import map in `index.html`. The site is static; there is no bundler or server runtime.

When making a new app release, create a new versioned `app.vNN.js` file and update the module script in `index.html`. Keep the previous version as a rollback point.

## Forest

The forest uses the OpenAI-generated transparent WebP atlas in `assets/trees/snowy_conifer_atlas.webp` (1632×1200, eight cutouts). Each cutout is copied into its own canvas texture before mipmaps are generated, preventing mip-level bleed between atlas cells. Each tree is one camera-facing instanced plane; crossed planes are intentionally not used because they caused z-fighting. Billboard matrices update only when the camera changes horizontal position.

## Controls

**Overview:** left mouse rotates, right mouse pans, mouse wheel zooms.

**Skier:** W / ↑ tuck, S / ↓ brake, A / D or ← / → steer, Shift / Space pole push. Mouse-look is available after clicking the scene.

**Drone:** W / S forward and back, A / D strafe, Space / Shift climb and descend, Ctrl boost, mouse-look. TAB switches between skier and drone; Q returns to overview.

## Quality checks

GitHub Actions runs `scripts/validate-project.mjs` on every push and pull request. The checks validate:

- Active entrypoint, local imports, JavaScript module syntax, unique HTML IDs, and every static DOM ID lookup.
- WebP container, dimensions, and alpha channel for the tree atlas.
- Single-plane forest safeguards and asynchronous slope-load guards.
- Every slope listed in `assets/slopes.json`, its glTF buffer files, buffer views, and centre/left/right profile curves.
- Scene manifest JSON.

Run locally with Node.js 22 or later:

```bash
node scripts/validate-project.mjs
```
