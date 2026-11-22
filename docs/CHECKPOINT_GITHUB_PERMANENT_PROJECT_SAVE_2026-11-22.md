# Grade Optimizer — Checkpoint: permanent GitHub save

Date: 2026-11-22
Branch: `main`
Active runtime: `app.v101.js`

## Primary project and access

- The single administrator/editor is the project owner. Clients/viewers do not need accounts or edit access.
- The default Project ID is `alpine-resort`, matching Maya Exporter.
- The default project opens automatically.
- `?project=<id>` selects another project. Legacy `?client=<id>` URLs remain supported.
- Scene Editor password protection remains a separate future task.

## Save flow

- The permanent save button is visible independently of the collapsed GitHub access panel.
- If no token is connected, clicking Save expands ADMIN · GITHUB ACCESS and focuses the token field.
- Fine-grained token requires Contents read/write access to `kortul/Grade_Optimizer`; it remains in tab memory.
- Save commits `clients/<id>/scene.json` and modified imported model GLBs to `main`.
- After updating main, the app verifies the new branch SHA and confirms the manifest blob SHA through the GitHub Contents API.
- Only after both checks pass are dirty flags cleared.
- GitHub Pages deploys the committed viewer files after the permanent repository save.
- Legacy local model drafts are recovered only when opening the default project without an explicit project query; if the remote manifest is missing, the drafts are marked dirty for migration to GitHub. If a remote manifest exists, it replaces browser drafts.

## Validation

- Active entrypoint: `app.v101.js`.
- GitHub Actions quality check validates JS syntax, DOM bindings, permanent save wiring and matching Maya Exporter defaults.
- GitHub Pages deploy is checked separately.
- A real token-backed save and cross-device reload still requires manual verification in the browser.
