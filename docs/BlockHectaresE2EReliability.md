# Block-hectares E2E: publication and failure diagnostics

`npm run capture:block-hectares:e2e` creates persistent KineX and ArcGIS test data. Use only in a disposable test environment. It currently proves the Workbench UI geometry workflow and saved business-hectare preservation, **not** split/undo/rejoin or MA regression cases.

## Publication checkpoints

1. After new Property/Orchard creation, confirm the pending Property-first geometry sequence. This is *not* proof of geometry publication.
2. After Property **Done**, require KineX to advance to the Orchard geometry task, or to the Orchard geometry-choice drawer explicitly marking its parent as linked. A still-visible Property task, an incomplete parent status, and toast notifications are not accepted.
3. After Orchard **Done**, require the selected Orchard business form to show a linked ArcGIS status (the linked header indicator or Overview status). A closed sketch panel alone is not enough.
4. After the four Block geometries, reselect each Block, confirm the correct Block name and linked ArcGIS status, and then check the persisted business hectares: 1.50, 2.59, 3.00 and 2.65.

The geometry drawer and business-form indicators come from KineX's own Workbench markup. The Property-to-Orchard successor transition is server-driven; it provides evidence of successful advancement, but isn't a direct independent ArcGIS FeatureServer read-back.

## Continuous MultiBlock EsriJSON hand-off

After each Block's geometry is published, KineX automatically advances to the next
Block and starts a new polygon capture. Guide Builder must verify the panel's
`Block N of 4` text **and** that a new, distinct capture session is active before
injecting the next EsriJSON polygon. The geometry toolbar's Done-button enabled
state is not a valid batch-transition signal. If a successor is not ready, stop
without delivering a polygon to a different Block.

## Failure artifacts

Failures save `output/fixture-runs/<runId>.json`, `<runId>-failure.json`, and `<runId>-failure.png` when the browser permits screenshots. These include the failing step/action, completed publication checkpoints, selected business form and linked/pending status, active task, Done state, MapView spatial reference/extent/scale/stationary/updating state, visible map errors and active sketch vertex count. The collector does not serialize cookies, portal tokens, network headers or local storage. Artifacts can contain sensitive *visible screen content* and should remain local.

A failed run may leave persistent KineX and ArcGIS records. Inspect the manifest and test environment before retrying. The runner doesn't delete/reuse fixtures automatically.

## Separate API-backed area regression path — follow-on work

KineX provides a server-mediated `POST /business-model-records/{id:guid}/geometry` route under its versioned ArcGIS business-model API group (`ApplyBusinessModelGeometryRequest` with a `Geometry` JSON object). The endpoint uses ArcGIS business-model edit permission, portal-token resolution, server validation and publication/outbox processing.

A future *independent* hectare-regression fixture runner can create/select records with known IDs, call the supported API through a correctly authenticated client, confirm the resulting linked geometry, and run area/split/override/MA assertions. Do not call ArcGIS FeatureServer `applyEdits` from the browser or write direct SQL as an alternative. The endpoint's exact route prefix, identity mapping, creation prerequisites and Auth0/ArcGIS permission boundary must be confirmed against the deployed API before making that runner executable. **No API-backed mutation runner is implemented by this patch.**

## Fixture map locality (black-map safeguard)

The original PIN 1285 geometry in EPSG:2193 is near Northland, but the test's manually entered Property address is Te Puke. Panning to the unmodified source polygons could leave the authored WebMap's imagery coverage and render a blank/black map. The fixture now translates the *entire* source-derived Property, Orchard and four Blocks into a bounded synthetic Te Puke test location (`fixtures/block-hectares-pin-1285.json` → `e2e.targetPlacement`). A deterministic run offset varies by at most 3.9 km. This preserves relative boundaries, containment and planar geometry hectares.

`preflightFixturePlacement` validates all six rings **before** creating any new KineX records. `drawFixturePolygon` validates the target again before calling `MapView.goTo`. The MapView error state is checked after navigation, but this cannot prove the basemap tile imagery is available. If the map still turns black, inspect the saved screenshot and ArcGIS console/requests, rather than permitting more blind retries. Do not use this synthetic location outside a disposable test environment.


## Programmatic EsriJSON fixture capture (experimental)

The `295-block-hectares-e2e-fixture.json` flow now uses `injectFixturePolygon`
for Property, Orchard and the four Blocks. Each source-derived ring is
translated into the configured Te Puke test region, checked for at least
three distinct vertices and nonzero area, closed, and wrapped in EsriJSON with
`spatialReference: { wkid: 2193 }`. It does not require a `.shp` binary or
Playwright map clicks.

The adapter runs only against `localhost`, `127.0.0.1`, `::1`, `*.localhost`,
and `*.test`. It requires one active, unsettled KineX polygon capture. It
resolves the existing browser-side geometry completion contract with EsriJSON
and disposes the SketchViewModel; the pending Workbench operation then calls
its normal authenticated `PublishSpatialEntityAsync` server path. The existing
publication checkpoints still require linked Property, Orchard and Block
geometry. No direct FeatureServer calls or tokens are introduced.

**Limitation:** This is an internal, version-sensitive testing adapter. It
**does not run the live Sketch pre-save containment or overlap preview**. The
server's validation must reject invalid geometry; a failed publish remains
a hard E2E failure. It also does not test mouse-driven drawing. Keep a separate
UI drawing smoke test for that behaviour. An officially supported KineX
fixture-import/pre-fill contract should replace this adapter long-term.


## PIN 3025 fixed GIS candidate (approval pending)

The `295-block-hectares-e2e-fixture.json` flow now references
`fixtures/block-hectares-pin-3025.json`, based on four records in
`business-gis-block-review(1).csv`. The Property and four Block polygons are
unchanged EPSG:2193 source rings. **No run-ID offsets or translations.**

The source has no Orchard polygon; the fixture derives an inset of the Property
(0.995 scale about centroid). This is *test-only synthetic Orchard geometry*, not
a CAB or GIS-approved Orchard boundary. All source Blocks are contained by it.
The CSV records no explicit permission to write test data at this location.
Creation/injection is therefore refused by default until the operator has
obtained permission for a disposable test layer and explicitly sets
`KINEX_PIN3025_TEST_WRITE_APPROVED=PIN3025-APPROVED-TEST`. This is an opt-in,
not proof of approval. This flow still creates *new* records; reruns are not
idempotent and must be reviewed for overlap/conflicts.

### Verify existing Blocks without recreation

To resume after a Step 5-only failure, use the Orchard PIN shown in the
`output/fixture-runs/<runId>.json` manifest (`selectedPin`) and the block
name prefix used for the previous run. Example for earlier PIN 1285 runs:

```powershell
npm run capture:block-hectares:e2e -- --verify-only --orchard-pin <ACTUAL_PIN> --block-prefix PIN1285-E2E- --expected-hectares 1.50,2.59,3.00,2.65
```

This option **does not run Steps 1-4**, does not apply PIN3025 geometry to the
existing records, and does not need a PIN3025 write acknowledgement. It only checks the existing business hectare values. `--expected-hectares`
overrides the new PIN3025 values when verifying a previous PIN1285 run.

## Form timing (PIN 3025 fixture)

The fixture performs one explicit readiness check after navigation instead of
letting `goto` and `waitForMapReady` each apply an 8-second settle. The two
explicit checks now use a 1.5-second settle **and recheck the map canvas**.
Routine form fields/dropdowns use 12-second maximum timeouts (these are
**failure deadlines**, not fixed delays). Server-dependent continue/submit,
KineX validation, geometry publication, and ArcGIS readiness deadlines are
unchanged.

Third-party combobox visual-value feedback is best-effort for up to 1.2 seconds
(previously up to 20-30 seconds), while the next form readiness check remains
authoritative. The keyboard fallback attempt is capped at 2 seconds.
When a fixture action exceeds 2 seconds, the console prints a `Slow fixture
action` line with its action type and a static data-guide hook (when available)
for identifying the remaining wait. Input values, auth tokens and passwords
are never logged by this timing instrumentation.
