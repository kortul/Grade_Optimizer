# Checkpoint — Startup Initialization Fix v116

Date: 2026-11-23

## Release
- Base commit: 21d54e27f6ca2e4f4e7bd92549b6c482f3d74b35
- Active entrypoint: `index.html` → `app.v116.js`
- Weather system: `weather-system.v2.js`
- Skier controller: `skier-controller.v77.js`
- Rollback: `app.v115.js`

## Root cause
- `setTimeOfDay(state.dayTime)` runs during initial module evaluation and calls `updateDaylight()`.
- v115's `updateDaylight()` calls the hoisted `updateForestDaylight()` function.
- That function reads `treeLightingMaterials` and `forestEmissiveIntensity`, but their `let` declarations were located later in the module, after the initial call.
- This triggered a temporal-dead-zone `ReferenceError` before `loadSlope()` could start. The HTML scene-loading overlay therefore remained visible.

## Fix
- Moved both forest daylight state declarations immediately after the main app state, before any daylight evaluation.
- Kept the update function in place; function declarations are hoisted and can safely reference the now-initialized module state.
- Added a validator assertion that the state declarations precede the first `setTimeOfDay(state.dayTime)` call.

## Preserved
- Weather camera-follow rendering, snowfall improvements and mode-access fixes from v115.
- Dynamic daytime tree fill.
- Default 16:00, cloud weather control, skier v77, and all Scene Editor changes.

## Verification boundary
- Static initialization-order regression and the complete project quality suite are required to pass.
- Pages deployment is checked for this exact commit.
- Actual live browser startup is not claimed unless separately tested.
