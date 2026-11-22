# Maya → Grade Optimizer → GitHub Desktop

The Maya exporter writes one client FBX and one manifest into the local repository:

- `clients/<slug>/models/resort.fbx`
- `clients/<slug>/scene.json`

The manifest schema remains `1.0`, so existing client URLs and GLB scenes remain compatible. The web app loads both GLB and FBX models. Embed Media should be enabled in the Maya FBX export.

Open GitHub Desktop, review the two changed client files, commit, and Push. No browser GitHub token is required for this local export workflow.
