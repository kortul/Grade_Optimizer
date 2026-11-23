# QA Report — Optimizer Pointer-Lock Fix v122

Date: 2026-11-23

## Reported issue
A browser-level message requiring Escape repeatedly interrupted editing in Slope Optimization.

## Root cause
The Skier and Drone controllers use Pointer Lock for mouse-look. Opening Slope Optimization previously opened its panel without leaving those modes or releasing the canvas pointer lock. The browser could therefore keep the pointer captured and show its native Escape instruction.

## Fix
- Opening optimization switches the app back to Overview if Skier or Drone mode is active.
- Explicitly releases pointer lock on the renderer canvas.
- Stops both controllers and clears their movement state before exposing optimizer controls.
- Closing optimization does not unexpectedly enter another camera mode.
- Existing optimizer loading / rebuild flow is preserved.

## Regression checks
- Active v122 entrypoint, imports, syntax, unique DOM IDs and valid DOM references.
- Opening optimizer exits skier / drone mode.
- Pointer lock is released and both interactive controllers are stopped.
- Existing terrain optimizer and skier-mode handoff checks remain enabled.

## Verification boundary
GitHub Actions validates source and project structure. A live browser interaction test was not available in this run; the diagnosis is based on the app's Pointer Lock calls and missing cleanup in the optimizer-open path.
