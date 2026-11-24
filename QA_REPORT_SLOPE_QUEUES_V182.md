# QA Report — Slope Queues and Angle Distance v182

Date: 2026-11-25
Branch: `feat/slope-analysis-queues-and-angle-distance`

## Changes
- Default angle-label cutoff is 500 m; a live 0–500 m slider in the Slope Layers panel controls it and persists the value.
- Darken green slope color in line geometry, labels, and layer symbol.
- Default slope-name opacity is 65%. Legacy v1 settings migrate to v2; prior visibility and other opacity values are preserved, but the previous 100% default for names is overridden to 65%.
- Add Scene Editor tab `Слои` with folders `Очередь 1` and `Очередь 2`.
- Move current angle, difficulty, and name layer groups under real Three.js group `SlopeAnalysis_Queue_1`. Queue 1 has folder-wide and individual layer visibility controls.
- Add an empty `SlopeAnalysis_Queue_2` group and reserved folder for future curves.
- Overview queue switching is deferred until Queue 2 contains curves, as requested.
- Preserve `app.v181.js`; the page now loads `app.v182.js`.

## Validation
- V8 syntax parse passed after removing static ES-module import declarations.
- Static checks passed for distance slider and persistence, green palette, 65% default, tab/folders, real Three.js grouping, and queue checkbox wiring.
- `clients/alpine-resort/scene.json` was not modified.
- Live browser visual testing remains required after deployment.
