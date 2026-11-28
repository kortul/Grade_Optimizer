# CHECKPOINT — Overview to Skier Camera Transition v232

Date: 2026-11-28

## Change
- Added the Overview -> Skier switch to the existing camera handoff transition.
- The transition starts from the camera's current Overview position and orientation, then uses the existing eased position interpolation and quaternion slerp toward the live skier camera.
- Existing Drone -> Skier and Skier <-> Drone transitions remain unchanged.
- Overview -> Drone behavior is intentionally unchanged.

## Files
- `app.v232.js` — new immutable app version based on v231.
- `index.html` — active entry updated to `./app.v232.js?v=241`.

## Validation
- Verified the handoff condition exists exactly once in app.v232.js.
- Verified the active index entry points to app.v232.js?v=241.
- Source-level validation only; no live browser/WebGL interaction test was run.
