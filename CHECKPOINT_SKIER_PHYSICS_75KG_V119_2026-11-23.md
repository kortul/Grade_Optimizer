# Checkpoint — 75 kg Skier Dynamics & Inspector Cleanup v119

Date: 2026-11-23

## Release
- Active entrypoint: `index.html` → `app.v119.js`
- Active skier controller: `skier-controller.v80.js`
- Rollback release retained: `app.v118.js` + `skier-controller.v79.js`

## Physics
- Reference system mass: 75 kg (skier + equipment approximation).
- Pole push: 60 N·s, approximately 0.8 m/s at 75 kg.
- Manual Space jump: 195 N·s → 2.6 m/s vertical launch, ~0.34 m apex, ~0.53 s on level ground.
- Crest-assisted hop: 202.5 N·s → 2.7 m/s launch.
- Ballistic flight is tracked in world height and terrain can intercept the landing.
- Airborne movement applies aerodynamic drag only, with no snow friction, pole stroke or edge-force turning.
- Grounded normal force and lateral edge force are calculated in Newtons. Maximum modeled lateral force is 1.25 × normal support.
- Combined ski load uses `sqrt(F_normal² + F_lateral²)`.
- Outside ski share rises from 50% to 60% based on edge-force demand. The HUD reports both ski loads in Newtons and their percentage split.
- The stance / knee / ski-flex animation responds to lateral load and landing impact.

## Scene Editor
- Removed the dedicated skier ski replacement section, upload and reset controls, and the skier-only local model save / restore handlers.
- Standard skis remain. General Scene Editor GLB / FBX import and scene-model local backups remain unchanged.

## Limits
This remains a point-mass approximation, not full musculoskeletal / ski-flex physics. Ski load is a force estimate, not pressure in Pa; contact area, ski flex and snow deformation are not simulated.

## Verification boundary
- CI validates physics constants / calculations, flight force separation, landing detection and ski-load transfer, along with existing project checks.
- Actual browser / WebGL feel has not been manually play-tested.
