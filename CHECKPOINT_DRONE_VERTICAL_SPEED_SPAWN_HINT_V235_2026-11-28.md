# Grade Optimizer checkpoint — v235
Date: 2026-11-28

## Changes
- Drone vertical movement is now 2x faster for both climb (Space / mobile UP) and descent (Ctrl / mobile DOWN).
- Horizontal flight speed, mobile horizontal speed reduction, and boost speed behavior remain otherwise unchanged. Vertical input is applied independently so it is not diluted by vector normalization.
- Skier tutorial spawn shortcut tile now displays `1 / 2 / 3 / 4` with the instruction `Переместиться к другой стартовой вершине`.

## Files
- `drone-controller.v79.js`
- `app.v235.js`
- `index.html`

## Verification
- Source checks confirm the vertical input multiplier is 2, the app imports drone controller v79, and both index module references point to `app.v235.js?v=244`.
- Source checks confirm the old slot-1-only tutorial label is gone and the new 1–4 instruction is present.
- No live browser / flight test was run in this environment.
