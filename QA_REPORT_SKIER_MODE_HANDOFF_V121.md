# QA Report — Skier Mode Handoff Recovery v121

Date: 2026-11-23

## Reported regressions addressed

- Overview → Skier could fail when the preferred or fallback spawn landed on an unusable patch.
- Drone → Skier could fail when the drone hovered above a mesh gap, edge or flat apron.
- A deferred camera-transition state could temporarily block both controller updates and further mode changes.

## Fixes

- Mode switching is immediate; there is no deferred-input window or stale transition lock.
- Both controller updates run on every frame when their mode is active.
- Drone handoff searches nearby rings for real skiable terrain with a continuous downhill run-out.
- If the drone is over a gap, apron or unusable patch, startup falls back to the validated piste spawn.
- Drone velocity is projected onto the downhill direction and transferred as a gentle capped starting speed (1.25–6 m/s).
- Overview spawn candidates now require an adequate slope and downhill continuity. The grid fallback no longer selects arbitrary flat or boundary points.
- Failed startup restores the previous mode and displays a diagnostic hint.

## Preserved

- 75 kg skier physics and force calculations.
- 3D jump and terrain landing model.
- Outside / inside ski load estimation.
- Existing avatar, camera-view and Scene Editor behavior.
- General GLB / FBX scene import.

## Regression checks

- Entrypoint, local imports, JavaScript syntax, HTML IDs and DOM references.
- No stale mode-transition lock.
- Drone-to-skier handoff, safe-start validation, fallback spawn and momentum transfer.
- Existing skier dynamics, jump and avatar QA assertions.

## Verification boundary

GitHub Actions source / structural checks and Pages deployment are run for this commit. A live browser / WebGL play-test was not available here; pointer-lock and on-slope behavior still require a quick manual confirmation.
