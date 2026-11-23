# QA Report — Space Jump & Unified Camera Inspector v118

Date: 2026-11-23

## Changes
- Added manual skier jump on Space.
- Space is edge-triggered: repeat events while held are ignored.
- Manual jump requires confirmed terrain contact, grounded height / vertical velocity and an expired cooldown.
- Take-off impulse is 4.8 m/s; a 1.1 s shared cooldown prevents immediate chained jumps.
- Shift is the sole pole-push input; Space is no longer included in the push state.
- The skier HUD shows ПРЫЖОК while airborne.
- Drone Space ascent remains unchanged.
- Merged Camera, Lens & Optics into one Camera panel, preserving all existing settings and IDs.
- Removed the standalone Lens tab / panel. Scene Editor now has six categories.
- Updated the control guide, README and regression tests.

## Regression checks
- Six tab keys and six panel keys are checked.
- CI checks camera and lens / optics controls reside together in the Camera panel.
- CI checks Space handling, repeat suppression, transition lock, snow-contact checks, cooldown, Shift-only push and airborne HUD state.
- Existing syntax, project import, Maya and scene-manifest checks remain enabled.

## Not visually verified
- Jump height / feel on different slopes, landing response, and actual browser interaction still require a live browser / WebGL pass.
