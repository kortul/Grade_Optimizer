# Checkpoint — Skier Visibility, Turn Angulation & Weather UI v113

Date: 2026-11-23

## Release
- Base commit: 27bb9b0d9325e8bf4b3264964917bc24b0ab9061
- Active entrypoint: `index.html` → `app.v113.js`
- Active skier controller: `skier-controller.v77.js`
- Rollback: `app.v112.js` + `skier-controller.v76.js`

## Changes
- Default scene time is now 16:00 in runtime state, compact clock, expanded clock and slider.
- Skier materials stay transparent only during the brief first-/third-person fade. At full visibility they switch to opaque rendering with depth writes enabled, preventing overlapping equipment and body parts from sorting through each other as the camera moves away.
- Avatar meshes retain disabled individual frustum culling.
- Both legs now share signed hip and knee angulation toward the turn direction; the inner/outer leg difference remains subtle and both left and right turns use the same directional response.
- Weather control is now a compact cloud SVG icon immediately before the Scene Editor gear.

## Scope / compatibility
- Ski movement physics, speed, braking, turn forces and terrain interaction were not changed.
- App v112 and skier controller v76 remain available for rollback.
- Weather settings and Scene Editor storage behavior are unchanged.

## Verification boundary
- Static regression checks cover the 16:00 default, button order/icon, depth-safe opaque material state, disabled avatar frustum culling and bilateral knee angulation.
- CI / Pages deployment status is reported separately in the release response.
- A live browser/WebGL visual inspection is not claimed unless explicitly completed.
