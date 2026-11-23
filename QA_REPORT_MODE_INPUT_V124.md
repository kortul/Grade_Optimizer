# QA Report — Mode Input Reliability Fix v124

Date: 2026-11-23

## Reported issue
Neither the Skier button nor V produced a visible mode change.

## Changes
- Mode button clicks are handled by an early document-level delegated listener.
- V is now a global mode shortcut: Overview → Skier, Skier → Drone, Drone → Skier.
- Removed late duplicate V handling and legacy button listeners.
- Repeated selection of the current mode can repair an inactive controller rather than returning silently.
- Terrain lookup falls back to the first renderable mesh when the GLTF node is not named "terrain".
- Loading visibility is checked using actual rendered geometry, not only the inline style value.
- Startup failures are shown in a visible on-screen status notice.
- Last-resort skier scan accepts very shallow surfaces as a final fallback.

## Verification
- CI checks the early delegated input routing, all-mode V shortcut, mesh fallback, visible errors, JavaScript syntax and project invariants.
- Live WebGL input validation was not available in this run.
