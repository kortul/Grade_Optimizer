# QA Report — 75 kg Skier Dynamics & Inspector Cleanup v119

Date: 2026-11-23

## Skier dynamics

- Reference mass: 75 kg for the skier and equipment as one moving system.
- Pole stroke: 60 N·s, giving approximately 0.8 m/s velocity change at 75 kg.
- Manual Space jump: 195 N·s, giving 2.6 m/s take-off speed, about 0.34 m ballistic apex and 0.53 s flight on level terrain.
- Terrain-crest hop: separate 202.5 N·s impulse, giving 2.7 m/s at 75 kg.
- During flight only aerodynamic drag remains. Ski friction, pole impulses and ski-edge turning are disabled until contact returns.
- Flight height is integrated in world space and tested against the actual next terrain hit. Rising terrain can catch the skier; landing is not based on a fixed timer.
- Ground friction is calculated as a force in Newtons and divided by mass to obtain acceleration.
- Normal support force is estimated from mass and the local terrain-normal component of gravity. Lateral edge force is speed-dependent and limited to 1.25 times that normal force.
- The combined ski reaction is estimated from the normal and lateral force components. The load split moves from 50/50 to a maximum modeled 60/40 toward the outside ski.
- Avatar stance and ski-flex animation now respond to lateral acceleration and the calculated outside-ski share. Landing compression is driven by impact speed.

## Inspector cleanup

- Removed the dedicated “ЗАМЕНА ЛЫЖ ЛЫЖНИКА” section and its GLB upload / reset controls.
- Removed skier-only GLB upload, IndexedDB save / restore and reset event handlers.
- Standard built-in skis remain.
- General Scene Editor model import and local backups of scene assets remain active; the shared IndexedDB helper was renamed to reflect its actual use.

## What the ski-load readout means

The HUD displays estimated ski load in Newtons and the outside / inside percentage split. This is a force estimate, not surface pressure in Pa: a pressure map would need the ski's real contact area, bending, edge penetration and snow deformation data.

## Model boundary

This is a real-time point-mass / effective-edge approximation, not a validated full-body biomechanics or deformable-ski solver. The 60/40 load-transfer ceiling and 1.25g edge limit are simulation assumptions, not universal measured values for every turn.

## Regression checks

- Active entrypoint and all local imports.
- JavaScript syntax, HTML IDs and static DOM references.
- 75 kg reference mass, impulse-to-velocity conversion, jump apex, normal and lateral ski forces, outside-ski load share.
- Airborne contact-force separation and terrain-aware landing.
- Removed skier ski-replacement UI and handlers; retained shared Scene Editor asset storage.
- Existing weather, camera, forest, terrain, Maya and project-manifest checks.

## Not visually verified

No live browser / WebGL play-test was run. Jump timing, edge response, landing feel and the skier's visual pose still need live interaction testing.
