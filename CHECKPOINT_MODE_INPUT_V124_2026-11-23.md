# Checkpoint — Mode Input Reliability Fix v124

Date: 2026-11-23

## Active release
- Entry point: `index.html` → `app.v124.js`
- Skier controller: `skier-controller.v84.js`
- Drone controller: `drone-controller.v74.js`

## Behavior
- Skier / Drone buttons use an early delegated click handler.
- V works from Overview and toggles between Skier / Drone.
- Repeated mode requests retry inactive controllers.
- Terrain lookup includes a renderable-mesh fallback.
- Startup failures show an on-screen status notice.

## Verification
- Project CI and Pages deployment are required before confirming publication.
- Real browser / WebGL interactions remain unverified.
