# CHECKPOINT 0.69
Date: 2026-11-21
Base: v0.68 (9bec24f4a6a9b417137339345675a28c51cbaefd)

## Fixes
- Added a dedicated visible ДРОН toolbar button. It enters drone mode directly from Overview or Skier mode; the existing skier/drone toggle remains available.
- Updated toolbar layout so all mode controls remain visible and clickable on desktop and narrow screens.
- Replaced the AI spruce billboard material with an unlit MeshBasicMaterial and disabled tone mapping for those billboards, so scene lighting no longer crushes the tree colours.
- Added a browser-side texture brightness/saturation correction (brightness 1.28, saturation 1.16, contrast 1.04) while preserving alpha transparency.
- Removed the per-instance dark tint from the tree billboards.

## Versioning
- `app.v69.js` is the active entry referenced by `index.html`.
- `app.v68.js` and earlier versions remain unchanged for rollback.

## Validation
- Static syntax/HTML checks and GitHub Actions build/deployment are tracked with this commit.
- Browser/WebGL visual rendering and real pointer-lock interaction still require manual verification.
