# Checkpoint — Smooth Skier/Drone Camera v129

Date: 2026-11-23

- Entry: `index.html` → `app.v129.js`
- Skier controller: `skier-controller.v87.js`
- Drone/skier transitions use a dynamic, eased camera blend with quaternion slerp.
- During blending, controller updates run against the unblended destination camera pose to prevent feedback into drone movement.
- First-person jump pitch is now subtle, clamped and damped; camera height continues to follow physical airtime.
- Browser visual feel still requires a live test.
