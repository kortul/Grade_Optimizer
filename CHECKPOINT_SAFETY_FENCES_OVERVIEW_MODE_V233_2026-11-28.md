# CHECKPOINT — Safety Fences in Overview Mode v233

Date: 2026-11-28

## Change
- The safety-fence visibility predicate now allows the enabled fence group to render in Overview, Skier, and Drone modes.
- The weather/settings fence toggle tooltip now accurately says the fences are displayed in all three modes.
- Existing toggle behavior, localStorage persistence, automatic fence building, and Skier/Drone visibility are retained.

## Files
- `app.v233.js` — new immutable application entry based on v232.
- `index.html` — active entry updated to `./app.v233.js?v=242`.

## Validation
- Source check confirms the visibility predicate includes `overview`, `skier`, and `drone`.
- Source check confirms the button tooltip no longer claims fences are limited to Skier and Drone.
- Source-level validation only; no live browser/WebGL test was run.
