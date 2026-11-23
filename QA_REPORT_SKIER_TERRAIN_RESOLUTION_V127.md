# QA Report — Resolve Terrain Before Skier Guard v127

Date: 2026-11-23

## Confirmed failure path
The v126 transition checked `state.terrain` / `state.baseTerrain` and returned before reaching the later mesh fallback over `state.root`. The API then emitted the generic `overview:NO_MODE_CHANGE` status.

## Changes
- Added `resolveSkierTerrain()` and call it before the early Skier-mode guard.
- It validates the existing terrain reference, searches named terrain meshes in the loaded GLTF root, then searches other renderable meshes, then checks the active imported terrain.
- The same resolver is used inside the transition and when a Skier request queued during loading is resumed.
- Controller exceptions now set `START_EXCEPTION` and preserve stack diagnostics.
- API failures now report whether the scene root or terrain mesh could not be resolved, instead of `NO_MODE_CHANGE`.

## Verification
- CI validates module syntax, terrain resolution before the early guard, queued-request resolution, error propagation and all existing project checks.
- Pages build/deploy are checked separately.
- Actual ski physics and camera behavior still require live browser testing.
