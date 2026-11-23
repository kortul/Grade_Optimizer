# Checkpoint — Optimizer Pointer-Lock Fix v122

Date: 2026-11-23

## Active release
- Entry point: `index.html` → `app.v122.js`
- Skier / drone controllers remain unchanged from v121.

## Behavior
When Slope Optimization opens:
- The application returns to Overview from Skier or Drone mode.
- Any pointer lock held by the renderer canvas is explicitly released.
- Skier and Drone controllers are stopped, clearing active input.
- OrbitControls and the optimizer panel receive ordinary mouse input without a lingering browser pointer-lock banner.

The optimizer loader and `rebuild()` workflow are unchanged.

## Verification
- CI checks entrypoint, JavaScript syntax, HTML IDs, optimizer pointer-lock release and prior project regressions.
- Live browser testing is not available in this run.
