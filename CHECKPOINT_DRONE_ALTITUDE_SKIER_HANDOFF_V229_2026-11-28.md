# Checkpoint — Drone Altitude & Camera-to-Skier Handoff v229

Date: 2026-11-28

- Active entry: `index.html` → `app.v229.js?v=238`
- Drone controller: `drone-controller.v77.js`
- Skier controller: `skier-controller.v105.js`

## Changes

- Doubled the drone's upper vertical clearance from 100 m to 200 m above the terrain bounding-box maximum.
- Kept the existing horizontal terrain-bound margins unchanged.
- On Drone → Skier handoff, use the drone camera's horizontal yaw projected onto the slope plane as the skier's initial travel and ski direction.
- Preserve the existing initial handoff speed calculation and flat-apron yaw behavior.

## Validation

- Source-level checks performed on the active entry point and controller handoff path.
- Live browser/WebGL interaction has not been run in this environment.
