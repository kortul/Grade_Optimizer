# Checkpoint — Independent Mode Input Bridge v125

Date: 2026-11-23

- Entry: `index.html` → `app.v125.js`
- Skier controller: `skier-controller.v84.js`
- Drone controller: `drone-controller.v74.js`
- Mode inputs are captured by a classic HTML script independent from the module.
- The page reports whether the event arrived, the module API is ready, and which mode the app actually entered.
- Browser/WebGL interaction must still be tested in Chrome.
