# QA Report — Startup Initialization Fix v116

## Root cause and repair
- v115 had a lexical initialization-order error: the first `setTimeOfDay(state.dayTime)` called `updateDaylight()`, which accessed forest lighting `let` bindings declared much later in the same module.
- Moved `treeLightingMaterials` and `forestEmissiveIntensity` above all initial daylight calls.
- Kept the hoisted `updateForestDaylight()` function, which can now read initialized bindings.

## Regression coverage
- Active app must be v116.
- Forest daylight update function remains connected to `updateDaylight()`.
- Forest lighting state declarations must precede the initial `setTimeOfDay(state.dayTime)` call.
- Existing weather v2 scene-root, snow, presets, mode access and all other project checks remain.

## Not verified by static checks
- Startup in an actual Chrome/WebGL browser.
- Real visual appearance after successful loading.
