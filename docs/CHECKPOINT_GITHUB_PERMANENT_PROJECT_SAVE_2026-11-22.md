# Grade Optimizer — Checkpoint: GitHub-backed primary project

Date: 2026-11-22
Branch: `main`
Parent runtime: `app.v99.js`
Active runtime: `app.v100.js`

## Product direction

There is one administrator/editor: the project owner. Clients/viewers do not need accounts and do not need to edit. Scene Editor password protection is a separate future task; this checkpoint does not claim to implement authentication.

## Primary project

- Default Project ID: `alpine-resort`.
- This matches the existing Maya Exporter default Project ID.
- The primary workspace opens automatically when the site is opened without query parameters.
- `?project=<id>` selects another project. Legacy `?client=<id>` links remain supported.
- UI terminology is now Project Workspace / Project ID / Viewer Link. Internal folder layout remains `clients/<id>/` for backward compatibility.

## Permanent save flow

- The save action is visible outside the collapsed GitHub access details.
- The administrator connects a fine-grained token with Contents read/write access to `kortul/Grade_Optimizer`. It stays in tab memory.
- Save builds a manifest containing imported model settings and built-in Scene Editor settings, commits the manifest and changed model GLBs directly to `main`, then verifies the updated branch ref and `clients/<id>/scene.json` blob.
- The dirty state is cleared only after the verification passes.
- A successful GitHub commit is the permanent save. GitHub Pages deployment subsequently refreshes the viewer URL.
- Legacy browser-stored imported models are recovered as drafts only for an unpublished default workspace, then marked dirty so they can be migrated to GitHub. A remote manifest always takes precedence over local drafts.

## Stored content

- Imported model files and per-asset transforms / visibility / category / phase / Collision / Forest blocker.
- Nested imported node visibility and Role / Tags / Collision / Forest blocker.
- Built-in scene node transforms, visibility and metadata.
- PBR material values, shared/unique material identity, and imported texture data URLs.

## Validation

GitHub Actions validates active entrypoint, unique DOM IDs, DOM references, JS syntax, project save assertions and Maya exporter files. Manual browser round-trip with the administrator's fine-grained token remains required to confirm live API writes and cross-device restoration.
