# Workbench flow drift fix

This overlay updates User Guide Builder flows to match the current Orchard Workbench markup and interaction state.

## Fixed flows

- Property selection now detects `.workbench-property-row--selected` instead of relying on the rendered value of `aria-pressed`.
- Property boundary badges use case-insensitive regular-expression assertions because their visible text is transformed to uppercase.
- Orchard no-results feedback matches the current `No Orchards match this name or PIN.` text.
- Orchard link filters verify the active CSS class instead of an empty-valued Blazor ARIA boolean.
- Block navigation highlights the current Orchard inside the existing `back-to-orchards` control; the removed `block-context` hook is no longer referenced.
- Multi-Block management no longer removes one of only two selected Blocks before the screenshot and Clear step.
- Browse, Auto select and targeted Select verify active CSS classes instead of `aria-pressed` values.
- View Property details uses the same stable selected-row selector as the Property navigator.

## Focused rerun

```powershell
.\scripts\test-workbench-flow-drift.ps1 -Headed -NoPdf
```

After the focused run succeeds, rerun the full safe guide set:

```powershell
.\scripts\capture-all.ps1 -Headed -NoPdf
```

The overlay does not replace `config.json`, `.auth`, generated output, or application source files.
