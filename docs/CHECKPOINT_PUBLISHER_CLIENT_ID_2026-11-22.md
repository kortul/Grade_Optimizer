# Grade Optimizer — Checkpoint: Publisher Client ID flow

Date: 2026-11-22
Branch: `main`
Parent runtime: `app.v98.js`
Active runtime after this checkpoint: `app.v99.js`

## Issue

The Publisher status `Сначала укажи и открой Client ID.` appeared when Save was pressed before a Client Workspace had been selected and loaded. The previous message did not explain where to enter the ID or which button to press.

## Changes in v0.99

- The Client Workspace label now explicitly identifies the field as the Project ID.
- A short numbered hint explains the required order: enter ID → OPEN CLIENT SCENE → connect Publisher → save.
- The publish guard now gives separate messages for an empty ID, invalid ID, an ID that has not been opened, and an ID that differs from the currently active workspace.
- If the typed ID differs from the active workspace, publishing is blocked and the user is directed to OPEN CLIENT SCENE. This prevents saving the active scene into the wrong client folder.
- Missing Publisher connection now points directly to the token field and CONNECT PUBLISHER button.
- The serialization format, asset collection, texture/material handling, Git object creation and commit flow are unchanged.

## Safety behaviour

Opening a different project remains an explicit action. The save button does not silently switch workspaces or immediately publish a newly opened one. After opening, the user can verify the client scene and then press Save.

## Validation

The repository quality-check workflow runs `node scripts/validate-project.mjs` on pushes to `main`. Manual verification is still required for a real Publisher token and browser round-trip.
