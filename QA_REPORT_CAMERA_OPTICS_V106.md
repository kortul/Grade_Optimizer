# QA REPORT — Camera Optics v106

**Date:** 2026-11-22  
**Repository:** `kortul/Grade_Optimizer`  
**Branch:** `main`  
**Baseline:** `7eda4c6a82094f49be652660efe176d61e7bf72c`

## Findings and changes

| Area | Result |
|---|---|
| Lens fragment shader | Fixed duplicate `highlightMask` declaration; dirt mask now has its own `dirtHighlightMask` name |
| Shader regression coverage | Added a validator check for duplicate local declarations inside lens shader `main()` |
| Runtime resilience | Shader-link diagnostics and composer exceptions switch to direct scene rendering |
| Render-target allocation | Composer size / pixel ratio update only when the viewport or quality profile changes |
| Version safety | Added app v106 and camera-optics v2; v105 / optics v1 remain available |
| Release documentation | Updated active entrypoint and validation notes |

## Static checks added

- Active app imports `camera-optics.v2.js`.
- The custom lens fragment shader contains no duplicate local declarations in `main()`.
- Camera optics retains a direct renderer fallback for failed post-processing.
- Composer sizing is guarded against redundant allocations.
- The existing Node.js project validator continues to check local module syntax, HTML IDs, DOM references, asset buffers, manifests and Maya Python syntax.

## Not covered here

The connector does not provide a live browser/WebGL session. Visual output, GPU driver behavior, actual FPS and cross-device project restore still require verification on the deployed site. Do not treat source-level checks as proof of those runtime properties.
