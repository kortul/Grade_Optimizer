# QA Report — Independent Mode Input Bridge v125

Date: 2026-11-23

## Reported issue
Mode button clicks and V appeared to have no effect despite previous module-level fixes.

## Changes
- Removed module-owned document capture listeners from the v124 startup path.
- Added a classic HTML input bridge, independent from the ES module. It captures Skier / Drone button clicks and V before module handlers.
- Exposed a narrow mode API from the app after the controller and mode function are initialized.
- The bridge reports a clear visible error if the module API is absent, catches synchronous failures and reports the actual resulting app mode.
- Added global JavaScript error and unhandled module-load rejection reporting.
- The bridge recognises requests queued during terrain loading as pending rather than reporting a false failure.

## Verification
- CI validates syntax, module entry point, exposed API and classic bridge markup.
- Pages deployment is independently checked.
- A live Chrome interaction test was not available; the bridge reports exact runtime status in the browser.
