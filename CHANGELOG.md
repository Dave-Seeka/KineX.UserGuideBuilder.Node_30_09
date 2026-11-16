# Changelog
- Hardened Block-hectares E2E fixture: NZ/2026 Kiwifruit scope, entity-aware ArcGIS transitions, unique-run polygons and PINs, recovery manifests and saved business-area assertions.

- Added the PIN 1285 / Orchard 31239 Kiwifruit fixture for Block-hectare regression testing, including the four GIS-linked Blocks, designated destructive Block 3, 3.0000 ha business baseline, and reusable `guideData` identifiers.

## 2026-10-05 - Saved Split/Select Pick capture flows

- Added `docs/BlockHectaresManualTesting.md` with manual regression steps for authoritative entered Block hectares, separate GIS area, split conservation, MA recalculation, undo and rejoin.

- Added guarded mutation captures that add a second allocation and save both Split Pick and Select Pick strategies.
- Capture the completed 100% allocation before Apply and the saved strategy confirmation after the drawer closes.
- Keep the existing safe Split/Select review flows unchanged for non-destructive publication runs.
- Expanded the ordered suite to 70 flows: 61 safe and 9 guarded mutation flows.

## 1.7.0

- Brought the guide suite up to date with the full Orchard Workbench: Property, Orchard, Maturity Area, Block and multi-Block navigation.
- Added canonical Overview / Allocation / Activity Business Form coverage and the separate action ribbon/focus experience.
- Added Create/Edit Maturity Area and Block-to-MA assignment guides.
- Added dedicated Split Pick and Select Pick safe flows, plus Pick-strategy indicators, Activity/reversal review and Clearance / CTP presentation.
- Added physical Split Block / Undo split / Rejoin next season action coverage.
- Updated effective-dated edit, geometry and Block-create flows to current Workbench contracts.
- Refreshed navigator/filter/create flow contracts for the current Workbench tabs, map-status popovers and custom dropdowns.
- Updated guarded mutation flows for effective-date scheduling and auto-generated Block codes.
- Expanded the ordered suite to 68 flows: 61 safe and 7 guarded mutation flows.
- Removed stale Workbench selectors and regenerated the complete safe collection from the current flow set.
- Added automatic guide callouts for visible Workbench resize separators and the draggable map-toolbar handle, alongside the Business Form full-screen control.
- Added per-flow transient UI recovery so failed create/edit/geometry guides cannot leave a dialog blocking the next flow, and hardened rerender-prone navigator/create actions.

## 1.5.0

- Expanded the ordered Orchard Workbench suite to 50 flows: 43 safe publication flows and 7 guarded mutation checks.
- Added smoke, core, full, mutation and all profiles with profile-specific combined manuals.
- Added coverage HTML, Markdown and JSON reports with generated, gated, failed and excluded counts.
- Added search/no-results, linked/unlinked filters, map navigation, auto-select, toolbar movement/collapse, basemap changes, layer visibility, record-state, validation, backward navigation and cancel flows.
- Added guarded Orchard/Block create, Orchard/Block/Property edit and Block/Orchard delete toast verification.
- Added exact mutation confirmation and guide-owned record prefixes to reduce accidental test-data changes.
- Added drag, runtime-value capture and attribute assertions.
- Added KineX v3 guide hooks for map options, form state, errors, toolbar controls, toast host and editable field containers.
- Added full-coverage fixture documentation and a generated capability matrix.

## 1.4.0

- Add a second portrait, print-first manual alongside the existing interactive joined guide.
- Generate `guide-print.html`, `guide-print.md` and `guide-print.pdf` automatically.
- Use continuous numbered instructions with screenshots directly beneath each step.
- Keep assertion evidence and blank-image links out of the end-user print layout.
- Render Tip, Alert and note callouts with print-friendly highlighted backgrounds.
- Allow annotated or blank screenshots in the print manual through `printGuide.imageVariant`.
- Keep the existing landscape guide output unchanged.

## 1.3.3

- Added configurable ArcGIS map readiness waiting before every Orchard Workbench flow continues after navigation.
- Increased the default map-load allowance to 120 seconds with an additional 8-second render-settle window.
- Waits for the rendered ArcGIS surface/canvas and an enabled Home map tool instead of treating the outer map panel as ready.
- Added the explicit `waitForMapReady` action and per-`goto` `waitForMapReady: false` opt-out.
- Added map-load diagnostics showing ready controls, surfaces, canvases and any ArcGIS error text when the timeout expires.
- Added configuration and readiness regression tests.

## 1.3.2

- Fixed create-flow verification checks to use the rendered entity-specific review hooks (`orchard-review-step` and `block-review-step`).
- Added a configurable cooldown and authenticated-context restart after create-form throttling or temporary create-action unavailability.
- Added preflight checks for Create Orchard so throttled or unavailable actions skip cleanly instead of timing out.
- Fixed custom `toast` selectors and timeout settings being ignored during config merging.
- Fixed backward-compatible config aliases from overwriting defaults with `undefined` when omitted.
- Added regression tests for create-flow review hooks, toast config merging and rate-limit classification.

## 1.3.1

- Added a blank screenshot without guide overlays for every captured step by default.
- Added configurable `screenshot.blank` and `screenshot.blankSuffix` settings.
- Added per-step `capture.blank` and `capture.blankFile` overrides.
- Added blank screenshot links to individual Markdown and HTML guides.
- Added blank image copying, links and manifest paths to joined manuals.
- Kept blank screenshots out of the PDF page flow to avoid doubling manual length.
- Added validation and tests for blank screenshot naming, capture and collection joining.

## 1.3.0

- Added JSON guide collections that join selected guide outputs into one standalone manual.
- Added combined cover, contents, chapter structure, continuous or per-guide numbering, copied images and coverage notes.
- Added `join` CLI command and `npm run join` for rebuilding manuals without browser capture.
- Added automatic collection generation after `capture:all`.
- Added first-class UI assertions recorded as **Verified** evidence in Markdown, HTML, PDF and manifests.
- Added visibility, hidden, enabled, disabled, text, value, count and URL assertions.
- Added toast message, tone/severity, dismissal and no-toast assertions.
- Added configurable toast selectors and assertion timing.
- Added flow and collection validation for the new schema.
- Added built-in tests for toast assertions and joined-manual generation.

## 1.2.2

- Prefer keyboard selection for portalled dropdowns and force-click only the verified visible option as a fallback.
- Skip create guides cleanly when KineX reports that create-form options are temporarily rate limited.
- Restart the authenticated browser context after any failed flow so one broken drawer or ArcGIS page cannot poison the remaining suite.
- Retry navigation and Workbench-root timeouts once in a fresh browser context.
- Publish each guide atomically from a staging directory and remove stale output for failed or skipped flows.
- Clear the complete output directory at the start of `capture:all`.
- Ignore legacy unnumbered starter/demo flows when the ordered Orchard Workbench suite is present.
- Strip Playwright ANSI terminal formatting from generated summaries and indexes.

## 1.2.1

- Fixed root-level `nth` action selection; repeated controls now click the intended item.
- Added `clickIfVisible` for quiet, bounded cleanup actions.
- Added `clickCandidateUntil` so Block guides locate an Orchard with the required number of Blocks.
- Fixed ArcGIS address lookup to target the visible search box instead of Calcite's hidden form input.
- Added one-time browser/context recovery during `capture:all`.
- Prevented closed pages from masking the original flow error during cleanup.

## 1.2.0

- Added a 20-flow Orchard Workbench guide suite.
- Added flow categories, ordering, prerequisites and non-destructive safety notes.
- Added `require` actions that skip flows when permissions or environment data are unavailable.
- Added optional actions, `clickFirst`, `fillFromText` and runtime/config value templates.
- Added a generated guide index and machine-readable capture summary.
- Added configurable continuation after unexpected flow failures in `capture:all`.
- Added guide data defaults for Property, Orchard, Block and address examples.
- Added the matching KineX `data-guide` hook patch and coverage documentation.
- Fixed PDF generation so local screenshots are loaded from the generated guide directory.

## 1.1.3

- Fixed Create Orchard so it selects an existing parent Property before Continue.
- Added `selectFirstOption` for native and Syncfusion-style dropdowns.
- Added `waitForEnabled` diagnostics.

## 1.1.2

- Stabilized highlight boxes across Blazor re-renders.
- Added first-visible matching and per-highlight `boxTimeoutMs`.
- Added a guarded `block-hectares-e2e-fixture` flow that creates a Property, Kiwifruit Orchard and four mapped Blocks from the PIN 1285 fixture through the real Workbench UI.
- Added `drawFixturePolygon` for source-derived NZTM polygon drawing and isolated E2E geometry publication.
- Added `npm run capture:block-hectares:e2e` for the targeted fixture setup.
