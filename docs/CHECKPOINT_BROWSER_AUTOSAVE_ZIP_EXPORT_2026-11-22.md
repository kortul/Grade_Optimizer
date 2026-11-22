# Grade Optimizer checkpoint — browser autosave and ZIP publish

Date: 2026-11-22

## Active release
- Active app: `app.v103.js`, loaded from `index.html`.
- Previous app versions remain in the repository for rollback.
- Repository: `kortul/Grade_Optimizer`.
- Primary Project ID: `alpine-resort`.

## Workflow
1. Scene Editor automatically saves project backups into IndexedDB in the current browser.
2. Backups include the complete `clients/<project-id>/scene.json` manifest plus every imported model's binary source file.
3. Backups include built-in scene Editor settings, root transforms, visibility, node metadata, material settings, and embedded custom textures.
4. On reopening the same project in the same browser, an unsynced local backup is restored only when it is based on the currently deployed manifest. A newer deployed version takes precedence; changes made after a ZIP export are also restored after that ZIP becomes the deployed base.
5. When editing is complete, `EXPORT PROJECT PACKAGE · ZIP` downloads a ZIP containing the complete project folder under `clients/<project-id>/`.
6. Extract/merge the ZIP at the local repository root, then commit and push via GitHub Desktop.

## Implementation
- Existing IndexedDB `grade-optimizer-local-assets` / `models` store is reused.
- Manifest record key: `project-backup:<slug>`.
- Model records: `project-backup-model:<slug>:<asset-id>`.
- Local autosave is debounced by 1.2 seconds after project changes.
- Imported remote models retain their source ArrayBuffer so they can be autosaved and included in ZIP export.
- Dirty imported models are re-exported to GLB during browser autosave, and FBX paths are switched to the generated GLB.
- The stored export timestamp allows local edits made after ZIP download to survive the corresponding GitHub Desktop push and Pages deployment.
- ZIP writer uses uncompressed ZIP entries with CRC32 and standard local/central directory records; this avoids an extra compression library and preserves binary models.
- ZIP output mirrors the repository paths: `clients/<slug>/scene.json` and `clients/<slug>/models/<asset>`.

## Security
- Direct public-token GitHub publishing has been removed.
- `github-config.js` is deleted from the active project tree.
- No GitHub PAT is embedded in the browser app.
- Browser backup is local to the browser profile, not a cross-device sync mechanism.

## Verification still required
- Confirm CI validation and GitHub Pages deployment.
- Real browser verification of IndexedDB autosave, restore, and ZIP extraction is still required; the connected GitHub tool cannot execute the app inside the user's browser.
