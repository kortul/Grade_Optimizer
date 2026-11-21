# Checkpoint 0.65 — Editor runtime fix

**Base:** v0.64 (`app.v64.js` retained)
**Active app:** `app.v65.js`

- Declared and initialized the selection-outline helper state before the source scene load callback can use it. This prevents a startup ReferenceError when the active terrain starts loading.
- Opening the optimizer now closes the Scene Editor, and vice versa, so the two panels cannot occupy the same overlay region.
- Keeps v0.64's viewport picking, live-scene mesh listing and non-overlapping toolbar/panel layout.

## Validation
- JavaScript syntax smoke check passed.
- All required helper functions and selection state are present.
- No missing DOM IDs or duplicated IDs.
- Browser/WebGL validation with the actual resort model remains necessary.