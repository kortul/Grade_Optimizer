# Safety Fences v213 — cache and responsive generation

Date: 2026-11-27

## Changes
- Safety fences are enabled by default and start building automatically after the first rendered frame.
- Pilot placement is limited to the first three visible imported slope assets and up to the three longest connected boundary contours found in that selection.
- Per-asset fence boundaries are collected during the existing piste-footprint geometry pass, avoiding a second full mesh traversal.
- Placement analysis yields back to the browser every 12 candidate panels.
- Results are cached in IndexedDB, keyed by slope mesh geometry/transform signatures and active terrain geometry/transform signature.
- Reopening the project, changing weather, or rebuilding trees reuses cached placements; geometry changes generate a new cache key.
- Added async unit tests for steep terrain, flat-terrain rejection, periodic yielding, and invalid inputs.

## Edge curves
- Current model import supports GLB/FBX only; Maya curve entities are not consumed as fence guides yet.
- Recommended future input is compact JSON containing ordered world-space XYZ polyline points. This avoids mesh-boundary detection and can place safety nets directly along artist-authored borders.

## Validation
- CI syntax, project checks and dedicated fence tests.
- Browser visual/FPS verification remains necessary.
