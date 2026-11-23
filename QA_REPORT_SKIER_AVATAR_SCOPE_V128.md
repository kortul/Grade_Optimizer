# QA Report — Skier Avatar Ski Flex Scope Fix v128

Date: 2026-11-23

## Runtime failure
The browser reported `ReferenceError: outsideLoad is not defined` from `SkierController._updateSkierAvatar()` while updating ski flex. The variable existed only inside the preceding skier-leg / arm callbacks, but the ski-slot callback referenced it outside those scopes.

## Fix
- Compute each ski's outside-load contribution inside its own ski-slot callback, using that ski's side, smoothed turn direction, carve weight and outside-load shift.
- Keeps ski flex synchronized with the same outside-ski pressure model used by the skier's legs.
- No fallback value hides the error; the variable is now locally defined for each ski.

## Verification
- Project CI checks syntax, runtime wiring and a regression assertion for the ski-slot load calculation.
- Pages deployment is verified independently.
- Live skier-mode runtime should be tested in the browser after hard refresh.
