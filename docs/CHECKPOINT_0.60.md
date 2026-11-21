# Checkpoint 0.60 — Resort Viewer / Maya scene pipeline

**Base:** `8813a781244a4e41e281b6a7ad860cfeb0aca743`

## Delivered

### First-person skis
- Two procedural ski meshes with bindings and top details.
- Visible only in SKIER mode; follow the skier's velocity and the local terrain plane.
- Positioned in the near field of the first-person view to keep the ski tips visible.
- Visual only: no effect on the point-mass physics or collision.

### Z-fighting
- Imported GLTF groups/nodes with `slope` in the name receive a negative material depth bias (`polygonOffsetFactor=-1`, `polygonOffsetUnits=-1`).
- This affects depth-buffer rasterization only; no world-space Y shift or collider movement.
- Helps with close/coplanar overlays, but does not repair intersecting surfaces.
- Long-term fix: remove/trim base-topography faces beneath engineered slope patches or generate one composite render/collision terrain.
- Per-asset `renderDepthBias` is part of the manifest contract for the future importer.

### Maya Manifest Helper MVP 0.1
- `maya/scripts/resort_manifest_export.py` adds editable `web_*` attributes to selected transforms and exports the metadata sidecar.
- Attributes: stable ID, category, phase, visible, collision, forest blocker, material profile, and depth bias.
- The helper exports metadata only; it does not batch-export GLB geometry yet. GLB export will be implemented after verifying the installed Maya GLTF exporter.

### Scene contract
- Added `scene-manifest.schema.json`, `scene-manifest.example.json`, and an empty starter `scene-manifest.json`.
- Coordinate convention: right-handed, Y-up, forward -Z; distances expressed in metres.
- Phases: `always`, `stage_1`, `stage_2`.
- Example includes the A1 forest exclusion mask with a 7.5 m buffer and a single unified collision terrain.

## Open the helper in Maya

Run this from Maya Script Editor (Python tab):

```python
exec(compile(open(r"<repo>/maya/scripts/resort_manifest_export.py", encoding="utf-8").read(),
             "resort_manifest_export.py", "exec"))
show_ui()
```

Select transforms (or a parent group), add metadata, edit `web_category`, `web_phase`, and other `web_*` attributes in Attribute Editor, then export the manifest. The default URI is `assets/resort/<web_id>.glb`; those paths are placeholders until matching GLB assets are exported.

## Remaining work
1. Browser manifest loader + cumulative Stage 1 / Stage 2 visibility.
2. Batch GLB export from Maya.
3. Forest mask export and tree scatter exclusion.
4. Scene Editor hierarchy and material/phase inspector.

`index.html` now loads `app.v60.js`; `app.v59.js` is kept intact as a rollback point.
