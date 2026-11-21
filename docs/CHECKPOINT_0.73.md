# CHECKPOINT 0.73 — Regression recovery

Date: 2026-11-21
Base: v0.70 (known-good tree texture and controller baseline)

## Fixes
- Restored tree texture/render branch from v0.70. Avoid the broken v0.71/v0.72 canvas resize code.
- Preserved v0.70 skier and drone controllers and their movement logic.
- Added separate adjacent toolbar buttons for Skier and Drone, each entering its own mode.
- Removed the blocking optimization loading overlay from normal terrain loading. Optimizer loading overlay remains tied to explicit optimizer actions.

## Validation
- Static review only. Browser/WebGL visual test is still required.
