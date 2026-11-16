# UI assertions and toast checks

Assertions verify that the UI outcome shown in a guide is real. Put assertion actions in a step's `checks` array. They execute after normal actions and before the screenshot. Successful assertions are written into Markdown, HTML, PDF and manifest output under **Verified**.

## Supported checks

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

All checks support `label` and `timeoutMs`. A failed required check fails the guide. Set `optional: true` only when the outcome is genuinely optional.

## Visibility and state

```json
{
  "type": "assertVisible",
  "label": "Review step opened",
  "locator": { "selector": "[data-guide='orchard-review-step']" },
  "timeoutMs": 10000
}
```

```json
{
  "type": "assertDisabled",
  "label": "Continue remains blocked",
  "locator": { "role": "button", "name": "Continue", "exact": true }
}
```

## Text and values

Use one of `text`, `exactText`, `contains` or `matches`.

```json
{
  "type": "assertText",
  "label": "Validation message",
  "locator": { "role": "alert" },
  "contains": "Orchard name is required"
}
```

```json
{
  "type": "assertValue",
  "label": "Orchard name retained",
  "locator": { "label": "Orchard name" },
  "contains": "Guide Orchard"
}
```

## Counts

Use `count`, `min` or `max`. Set `visibleOnly` when hidden responsive duplicates should not count.

```json
{
  "type": "assertCount",
  "label": "Orchards available",
  "locator": { "selector": "[data-guide='orchard-select']" },
  "min": 1,
  "visibleOnly": true
}
```

## Attribute checks

Use `assertAttribute` for selected, expanded, checked and pressed states that are exposed through ARIA or data attributes.

```json
{
  "type": "assertAttribute",
  "label": "Orchard selection tool active",
  "locator": { "selector": "[data-guide='map-select-orchard']" },
  "name": "aria-checked",
  "value": "true"
}
```

Expectations may use `value`, `exact`, `contains` or `matches`.

## URL checks

```json
{
  "type": "assertUrl",
  "label": "Workbench route",
  "contains": "/arcgis/orchard-workbench"
}
```

## Toast checks

`assertToast` searches configured toast selectors until a visible candidate matches. Specify text or a locator so a normal loading/status message cannot be mistaken for a toast.

```json
{
  "type": "assertToast",
  "label": "Save notification",
  "contains": "saved successfully",
  "tone": "success",
  "timeoutMs": 15000
}
```

Supported tone aliases are whatever the rendered toast exposes through classes or `data-tone`, `data-severity` or `data-type`, commonly `success`, `info`, `warning` and `error`.

To verify automatic dismissal:

```json
{
  "type": "assertToast",
  "contains": "saved successfully",
  "tone": "success",
  "waitForDismiss": true,
  "dismissedWithinMs": 10000
}
```

To verify that a known error toast does not appear during a stability window:

```json
{
  "type": "assertNoToast",
  "label": "No save error",
  "contains": "Unable to save",
  "durationMs": 2500
}
```

## Toast selector configuration

The defaults include KineX/Syncfusion-style toast classes and accessible alert/status roles. Override them when the shared `UiToast` markup has a stable hook:

```json
"toast": {
  "timeoutMs": 10000,
  "dismissTimeoutMs": 10000,
  "selectors": [
    "[data-guide='toast']",
    ".ui-toast",
    ".e-toast"
  ]
}
```

A dedicated `data-guide='toast'` hook is preferable to generic `role='status'` matching.


## Custom toast settings

`config.json` may override toast selectors and timing. Version 1.3.2 correctly merges these values with defaults:

```json
"toast": {
  "timeoutMs": 15000,
  "dismissTimeoutMs": 12000,
  "selectors": [
    "[data-guide='toast']",
    ".ui-toast"
  ]
}
```
