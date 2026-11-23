# Checkpoint — Skier Avatar Ski Flex Scope Fix v128

Date: 2026-11-23

- Entry: `index.html` → `app.v128.js`
- Skier controller: `skier-controller.v86.js`
- Fix: `outsideLoad` is computed locally inside each ski-slot callback before ski flex is updated.
- This resolves the observed `ReferenceError` in `_updateSkierAvatar()`.
- CI and Pages deployment must pass; actual ski-mode interaction still needs live browser verification.
