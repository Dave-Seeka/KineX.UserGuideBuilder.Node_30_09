# KineX Orchard Workbench guide hooks

Version 1.7.0 targets the **native current Workbench hooks**. A separate compatibility patch is no longer part of the guide-builder contract.

## Hook rules

- Put hooks on visible, non-zero-size elements.
- Prefer semantic `data-guide` names that survive layout and copy changes.
- Use role/name locators for canonical tabs and dialog actions where accessibility text is itself the user contract.
- Keep repeated row hooks identical and use `nth` only in flows.
- Never encode database IDs or customer data into guide selectors.

## Canonical Workbench groups used by 1.7.0

### Navigators

- `property-navigator`, `property-search`
- `orchard-navigator`, `orchard-search`, `open-blocks`
- `maturity-area-navigator`, `maturity-area-search`, `maturity-area-groups`
- `block-navigator`, `block-search`, `block-toggle`, `select-all-blocks`

### Business Form shell

- `business-form-shell` with `data-guide-entity`, `data-guide-mode`, `data-guide-tab` and `data-guide-full-screen`
- `business-form-action-ribbon`, `business-edit-action`, `business-boundary-action`
- `business-form-content` (Overview), `business-form-allocation-content`, `business-form-activity-content`
- `business-form-full-screen`, `business-form-context-rail`, `business-focus-full-gis`
- `schedule-change-modal`, `business-edit-cancel`, `business-edit-save`

### Maturity Area and Pick strategy

- `ma-blocks-tab`, `ma-bf-clearance-ctp`, `ma-block-pick-strategy-indicator`
- `ma-allocation-drawer` with `data-guide-strategy="split|select"`, `split-pick-total`, `select-pick-total`
- `pick-strategy-reference`, `reverse-select-pick`, `select-pick-reversal-drawer`
- `multi-block-table-secondary-action`, `multi-block-table-tertiary-action`, `multi-block-table-quaternary-action`, `multi-block-table-additional-action`

### Create MA / Block

- `context-create-ma`, `maturity-area-parent-context`, `maturity-area-grower-supply`, `maturity-area-block-list`, `ma-review-step`
- `block-parent-context`, `block-code` (auto-generated display), `block-name`, `block-monitoring`, `block-review-step`

### Map and lifecycle

- `map-layers-menu-button`, `map-layers-menu`, `map-indicator-pick-strategies`
- `workbench-map-toolbar-drag` for the draggable map toolbar
- accessible separators `Resize sidebar and work area` and `Resize map and business form` for Workbench panel resizing
- `geometry-choice`, `geometry-draw`, `geometry-task-panel`, `geometry-task-cancel`, `geometry-edit-actions`

## Retired selectors

1.7.0 must not use the former `context-edit-action`, `edit-property`, `select-visible-blocks`, `multi-block-panel`, `multi-block-summary*`, `multi-block-set-primary`, `multi-block-remove`, `block-season-context` or `geometry-link-unavailable` hooks.
