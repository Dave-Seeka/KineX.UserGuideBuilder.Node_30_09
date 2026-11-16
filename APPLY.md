# Apply the standard laptop test overlay

Extract this archive over the root of `KineX.UserGuideBuilder.Node`.

```powershell
Expand-Archive `
  .\kinex-user-guide-builder-standard-laptop-tests.zip `
  -DestinationPath C:\Users\david.arrow\Documents\GitHub\KineX.UserGuideBuilder.Node `
  -Force
```

Validate:

```powershell
npm run check
npm test
npm run validate
```

Run the full safe/data-entry suite at 1366 x 768:

```powershell
npm run capture:laptop
```

The safe suite fills create and edit fields but does not submit persistent
changes. Output is written to `output-laptop`.

For persistent local create/edit/delete verification, enable the existing
mutation confirmation in `config.json`, then run:

```powershell
npm run capture:laptop:mutations
```

Output is written to `output-laptop-mutations`.
