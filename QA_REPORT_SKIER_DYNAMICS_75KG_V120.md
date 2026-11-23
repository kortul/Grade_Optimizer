# QA Report — 75 kg Skier Dynamics & True 3D Jump v120

Date: 2026-11-23

## Skier dynamics

- Reference mass: 75 kg for skier and equipment as one moving system.
- Pole stroke: 60 N·s, approximately 0.8 m/s velocity change at 75 kg.
- Manual Space jump: 195 N·s (2.6 m/s added vertical speed at 75 kg), about 0.34 m relative-to-slope apex and 0.53 s on level terrain.
- Terrain-crest hop: separate 202.5 N·s impulse (2.7 m/s added vertical speed at 75 kg).
- At take-off, the skier's existing slope-tangent vertical velocity is added to the jump impulse. The flight state then tracks world-space vertical position and speed.
- Air drag uses full 3D flight velocity. Ground friction, pole impulses and edge-turn forces are disabled while airborne.
- Flight height is compared with the next actual terrain hit, so rising terrain can catch the skier and landing is collision-based rather than timer-based.
- The camera pitch and airborne HUD speed use the actual vertical flight speed.
- Ground friction is calculated as a force in Newtons and divided by mass to obtain acceleration.
- Normal support force is estimated from mass and the local terrain-normal component of gravity. Lateral edge force is speed-dependent and limited to 1.25 times that normal force.
- The combined ski reaction is estimated from normal and lateral force components. The load split moves from 50/50 to a maximum modeled 60/40 toward the outside ski.
- Avatar stance and ski flex respond to lateral acceleration, outside-ski share and landing impact.

## Inspector cleanup

- Removed the dedicated “ЗАМЕНА ЛЫЖ ЛЫЖНИКА” section and its GLB upload / reset controls.
- Removed skier-only GLB upload, IndexedDB save / restore and reset event handlers.
- Standard built-in skis remain.
- General Scene Editor model import and local backups of scene assets remain active.

## What the ski-load readout means

The HUD displays estimated ski load in Newtons and the outside / inside percentage split. This is a force estimate, not surface pressure in Pa: a pressure map would need actual ski contact area, bending, edge penetration and snow deformation data.

## Model boundary

This is a real-time point-mass / effective-edge approximation, not a validated full-body biomechanics or deformable-ski solver. The 60/40 load-transfer ceiling and 1.25g edge limit are simulation assumptions, not universal values for every turn.

## Regression checks

- Active entrypoint and all local imports.
- JavaScript syntax, HTML IDs and static DOM references.
- 75 kg reference mass, impulse-to-velocity conversion, relative jump apex, normal and lateral ski forces, outside-ski load share.
- Inherited slope velocity, full 3D air drag, terrain-aware landing and grounded-only contact forces.
- Removed skier ski-replacement UI and handlers; retained shared Scene Editor asset storage.
- Existing weather, camera, forest, terrain, Maya and project-manifest checks.

## Not visually verified

No live browser / WebGL play-test was run. Jump timing, edge response, landing feel and visual pose still need live interaction testing.
