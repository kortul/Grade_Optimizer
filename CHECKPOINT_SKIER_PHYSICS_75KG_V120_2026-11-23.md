# Checkpoint — 75 kg Skier Physics & True 3D Jump v120

Date: 2026-11-23

## Release
- Active entrypoint: `index.html` → `app.v120.js`
- Active skier controller: `skier-controller.v81.js`
- Previous release retained for rollback: `app.v119.js` + `skier-controller.v80.js`

## Physics
- Reference skier + equipment mass: 75 kg.
- Pole impulse: 60 N·s → about 0.8 m/s at 75 kg.
- Manual jump impulse: 195 N·s → 2.6 m/s added vertical speed; relative apex ~0.34 m and level-ground flight ~0.53 s.
- Terrain-crest hop impulse: 202.5 N·s → 2.7 m/s added vertical speed.
- Both jumps inherit the existing slope-tangent vertical velocity at take-off.
- Air drag uses full 3D flight velocity; gravity advances absolute world height.
- No snow friction, pole impulse or ski-edge turning is applied airborne.
- The terrain collision point catches landing; the camera pitch and HUD use vertical flight speed.
- Grounded normal force and lateral edge force are reported as N. Maximum modeled lateral force is 1.25 × normal support.
- Combined ski load uses `sqrt(F_normal² + F_lateral²)`; outside share grows from 50% to 60% under edge demand.

## Scene Editor
- Dedicated skier ski replacement UI and its GLB upload / save / restore / reset handlers are removed.
- Standard skis remain; general Scene Editor GLB / FBX import and scene-model local backups are retained.

## Limits
This is a point-mass approximation, not full musculoskeletal or deformable-ski physics. Ski load is a force estimate, not pressure in Pa. No live browser / WebGL feel test was performed.
