# CHECKPOINT 0.71

Date: 2026-11-21
Base: v0.70

## Changes
- Startup no longer displays the optimizer's blocking loading overlay for terrain-only loading.
- Skier and drone are now separate adjacent toolbar buttons.
- Preserved the near-final tree texture, with 3x canvas sampling/upscale, high-quality smoothing, and alpha depth-write disabled to reduce crossing billboard flicker.
- Optimization curve/label data remains lazy-loaded when the optimizer is explicitly opened.

## Files
- app.v71.js is active from index.html.
- app.v70.js remains available for rollback.

## Validation
- Browser visual testing remains pending.
