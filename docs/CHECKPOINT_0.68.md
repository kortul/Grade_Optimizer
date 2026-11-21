# CHECKPOINT 0.68
Date: 2026-11-21
Base: v0.67 (5fd0be2d941fa47654ff1938a93a99f52a0b7b28)

## Fix
- Fixed skier HUD callback parameters: `pushing` is now explicitly received with a default of `false`. Previously the HUD status text referenced an undeclared variable, which could throw during HUD updates.
- No gameplay, camera, scene, or asset behavior changed.

## Versioning
- `app.v68.js` is the active app entry referenced from `index.html`.
- `app.v67.js` is retained unchanged as a rollback checkpoint.
- All v0.67 controllers, tree texture chunks, and assets remain unchanged.

## Validation
- Confirmed the exact callback signature replacement.
- Confirmed `index.html` points to `app.v68.js`.
- GitHub Actions build and Pages deployment are tracked by this commit.
- Browser/WebGL visual behavior has not been manually verified.
