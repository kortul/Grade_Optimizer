# QA Report — Slope Analysis Layers v180

Date: 2026-11-25
Branch: `fix/slope-analysis-layer-controls`

## Source scene audit

Audited `clients/alpine-resort/scene.json` from the current main dataset (Git blob `54e4457d422d453da207b4d8c799222b8d7eb353`).

- Slope curve payload declares `units: meters`, `worldFrame: maya-working-world`, and `coordinateFrameVersion: 2`.
- 22 centre lines were found.
- Combined 3D polyline length: 11,729.102 m.
- The 22 curves contain 574 complete 20.0 m intervals.
- Every complete angle-label interval is exactly 20.0 m; the label chainages are 10, 30, 50, ... m from each curve start.
- All curves also have a final remainder between 0.265 m and 19.830 m. That remainder remains part of the colour-coded difficulty line, but it no longer creates an extra angle label with an irregular spacing.

## Viewer changes

- Replaced one-pixel `LineBasicMaterial` difficulty strokes with `Line2` / `LineMaterial` using a 5.5 CSS-pixel width.
- Angle labels are hidden when their 3D distance from the camera exceeds 100 m.
- Layer visibility uses delegated panel events and is persisted in localStorage.
- Added independent opacity sliders for angles, difficulty lines, and slope names. Each slider updates live and its value is persisted.
- Bumped the browser analysis cache key to `curve-analysis-v2`, forcing cached curve analyses to rebuild with the strict 20 m label rule.

## Static checks

- `index.html` references `app.v180.js`.
- All three opacity sliders and their value labels are present.
- The new module passed V8 syntax parsing after stripping ES-module import declarations.
- LineMaterial viewport resolution is refreshed when the viewer resizes.

Manual visual interaction in a live browser is still required to confirm appearance and pointer interaction on the deployed site.
