# Flow reference

Each JSON flow contains metadata, prerequisites, optional cleanup actions and ordered screenshot steps.

```json
{
  "id": "create-block",
  "title": "Create a Block",
  "category": "Create records",
  "order": 120,
  "profiles": ["core", "full"],
  "mutation": false,
  "coverage": { "capability": "Create a Block", "mode": "safe", "dataGated": true },
  "safety": "This guide does not save, publish or delete records.",
  "prerequisites": ["Permission to create Blocks."],
  "cleanupActions": [],
  "steps": []
}
```

## Step fields

- `heading`: generated section heading.
- `instruction`: user-facing instruction.
- `notes`: optional callouts.
- `actions`: browser actions before capture.
- `readyWhen`: optional locator required before capture.
- `capture.file`: output PNG filename.
- `capture.highlights`: numbered critical-element boxes.
- `capture.blank`: optional per-step override for the blank screenshot.
- `capture.blankFile`: optional explicit blank screenshot filename.

## Locators

```json
{ "selector": "[data-guide='create-orchard']" }
{ "role": "button", "name": "Continue", "exact": true }
{ "label": "Orchard name" }
{ "placeholder": "Search blocks" }
{ "text": "Review" }
{ "selector": "[data-guide='block-toggle']", "nth": 1 }
```

Prefer `data-guide` selectors. Use `nth` only for repeated environment data such as the first two Block rows.

## Actions

Supported actions:

- `goto`
- `click`
- `clickFirst`
- `clickIfVisible`
- `clickCandidateUntil`
- `fill`
- `fillFromText`
- `selectOption`
- `selectFirstOption`
- `check` / `uncheck`
- `press`
- `hover`
- `dragBy`
- `rememberText` / `rememberValue`
- `scrollIntoView`
- `waitFor`
- `waitForEnabled`
- `require`
- `skipIfVisible`
- `waitForLoadState`
- `waitForTimeout`
- `waitForMapReady`
- `setViewport`
- `evaluate`

Use `clickIfVisible` for optional cleanup controls. It waits briefly, clicks the first visible enabled match, and returns without logging when the target is absent. `optional: true` remains available for other conditional action types.

### Find an Orchard with Blocks

`clickCandidateUntil` tries candidate controls in order, checks whether each reveals enough target rows, and returns to the original list before trying the next candidate:

```json
{
  "type": "clickCandidateUntil",
  "locator": { "selector": "[data-guide='open-blocks']" },
  "successLocator": { "selector": "[data-guide='block-select']" },
  "resetLocator": { "selector": "[data-guide='back-to-orchards']" },
  "returnLocator": { "selector": "[data-guide='orchard-navigator']" },
  "minCount": 1,
  "perCandidateTimeoutMs": 4000,
  "timeoutMs": 45000,
  "message": "No Orchard with Blocks is available."
}
```

### Repeated action targets

Action-level `nth` is zero-based and is applied after resolving the locator:

```json
{
  "type": "click",
  "locator": { "selector": "[data-guide='block-toggle']" },
  "nth": 1
}
```

### Skip a flow when data is unavailable

`require` throws a flow-skip outcome rather than failing the complete suite:

```json
{
  "type": "require",
  "locator": { "selector": "[data-guide='block-toggle']" },
  "minCount": 2,
  "timeoutMs": 10000,
  "message": "At least two Blocks are required."
}
```


### Skip a flow when a blocking message is shown

`skipIfVisible` is useful for transient rate-limit and unavailable-service messages:

```json
{
  "type": "skipIfVisible",
  "locator": { "text": "Create-form options are temporarily rate limited" },
  "message": "Create-form options are temporarily rate limited. Try again shortly.",
  "timeoutMs": 2000
}
```

### Select environment-dependent options

```json
{
  "type": "selectFirstOption",
  "locator": { "selector": "[data-guide='property-selector']" },
  "timeoutMs": 30000
}
```

This supports native `<select>` elements and Syncfusion/ARIA comboboxes. Portalled comboboxes are selected by keyboard first; a forced option click is used only after the option has been verified as visible and enabled.

### Wait for the ArcGIS map

Workbench `goto` actions automatically wait for map readiness unless the action sets `"waitForMapReady": false`. Readiness requires the ArcGIS surface/canvas and an enabled Home tool, followed by the configured settle period.

Use an explicit action after an interaction that causes the map to reload or redraw:

```json
{
  "type": "waitForMapReady",
  "timeoutMs": 120000,
  "settleMs": 8000
}
```

Global defaults are under `map` in `config.json`. A timeout includes diagnostics for the matched/enabled ready control, ArcGIS surfaces, canvases and visible map error text.

### Wait for Blazor validation

```json
{
  "type": "waitForEnabled",
  "locator": { "selector": "[data-guide='create-continue-action'] button" },
  "timeoutMs": 30000
}
```

### Runtime values

String action values support:

- `{{runId}}`
- `{{flowId}}`
- `{{date}}`
- `{{timestamp}}`
- `{{guideData.orchardPin}}` and other `guideData` config values
- `{{mutations.testPrefix}}` and other mutation settings
- values captured by `rememberText` or `rememberValue`

## Highlight boxes

```json
{
  "locator": { "selector": "[data-guide='orchard-pin']" },
  "label": "Enter Orchard PIN",
  "number": 1,
  "color": "#d92d20",
  "padding": 8,
  "lineWidth": 4,
  "boxTimeoutMs": 10000,
  "optional": false
}
```

Target a real rendered element. When a `data-guide` hook is on a `display: contents` wrapper, include its child button in the selector.


## Blank screenshots

The builder captures an unannotated screenshot immediately after removing the guide highlight overlays. The default filename inserts `-blank` before the extension:

```text
review.png
review-blank.png
```

Global defaults are configured under `screenshot`:

```json
{
  "screenshot": {
    "blank": true,
    "blankSuffix": "-blank"
  }
}
```

Override one step when needed:

```json
"capture": {
  "file": "review.png",
  "blankFile": "review-clean.png",
  "highlights": []
}
```

Set `"blank": false` on the capture to produce only the annotated image. Blank images are recorded in each guide manifest and copied into joined manuals.

## Capture-all publication behaviour

`capture:all` clears the configured output directory before starting, writes each guide to a staging directory, and publishes it only after every step and PDF completes. Failed or skipped flows therefore cannot leave stale guides from an earlier run. When ordered `NNN-name.json` flows are present, unnumbered legacy starter/demo files are ignored.

## Checks and assertions

A step may include a `checks` array after its normal actions. Checks run before capture and successful results appear under **Verified** in the generated guide.

```json
{
  "heading": "Review the Orchard",
  "instruction": "Confirm the record before submission.",
  "actions": [],
  "checks": [
    {
      "type": "assertVisible",
      "label": "Review step opened",
      "locator": { "selector": "[data-guide='orchard-review-step']" }
    },
    {
      "type": "assertDisabled",
      "label": "Submit remains unavailable",
      "locator": { "role": "button", "name": "Submit", "exact": true }
    }
  ],
  "capture": {
    "file": "review.png",
    "highlights": []
  }
}
```

Assertion action types are:

- `assertVisible`
- `assertHidden`
- `assertEnabled`
- `assertDisabled`
- `assertText`
- `assertValue`
- `assertCount`
- `assertAttribute`
- `assertUrl`
- `assertToast`
- `assertNoToast`

Assertions can also appear in `actions` when the check must happen at a precise point between interactions. Prefer `checks` when verification should happen immediately before the screenshot.

See `docs/Assertions.md` for toast matching, dismissal checks, count comparisons and examples.

## Combined manuals

Guide joining is configured separately in `collections/*.json`. `capture:all` automatically joins configured collections after individual guide capture. Run `npm run join` to rebuild combined manuals without recapturing screenshots.

See `docs/GuideCollections.md`.

## Profiles and mutation guards

Each flow declares one or more profiles:

```json
"profiles": ["smoke", "core", "full"],
"mutation": false
```

Supported profiles are `smoke`, `core`, `full`, `mutation` and `all`. Mutation flows must set `mutation: true`; they are excluded unless the active profile includes them and the exact confirmation guard is enabled in `config.json`.

## Drag and runtime capture

```json
{
  "type": "dragBy",
  "locator": { "selector": "[data-guide='workbench-map-toolbar-drag']" },
  "deltaX": 160,
  "deltaY": 80,
  "steps": 10,
  "settleMs": 500
}
```

```json
{
  "type": "rememberValue",
  "key": "originalName",
  "locator": { "selector": "[data-guide='orchard-name'] input" }
}
```

A later value may use `{{originalName}}` to restore the original record safely.
