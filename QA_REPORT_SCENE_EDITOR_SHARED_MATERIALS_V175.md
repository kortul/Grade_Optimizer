# QA Report — Scene Editor Shared FBX Materials v175

## Regression checks
- Active browser entrypoint is `app.v175.js`.
- Duplicate FBX material IDs with the same Maya shader name are canonicalized to one shared material object.
- Stage 1 detection accepts filenames, Maya hierarchy labels and source material names.
- The known Stage 1 manifest inventory is locked to four source names:
  - `zzMainlandscape_Slopes`
  - `pasted__pasted__zzMainlandscape_Slopes`
  - `zzShapka_Angled`
  - `openPBR_shader1`
- The Stage 1 canonicalization path creates only the `Slopes` / `Angled` surface kinds; OpenPBR does not create an independent inspector entry.
- The Materials inspector traverses the selected asset root, groups by shared material UUID, retains all mesh-slot bindings, and applies edits to the shared material instance.
- Imported Stage 1 geometry stays as 22 separate mesh components; no geometry merge is performed.

## Not verified by static checks
- Actual browser material count after loading the current binary FBX.
- Visual update of every Slopes / Angled face after changing one shared material.
- Persistence round-trip of a changed shared material through browser autosave and a page reload.
