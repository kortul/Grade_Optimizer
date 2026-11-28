# Grade Optimizer checkpoint — v234
Date: 2026-11-28

## Changes
- Keyboard spawns 1–4 now switch the skier camera to third-person after a successful spawn, including the Stage 1 summit fallback for key 1.
- Skier tutorial now has a dedicated step and a separate control tile for `C` (first-person / third-person camera toggle). Mouse remains only for looking around.
- Mobile movement stick has a larger activation deadzone with hysteresis to avoid accidental steering.
- Mobile camera stick has an 18% deadzone and a quadratic response curve. Camera rotation rates are reduced for skier and drone modes.
- Mobile skier steering is reduced to 68% with a slower response; mobile drone cruise speed is reduced to 72%. Keyboard controls and the drone boost speed remain unchanged.
- Mobile UI labels and accessibility labels are translated into Russian.

## Files
- `app.v234.js`
- `skier-controller.v106.js`
- `drone-controller.v78.js`
- `index.html`

## Verification
- Source-level checks confirmed all expected replacements, the controller import paths, separate `C` tutorial entries, Russian mobile controls, and the active app reference `app.v234.js?v=243` in both index script references.
- No live browser / mobile-device test was run in this environment.
