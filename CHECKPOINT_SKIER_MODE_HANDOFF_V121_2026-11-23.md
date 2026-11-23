# Checkpoint — Grade Optimizer Skier Mode Recovery v121

Date: 2026-11-23

## Active release
- Entry point: `index.html` → `app.v121.js`
- Skier controller: `skier-controller.v82.js`
- Previous release retained: `app.v120.js` + `skier-controller.v81.js`

## Mode switching
- Overview → Skier starts directly with input enabled.
- Drone → Skier captures drone pose and velocity, searches nearby skiable terrain, and falls back to the validated main-piste spawn when the drone is over a gap, edge or flat apron.
- Drone momentum is projected along the downhill direction and clamped to a gentle 1.25–6 m/s initial speed.
- Removed the deferred-input camera transition and transition lock.
- Skier and drone controllers update immediately and continuously while their modes are active.
- Failed startup restores the previous mode and reports a diagnostic instead of leaving a half-switched scene.

## Spawn validation
- Preferred and fallback points need a usable grade and continuous downhill run-out.
- Drone-local search uses bounded concentric rings and checks actual raycast terrain.
- The 75 kg physics, ski-load estimation, 3D jump and landing logic remain unchanged.

## Checks
- Static validator covers entrypoint, imports, syntax, DOM references, transition-lock removal and terrain handoff.
- Actual live browser / WebGL interaction is not verified in this checkpoint.
