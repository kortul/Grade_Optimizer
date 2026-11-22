# Maya → Grade Optimizer → GitHub Desktop

The native Maya Python plug-in is delivered as an installable Maya module for the local project folder:

`C:\zGit\GradeOptimizer`

Run `maya/install_maya_module.bat` once, restart Maya, then enable `grade_optimizer.py` with **Loaded** and **Auto load** in Plug-in Manager. The **Grade Optimizer** menu opens the exporter.

The exporter writes one FBX and one client manifest:

- `clients/<slug>/models/resort.fbx`
- `clients/<slug>/scene.json`

The additive `nodeMetadata` property stores optional Role, Tags, Collision hint and Forest blocker hint metadata for individual Maya Transform / Group / Mesh nodes. The web editor restores these values by hierarchy path and lets you change them in the Outliner inspector. Existing schema 1.0 client scenes without this property remain compatible.

The FBX contains hierarchy, transforms, geometry and supported material assignments. Semantic metadata is written to the JSON manifest rather than relying on arbitrary custom Maya attributes to survive FBX export.

Open GitHub Desktop, review the changed client files, Commit and Push. This local exporter workflow does not need a browser GitHub token.
