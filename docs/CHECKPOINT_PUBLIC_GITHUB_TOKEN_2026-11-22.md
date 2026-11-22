# Grade Optimizer checkpoint — public one-time GitHub Publisher token

Date: 2026-11-22

## Active release
- Active app: `app.v102.js`, loaded by `index.html`.
- Previous release `app.v101.js` is retained for rollback.
- Project repository: `kortul/Grade_Optimizer`.
- Primary Project ID: `alpine-resort`.

## Publisher token workflow
- `github-config.js` is loaded before the app module.
- Its token variable is initially empty.
- The admin enters a fine-grained GitHub token once in the Scene Editor's one-time setup panel.
- The app validates the token through GitHub, then updates `github-config.js` using the GitHub Contents API.
- The token is intentionally stored as public plain text in the repository. Anyone who reads the public file can use its repository-scoped Contents write permission.
- After the GitHub Pages deployment publishes the updated config file, the app loads the token automatically on every device.
- Normal scene saves continue through the existing Git database publisher and verification flow; no repeated token entry is needed.
- The token should be fine-grained, restricted to `kortul/Grade_Optimizer`, with only `Contents: Read and write` and an expiration date.

## Scene save behavior
- The existing `SAVE PERMANENTLY TO GITHUB` flow and manifest/model serialization are unchanged.
- The first token setup is a separate commit that writes `github-config.js`.
- Scene changes still save to `clients/<project-id>/scene.json` plus changed imported model GLBs.

## Security / scope
- There is no server-side secret store and no server-side password authentication.
- This public-token approach is intentionally chosen at the user's request for convenience. It should be treated as a low-security convenience mechanism, not access control.
- The current Scene Editor UI is not cryptographically protected by a password.
- Rotate/revoke the token in GitHub if it is exposed beyond the intended project scope.

## Verification still required
- Confirm first-time token setup using the user's real fine-grained token.
- Confirm GitHub Pages has deployed the updated `github-config.js`.
- Confirm automatic token loading after a reload / second device.
- Confirm one-click permanent scene save with a real project edit.
