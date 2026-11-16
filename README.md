# KineX Orchard Workbench User Guide Builder — Node

A standalone Node.js and Playwright application that runs repeatable Orchard Workbench workflows, captures numbered highlight boxes with a separate screenshot legend, verifies expected UI outcomes, and generates Markdown, HTML and PDF user guides.

## Included Orchard Workbench suite

Version 1.7.0 defines **71 ordered flows**: **61 non-destructive guide flows**, **9 guarded mutation-verification flows**, plus the isolated PIN 1285 Block-hectares E2E fixture flow. The safe suite now follows the current full Workbench rather than the earlier Orchard/Block-only layout.

Coverage includes:

- AppSelection plus Property, Orchard, Maturity Area and Block navigators
- canonical Business Form **Overview / Allocation / Activity** views
- Orchard specialist views for Maturity Areas, Grower supply and Variety areas
- current multi-Block Overview, Allocation and Activity workflows
- Business Form focus/full-screen and selected-entity context rail
- ArcGIS selection, navigation, basemap, operational-layer and Pick-strategy indicator controls
- Property, Orchard, Block and Maturity Area create/edit journeys
- effective-dated edit scheduling and MA assignment changes
- Block-to-Maturity-Area assignment from both Block and MA views
- **Split Pick / Select Pick** strategy presentation, effective date, estimated-yield wording and strategy indicators
- Select Pick Activity/history and safe reversal review
- physical **Split Block / Undo split / Rejoin next season** lifecycle actions
- derived **Clearance / CTP** requirement shown on Maturity Areas affected by an effective Select Pick
- Orchard/Block/Property boundary editing, delete confirmation and guarded mutation verification

Safe create flows stop at **Review**, edit and assignment flows cancel, Pick/reversal flows close without applying, geometry flows cancel, and delete flows close confirmation. Environment-dependent flows are reported as skipped rather than stopping the complete capture.

## New in 1.7.0

- Added first-class Maturity Area navigator and search/no-results coverage.
- Updated Business Form guides to the canonical Overview, Allocation and Activity model with the separate action ribbon.
- Reworked multi-Block guides around the current combined Blocks Business Form and effective MA allocation list.
- Added safe Create Maturity Area, MA profile edit, MA Block assignment and Block MA assignment journeys.
- Split Split Pick and Select Pick into dedicated safe flows: Split Pick covers percentage allocation for unmapped Blocks; Select Pick covers sizing-based allocation with estimated-yield planning shares.
- Added Select Pick audit/reversal review, MA Pick-strategy indicators and map indicator visibility coverage.
- Added physical Block Split/Undo/Rejoin action-menu coverage without starting a lifecycle mutation.
- Added the derived Clearance / CTP requirement to the MA guide surface.
- Updated Property, Orchard and Block edit guides to the effective-date scheduling modal and current Business Form Edit action.
- Updated geometry guides to the dedicated Business Form boundary action.
- Updated Block creation for auto-generated Block codes and required Production status / Cover status.
- Updated guarded mutation flows to the current effective-dated edit model and auto-code Block creation.
- Removed retired selectors such as `context-edit-action`, `edit-property`, `select-visible-blocks` and the old multi-Block panel hooks.
- Expanded profiles to **6 smoke**, **31 core**, **61 full-safe** and **9 mutation** flows.

## New in 1.6.0

- Added a first-class Property navigator flow that selects Properties independently of map geometry.
- Added Property search, no-results, clear-search and linked/unlinked boundary-filter guides.
- Updated Property-details capture to select directly from the Property navigator.
- Verified boundary resolution finishes before asserting authoritative Linked/Unlinked states.

## New in 1.5.0

- Expand the Orchard Workbench suite from 20 to 50 ordered flows.
- Add `smoke`, `core`, `full`, `mutation` and `all` capture profiles.
- Keep the default `full` profile non-destructive with 43 safe user-guide flows.
- Add guarded mutation flows for Orchard/Block creation, Orchard/Block/Property save toasts, Split/Select Pick application, and Block/Orchard delete toasts.
- Add `coverage.html`, `coverage.md` and `coverage.json` with generated, data-gated, failed and profile-excluded outcomes.
- Add map toolbar move/collapse, auto-select, basemap selection, layer visibility, search/no-result, validation, backward-navigation and cancel coverage.
- Add `dragBy`, `rememberText`, `rememberValue` and `assertAttribute` flow capabilities.
- Filter joined manuals by the active profile so safe and mutation publications never mix accidentally.
- Require the exact confirmation phrase `ALLOW KINEX GUIDE MUTATIONS` before any persistent flow can run.

Run profiles with:

```powershell
npm run capture:smoke
npm run capture:core
npm run capture:full
npm run capture:mutations
```

To refresh only the current Split Pick and Select Pick guide flows:

```powershell
npm run capture -- --flow .\flows\174-split-pick.json
npm run capture -- --flow .\flows\176-pick-strategy-drawer.json
```

The mutation profile is disabled by default. See `docs/FullCoverageTestData.md` before enabling it.

For the entered-vs-GIS Block hectare regression suite, first create the isolated PIN 1285-derived E2E fixture:

```powershell
npm run capture:block-hectares:e2e
```

This creates a guide-owned Property, Kiwifruit Orchard and four mapped Blocks through the real Workbench UI. See `docs/BlockHectaresManualTesting.md` for the follow-on tests.

## New in 1.4.0

- Generate an additional portrait, print-first joined manual modeled on the supplied KineX Entity guide.
- Keep the existing landscape interactive guide unchanged.
- Use continuous numbered instructions with screenshots directly beneath each step.
- Render Tip and Alert callouts as highlighted print-friendly boxes.
- Omit technical assertion evidence and blank-image links from the end-user print PDF.
- Allow the print manual to use annotated or blank screenshots.

The combined output now includes:

```text
output/combined/orchard-workbench-complete/
├── guide.html
├── guide.md
├── guide.pdf
├── guide-print.html
├── guide-print.md
├── guide-print.pdf
├── manifest.json
└── images/
```

Configure the additional output under `printGuide` in `config.json`. See `docs/PrintGuide.md`.

## New in 1.3.3

- Wait for the ArcGIS MapView to become usable before every Orchard Workbench flow continues after navigation.
- Allow up to two minutes for map initialization, layer loading and toolbar binding.
- Wait an additional eight seconds after readiness so tiles and operational layers settle before screenshots.
- Require an enabled Home map tool plus a rendered ArcGIS surface/canvas rather than only the outer map container.
- Report map-load diagnostics when readiness is not reached.

Configure slower environments under `map` in `config.json`:

```json
"map": {
  "autoWaitOnWorkbenchNavigation": true,
  "timeoutMs": 120000,
  "settleMs": 8000
}
```

## Added in 1.3.2

- Correct entity-specific Review assertions for Orchard and Block create flows.
- Restart the authenticated context and pause after create-form rate limiting before continuing the suite.
- Skip unavailable Create Orchard actions cleanly instead of waiting for a click timeout.
- Honour custom toast selectors and assertion timeouts from `config.json`.
- Preserve the v1.3.1 blank screenshot output for every captured step.

Set the throttle recovery pause in milliseconds with `rateLimitCooldownMs`; use `0` to disable the pause.

## Added in 1.3.1

- Capture a blank screenshot without guide highlight overlays for every step.
- Store blank images beside annotated images using the `-blank` suffix.
- Link blank screenshots from individual Markdown/HTML guides and joined manuals.
- Copy blank screenshots into combined manual output and record them in manifests.
- Allow global and per-step opt-out when a duplicate clean image is unnecessary.

## Added in 1.3.0

- Join selected generated guides into one standalone manual.
- Generate a combined cover, contents, chapters, continuous step numbering and coverage appendix.
- Produce joined Markdown, HTML, PDF and a machine-readable manifest.
- Record successful UI assertions in each guide step under **Verified**.
- Assert visibility, hidden state, enabled/disabled state, text, values, counts and URLs.
- Assert toast message, severity/tone and optional automatic dismissal.
- Assert that an unexpected toast does not appear.
- Automatically generate configured combined manuals after `capture:all`.

## Requirements

- Node.js 20 or later
- Access to `https://kinex.test:7004`
- A current KineX Orchard Workbench build containing the native `data-guide` hooks used by the suite

## Setup

```powershell
npm install
npx playwright install chromium
Copy-Item .\config.example.json .\config.json
```

Keep your existing `config.json` and `.auth` directory when upgrading.

## Save portal authentication

```powershell
npm run auth -- --fresh
```

Complete KineX/portal login and MFA in the browser. The builder saves normal browser login state, but it does **not** serialize ArcGIS tokens or IdentityManager state. GIS-backed captures establish ArcGIS authentication live in the capture tab and keep that same tab for the run.

## Coverage profiles

The default `capture:all` command runs the complete safe profile. It never submits a create form, saves an edit, completes geometry, or confirms deletion.

```powershell
npm run capture:smoke     # 6 fast orientation checks
npm run capture:core      # 31 primary user journeys
npm run capture:full      # 61 safe guide flows
npm run capture:mutations # 9 guarded create/save/Pick/delete checks
```

The `all` profile can be invoked directly when a disposable environment should run both sets:

```powershell
node .\src\cli.mjs capture-all --config .\config.json --flows .\flows --profile all
```

Mutation execution requires both `mutations.enabled: true` and the exact configured confirmation phrase. The runner rejects the profile before launching a browser when either guard is missing.

## Generate every guide and the combined manual

```powershell
npm run capture:all
```

The suite creates:

```text
output/
├── index.html
├── index.md
├── capture-summary.json
├── coverage.html
├── coverage.md
├── coverage.json
├── combined/
│   └── orchard-workbench-complete/
│       ├── guide.html
│       ├── guide.md
│       ├── guide.pdf
│       ├── guide-print.html
│       ├── guide-print.md
│       ├── guide-print.pdf
│       ├── manifest.json
│       └── images/
├── workbench-overview/
│   ├── guide.html
│   ├── guide.md
│   ├── guide.pdf
│   ├── manifest.json
│   └── images/
│       ├── 01-overview.png
│       └── 01-overview-blank.png
└── ...
```

Skipped or failed environment-specific flows are shown in the index, capture summary and combined-manual coverage appendix. Set `continueOnFlowError` to `false` when CI should fail immediately on the first unexpected flow error.

When KineX reports create-form throttling, `capture:all` restarts the authenticated context and waits for `rateLimitCooldownMs` before starting the next guide. The default is `30000`.

## ArcGIS map readiness

By default, every `goto` action targeting `/arcgis/orchard-workbench` waits for the map before later actions or screenshots run. Capture startup also uses this as the GIS authentication gate: when Portal login appears, the headed browser can click an unambiguous login control or wait for the user to finish SSO/MFA, then continues only after the same Workbench tab proves map interactivity. The builder waits for:

- the Home map tool to become enabled, which indicates the Blazor map-ready callback and toolbar initialization completed;
- a visible, non-zero ArcGIS view surface and canvas;
- a benign hover/pointer interaction against the live map without changing extent;
- the configured render-settle period after those checks pass.

Increase the values when ArcGIS services or the internal network are slow:

```json
"map": {
  "autoWaitOnWorkbenchNavigation": true,
  "workbenchPath": "/arcgis/orchard-workbench",
  "timeoutMs": 180000,
  "settleMs": 12000
}
```

Use `"waitForMapReady": false` on a specific `goto` action only when that flow intentionally does not require the map. The explicit `waitForMapReady` action is also available after a map-changing interaction.

## Join guides without recapturing

After individual guides already exist under `output`, run:

```powershell
npm run join
```

Collection definitions live in `collections/*.json`. The supplied `orchard-workbench.json` joins the complete ordered suite. See `docs/GuideCollections.md`.

## Generate one guide

```powershell
node .\src\cli.mjs capture `
  --config .\config.json `
  --flow .\flows\090-create-orchard-existing-property.json `
  --headed
```

## Add UI checks to a step

Checks run after step actions and before the screenshot. Passed checks are included in the guide output.

```json
"checks": [
  {
    "type": "assertVisible",
    "label": "Review step opened",
    "locator": { "selector": "[data-guide='orchard-review-step']" }
  },
  {
    "type": "assertToast",
    "label": "Save notification",
    "contains": "saved successfully",
    "tone": "success",
    "timeoutMs": 15000
  }
]
```

The default flows remain non-destructive, so success-toast checks belong in a separate mutation-enabled flow that actually saves or deletes a controlled test record. See `examples/toast-check.json` and `docs/Assertions.md`.


## Blank screenshots

Every step captures two images by default:

- the normal annotated screenshot with numbered guide highlights;
- a blank screenshot of the same UI state without guide overlays.

Blank images use the configured suffix and are linked below each step in HTML and Markdown. They remain separate assets so the generated PDF is not doubled in length.

```json
"screenshot": {
  "blank": true,
  "blankSuffix": "-blank"
}
```

Disable the blank image for one step with `"blank": false`, or provide an exact name with `"blankFile": "review-clean.png"` inside that step's `capture` object.

## Configure guide-only values

The suite fills forms only far enough to reach Review. Override generated example values in `config.json`:

```json
"guideData": {
  "propertyCode": "GUIDE-PROPERTY",
  "orchardPin": "GUIDE-ORCHARD",
  "orchardName": "Guide Orchard",
  "blockCode": "GUIDE-BLOCK",
  "blockName": "Guide Block",
  "addressSearch": "10 Te Puke Highway, Te Puke"
}
```

`{{runId}}` is appended to identity fields to avoid conflicts with local browser validation.

## Validation and tests

```powershell
npm run check
npm run validate
npm test
```

## Stable hooks and highlights

Flows use `data-guide` hooks rather than generated CSS classes. The accompanying KineX patch adds all hooks used by the suite. See:

- `docs/OrchardWorkbenchCoverage.md`
- `docs/GuideHooks.md`
- `docs/FlowReference.md`
- `docs/Assertions.md`
- `docs/GuideCollections.md`
- `docs/MapReadiness.md`
- `docs/PrintGuide.md`
- `docs/PortalLogin.md`

For headed GIS capture, set `$env:KINEX_GUIDE_PORTAL_EMAIL` (or local `portalLogin.email`) if the ArcGIS/SSO flow requires the email to be entered after clicking Login. Password/MFA remains manual.


## Standard laptop regression

Run the full safe Workbench suite at 1366 x 768 with automatic horizontal-overflow
and overlay-boundary checks:

```powershell
npm run capture:laptop
```

For persistent create/edit/delete verification against a local disposable system,
enable the existing mutation confirmation in `config.json`, then run:

```powershell
npm run capture:laptop:mutations
```

See [docs/LaptopViewportTesting.md](docs/LaptopViewportTesting.md).


### Business Form view control

When a Business Form is visible, every guide capture automatically calls out `[data-guide='business-form-full-screen']`. The label follows the control's current accessible name (`Open full screen` or `Close full screen`), keeping the expand/close icon visible consistently without duplicating flow JSON.

### Draggable and resizable Workbench panels

Every guide capture also calls out the visible Workbench layout handles: the sidebar/work-area resize separator, the map/Business Form resize separator, and the draggable map-toolbar handle. Labels come from their accessible names and the callouts are optional, so focus/map-only layouts do not fail when a handle is intentionally hidden.

### Block-hectares fixture setup and verification boundary

`npm run capture:block-hectares:setup` creates a disposable NZ 2026 Kiwifruit Property → Orchard → four mapped Blocks. It verifies the **initial Block business hectares after GIS publish only**, not the full 12-scenario hectare suite; do not treat a successful capture as evidence that split, MA, override or temporal rules passed. Every run writes a durable JSON manifest under `output/fixture-runs/` even after a failed create/publish step. Failed runs may leave persistent entities; inspect the manifest and clean them up manually before retrying. The geometry has a per-run additional translation but is not guaranteed free of overlaps with unrelated real GIS features.

### JSON-fed end-to-end mutation test

`npm run test:e2e -- --dry-run` previews an explicitly gated end-to-end
Property → Orchard → 4 Blocks → 2 Maturity Areas → MA profile/membership edits
scenario. Set the exact approved test Grower Supplier details in
`scenarios/pin3025-property-orchard-block-ma-e2e.json` before running.
See [MA E2E test mode](docs/MaturityAreaE2ETestMode.md). Runs with
`npm run test:e2e` are intentionally excluded from `capture-all` and mutate data.
