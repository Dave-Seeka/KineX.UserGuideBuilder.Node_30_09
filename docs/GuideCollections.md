# Joining guides into combined manuals

A collection defines which generated guides become chapters in one standalone manual.

## Default collection

`collections/orchard-workbench.json` joins the complete Orchard Workbench suite in task order.

```json
{
  "id": "orchard-workbench-complete",
  "title": "KineX Orchard Workbench User Guide",
  "description": "A combined, task-based guide.",
  "audience": "KineX Orchard Workbench users",
  "version": "1.0",
  "numbering": "continuous",
  "strict": false,
  "guides": [
    "workbench-overview",
    "app-selection",
    "orchard-navigator"
  ]
}
```

## Fields

- `id`: output folder name under `output/combined`.
- `title`: manual cover title.
- `description`: cover description.
- `audience`: optional cover metadata.
- `version`: optional cover metadata.
- `guides`: ordered flow IDs to include.
- `numbering`: `continuous` or `per-guide`.
- `strict`: when `true`, fail joining if any requested guide was not generated.

When `strict` is `false`, skipped, failed or missing guides are listed in a coverage appendix with the capture reason.

## Automatic joining

`capture:all` captures individual flows and then joins every JSON collection found in `collectionsDir`:

```powershell
npm run capture:all
```

## Join existing output

Use this after changing only a collection title, order or guide membership:

```powershell
npm run join
```

Skip PDF generation while iterating:

```powershell
node .\src\cli.mjs join `
  --config .\config.json `
  --collections .\collections `
  --no-pdf
```

## Output

```text
output/combined/orchard-workbench-complete/
├── guide.html
├── guide.md
├── guide.pdf
├── manifest.json
└── images/
    ├── workbench-overview/
    ├── app-selection/
    └── ...
```

Images are copied into the combined manual, so the joined folder is self-contained and can be moved independently of the per-guide output.

## Blank screenshots

When an individual guide manifest contains `blankImage`, the collection builder copies that asset and adds an **Open blank screenshot without guide annotations** link beneath the annotated image. Older guide manifests without blank images remain supported.


## Additional print-first manual

Each joined collection also produces `guide-print.html`, `guide-print.md` and `guide-print.pdf` when `printGuide.enabled` is true. This is an additive portrait output intended for end-user distribution; it does not replace the existing joined guide.

The print layout uses continuous numbered instructions, one screenshot under each instruction, and highlighted Tip/Alert callouts. It omits the internal **Verified** assertion list and blank-image links.

See `docs/PrintGuide.md` for configuration.
