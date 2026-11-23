# QA Report — Terrain Contact and Skier Start Fix v126

Date: 2026-11-23

## Reported issue
The HTML input bridge accepted the Skier request, but the app explicitly returned to Overview.

## Changes
- Added a 72 × 72 spatial triangle lookup built from the active terrain's world-space mesh.
- Raycaster hits remain the primary path. If Raycaster returns no intersections, ground queries now use the indexed triangles and barycentric interpolation to recover surface height and smooth normal.
- This fallback is used by spawn discovery and by ongoing skier physics ground queries.
- Failed starts retain their explicit failure code and include bounding box, lookup readiness, mesh count, triangle count and occupied-cell diagnostics.
- The HTML bridge now displays the actual start failure code instead of a generic Overview message.

## Verification
- Static CI validates the spatial triangle lookup, module syntax, diagnostic propagation, application entrypoint, and existing project checks.
- Live browser/WebGL interaction testing remains necessary to confirm runtime behavior.
