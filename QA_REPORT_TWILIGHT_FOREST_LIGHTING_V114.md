# QA Report — Twilight Forest Lighting v114

## Files
- `app.v114.js`: light-responsive forest materials.
- `index.html`: activates app v114.
- `scripts/validate-project.mjs`: adds nighttime forest material regressions.
- `README.md` / `README-DEPLOY.md`: active release references updated.

## Regression coverage
- AI atlas tree billboards use `MeshStandardMaterial`, not `MeshBasicMaterial`.
- Atlas material no longer disables tone mapping.
- Atlas trees have zero emissive contribution.
- Procedural foliage and fallback billboard materials also have zero emissive contribution.
- Existing project validation, skier v77, time 16:00, cloud weather button and Scene Look tests remain active.

## Not verified by static checks
- Visual balance at dusk / night in a live WebGL browser.
- Whether snow detail retains the desired contrast under every weather preset.
Static validation is not a visual browser sign-off.
