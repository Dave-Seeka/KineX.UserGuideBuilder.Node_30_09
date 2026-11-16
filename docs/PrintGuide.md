# Print-first guide output

The joined manual now has two parallel presentations:

- `guide.html`, `guide.md`, `guide.pdf` - the existing interactive/technical joined guide.
- `guide-print.html`, `guide-print.md`, `guide-print.pdf` - a portrait, print-first end-user manual.

The print guide follows the supplied KineX guide style:

- A4 portrait pages.
- Continuous numbered instructions.
- A screenshot directly below each instruction.
- Compact chapter headings.
- Highlighted Tip and Alert callouts.
- No assertion evidence or blank-screenshot links in the PDF.

## Configuration

```json
"printGuide": {
  "enabled": true,
  "fileBaseName": "guide-print",
  "imageVariant": "annotated",
  "includeContents": false,
  "includeCoverageNotes": false,
  "includePrerequisites": true,
  "includeSafety": false
}
```

Set `imageVariant` to `blank` to use clean screenshots in the print manual. The interactive guide continues to use annotated screenshots and link the blank assets.

Set `enabled` to `false` to disable the additional print files while retaining the existing joined guide.

Set `includeSafety` to `true` only when capture-safety text should be included in the distributed print guide. It defaults to `false` so internal capture warnings do not appear in the end-user manual.
