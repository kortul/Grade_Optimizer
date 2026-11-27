# Safety Fences v212 — startup performance

Date: 2026-11-27

## Performance changes
- Safety fences are now opt-in and default to hidden; no terrain sampling occurs during initial site loading.
- Enabling the layer explicitly starts the safety-fence analysis from the Weather panel.
- Reduced sampling from four terrain raycasts per panel candidate to two.
- Increased the spacing to 5.5 m, widened each repeated panel to 5.8 m, and capped placement at 2,400 panels.
- Terrain sampling uses one near-edge height and one 8 m outward height; removed the redundant far sample and separate foot-height raycast.
- Uses a new local-storage key so previous auto-enabled settings cannot silently trigger the expensive calculation on upgrade.

## Validation
- CI syntax and project validation pass.
- Dedicated tests verify placement on steep terrain, rejection on flat terrain, and safe handling of invalid input.
- Browser timing/FPS still requires verification on the user's machine.
