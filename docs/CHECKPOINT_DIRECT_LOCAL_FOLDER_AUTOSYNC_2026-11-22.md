# Grade Optimizer checkpoint — direct local repository auto-sync

Date: 2026-11-22

## Active release
- Active app: `app.v104.js`, loaded from `index.html`.
- Previous versions are retained for rollback.
- Repository: `kortul/Grade_Optimizer`.
- Primary Project ID: `alpine-resort`.

## Workflow
1. Click `CONNECT LOCAL PROJECT FOLDER` and select the local `Grade_Optimizer` repository root.
2. The selected FileSystemDirectoryHandle is stored in IndexedDB (`grade-optimizer-local-assets` / `models`).
3. Scene Editor keeps autosaving a fallback copy into IndexedDB.
4. Once write permission is granted, each autosave writes changed model files directly to `clients/<slug>/models/` and then writes `clients/<slug>/scene.json`.
5. GitHub Desktop detects the changes in the working tree; commit and push.
6. On later Chrome launches the app restores the saved handle and checks permission. If Chrome reports `prompt`, click the same folder button to re-authorize it; the directory picker should not be needed again unless permission was revoked or the handle became invalid.

## Implementation
- Uses File System Access API (`showDirectoryPicker`, `queryPermission`, `requestPermission`, `getDirectoryHandle`, `getFileHandle`, `createWritable`).
- The selected folder is validated using repository-root files `index.html`, `README.md`, and directory `maya/`.
- Model GLBs are written first; `scene.json` is written last.
- Unchanged model buffers are not rewritten during the current page session.
- Model files referenced by the previous manifest but no longer used are deleted; unrelated files remain untouched.
- IndexedDB backup remains as fallback if local folder permission is unavailable.
- Local backup precedence uses manifest timestamps so an unpushed newer browser draft can be restored after an earlier commit/push.
- No PAT is embedded in app code. The ZIP exporter is removed from the active app.

## Limits
- File System Access API requires a secure context and user activation for initial directory selection / permission requests. Chrome and Edge desktop are intended.
- Permission may return to `prompt` after a browser restart or permission reset; the stored handle may need re-authorization.
- GitHub Desktop still requires user Commit + Push.
- Individual model files are limited to 90 MiB in this regular-Git workflow.

## Verification
- CI validation and GitHub Pages deployment.
- Real browser test still required for folder selection, persistent permission, local writes and GitHub Desktop detection.
