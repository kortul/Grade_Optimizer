# Checkpoint — Skier Mode Reliability Fix v123

Date: 2026-11-23

## Active release
- Entry point: `index.html` → `app.v123.js`
- Skier controller: `skier-controller.v83.js`
- Drone controller: `drone-controller.v73.js`

## Behavior
- Skier start search has a denser last-resort terrain scan.
- Pointer Lock denial no longer aborts either physical-mode startup.
- Skier mode requests received while terrain is loading are resumed after loading.
- Failed start diagnostics include the controller error code.

## Verification
- Project CI validates the new source paths and fallback assertions.
- Live browser/WebGL interaction remains unverified in this run.
