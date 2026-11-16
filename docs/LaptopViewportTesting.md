# Standard laptop viewport testing

The `laptop` profiles execute the existing Orchard Workbench guide suite at a
1366 x 768 CSS-pixel viewport. This is the constrained desktop size used for
standard laptop regression testing.

Every captured step automatically verifies:

- the Playwright page is exactly 1366 x 768;
- the document does not introduce horizontal page scrolling;
- visible create drawers, map menus, geometry prompts and dialogs remain inside
  the viewport.

The normal safe suite already performs realistic field entry in the create and
edit forms, but stops before persistent submission.

## Safe data-entry run

```powershell
npm run capture:laptop
```

Output is written to `output-laptop` so it does not replace the normal guide
output.

## Persistent local mutation run

The local mutation run submits guide-owned create and edit operations at the
same viewport. In `config.json`, enable guarded mutations:

```json
{
  "mutations": {
    "enabled": true,
    "confirmation": "ALLOW KINEX GUIDE MUTATIONS",
    "requiredConfirmation": "ALLOW KINEX GUIDE MUTATIONS",
    "testPrefix": "UG"
  }
}
```

Then run:

```powershell
npm run capture:laptop:mutations
```

Output is written to `output-laptop-mutations`. The existing mutation sequence
creates its own Orchard and Block, verifies edits, and removes the guide-owned
records at the end.

## Configuration

The default laptop viewport and audit tolerances can be adjusted without
editing flows:

```json
{
  "viewports": {
    "laptop": {
      "width": 1366,
      "height": 768
    }
  },
  "viewportAudit": {
    "enabled": true,
    "horizontalOverflowTolerance": 2,
    "overlayTolerance": 3
  }
}
```

A flow's existing 1440 x 900 viewport remains unchanged for `smoke`, `core`,
`full` and `mutation` runs. The laptop profile deliberately overrides it.
