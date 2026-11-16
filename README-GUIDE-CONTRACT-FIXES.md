# Orchard Workbench guide-contract fixes

Apply this overlay at the root of `KineX.UserGuideBuilder.Node`.

## Changes

- preserves existing AppSelection country/crop values instead of selecting a different option;
- selects an existing Property through the current search/result controls;
- removes obsolete client-entered Property code and radio-button assumptions;
- retries Create Block against a stable Orchard parent context;
- waits for asynchronously loaded basemap/layer options;
- removes the retired link-existing geometry guide hook;
- adds `clickUntilVisible` and `selectFirstOptionIfEmpty` actions;
- includes the create-form disabled reason in timeout diagnostics.

## Validate

```powershell
npm run check
npm test
npm run validate
```
