# Property navigator drop-in

Copy the files in this package over the existing KineX Orchard Workbench guide-builder folder.

The update adds:

- `026-property-navigator.json`
- `027-property-search.json`
- `028-property-boundary-filters.json`
- direct Property navigator selection in `084-view-property-details.json`
- updated coverage counts, fixtures and flow regression tests

Validate after copying:

```powershell
npm run validate
npm test
npm run check
```

The resulting suite contains 53 ordered flows: 46 safe publication flows and 7 guarded mutation flows.
