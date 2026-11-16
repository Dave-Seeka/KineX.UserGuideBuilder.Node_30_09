# JSON-driven MA mutation E2E test mode

Runs a **single headed browser session**. The data and MA edit inputs are JSON-fed;
ArcGIS receives EsriJSON geometry through KineX's authenticated completion workflow,
**not** Playwright mouse clicks or direct FeatureServer writes.

## Migration CSV test data (PIN 3025)

The scenario `scenarios/pin3025-property-orchard-block-ma-e2e.json` is now populated
from the four PIN 3025 records in the supplied **2027 CAB review**
`output/cab-2027-review/Orchards/business-gis-block-review.csv` (the
2026-07-01 effective-date dataset). The older 2026 CAB review contains a
different Orchard/physical-area identity and must not be substituted.
It records the original Orchard `31404`, Property GIS GlobalID
`bf2f50b0-53ef-47f1-9eb9-2347417ea477`, **NZ / KIWIFRUIT / season 2027**,
source effective date `2026-07-01`, and these four source identities:

| Source Block | CAB physical ID | Candidate GIS GlobalID | GIS ha | E2E entered ha |
| --- | --- | --- | ---: | ---: |
| 3025_1 | 297807 | `840700ef-3c6e-4fbf-8359-fa15b22d653c` | 0.285932 | 0.29 |
| 3025_2 | 297808 | `f9ff2570-e7c1-43e0-b337-d3be90ba98e2` | 0.613218 | 0.61 |
| 3025_3 | 297809 | `50644169-ae52-43b4-a0e9-f314278c0574` | 1.563477 | **1.50** |
| 3025_4 | 297810 | `db732146-fed4-432f-90e5-b2058ce05773` | 0.704946 | 0.70 |

The scenario also stores each migration `sourceKey`, `sourceHash`, raw GIS status
code (`1`) and a SHA-256 fingerprint of the **source polygon coordinate ring**.
The runner verifies these records and the original Property ring against the
existing fixed-coordinate geometry fixture **before any browser mutations**.
CSV candidate identities remain *unapproved* regardless of spatial containment.

MA 1 uses source Blocks `297807` then `297808`; MA 2 uses `297809` then
`297810`. These are **new test MAs**, not historical CAB MA identities.
Their initial/edited MA codes are unique generated values. The **E2E entered
hectares** (including the deliberate 1.50-versus-1.563477 discrepancy)
are fixture test inputs, not proven historical CAB business-hectare values.

### Fields the supplied migration CSV does not establish

- The test **provisions its own Grower Supplier Entity** using the KineX Entity
  creation UI. It names the record with the configured test prefix and run ID,
  selects the seeded Company Entity type and NZ country, reads KineX's generated code,
  then stages the exact Entity for the Orchard. On the same run ID it reuses
  only an exact active test-owned Entity; it never uses a commercial supplier.
  Entity creation requires `Entity.Entities.Create`, Entity type and Country
  read permissions, plus permissions for Orchard Grower Supply creation.
- A verified Orchard boundary, original street address, MA profiles/assignments,
  Truck access, Variety, Growing Method, Management Type or Cover Status.
- An approved source-to-GIS crosswalk, test-layer write permission, or a
  guaranteed temporal history matching the source effective date.

The Orchard boundary remains the clearly marked synthetic inset. The manual
address is guide-owned test data. Unsourced reference fields use enabled values
from the test tenant and must pass KineX eligibility validation; **GIS status
`1` is not mapped to KineX `PROD`**. The source effective date is recorded as
provenance, not silently imposed on newly created business history.

## Preparation / safeguards

1. Use a disposable KineX test tenant and confirm *written approval* for publishing
   synthetic, duplicate-shape test features at the real PIN 3025 footprint.
   The source CSV contains **no GIS approval** and its Orchard polygon is **derived**, not authoritative.
   If this approval is unavailable, do not run the mutating test. Prefer a dedicated test GIS layer.
2. In `config.json`, set `mutations.enabled=true` and
   `mutations.confirmation="ALLOW KINEX GUIDE MUTATIONS"`.
3. The scenario has `growerSupplier.mode=createOrReuseTestEntity` and
   `entityCode=AUTO`. No separate Grower Supplier setup is needed. The runner
   provisions one through KineX's Entity wizard. Company Entity type, Country, Crop,
   Season, Variety, Growing Method, Management Type, Cover Status, Truck access
   and Grower Supply eligibility must be available in the test tenant. Shared
   reference data is checked/selected, **not rewritten by the test**.
4. After GIS owner approval, explicitly opt in in your PowerShell session:

```powershell
$env:KINEX_PIN3025_TEST_WRITE_APPROVED = 'PIN3025-APPROVED-TEST'
```

The variable is only an *operator confirmation*; it does not grant GIS authorisation.
The runner additionally refuses non-test hosts (`.test`, localhost,
`kinextest.seeka.co.nz`). It **does not automatically retry** a failed E2E mutation,
because saves may already have succeeded.

## Dry run (no browser or writes)

```powershell
npm run test:e2e -- --dry-run
```

## Full mutation test

```powershell
npm run test:e2e
```

To use a different JSON scenario in the same supported PIN 3025 format:

```powershell
npm run test:e2e -- --scenario ./scenarios/my-pin3025-e2e.json
```

## Test sequence

1. Create a test Property and Orchard. Provision an exact, run-owned NZ test Entity, then stage its server-generated
   Entity code during Orchard creation. No arbitrary supplier selection.
2. Publish Property/Orchard EsriJSON. Create four Blocks with the specified
   business hectares; publish all four source-derived EsriJSON Block polygons.
3. Reload each Block and confirm linked geometry and manually entered hectares.
4. Re-select *this run's* Orchard by generated PIN **and** its unique guide name.
5. Create MA #1 from Block 1. Edit the MA code and persist it. Add Block 2
   in the effective-dated Allocation editor and verify both Blocks.
6. Create MA #2 from Block 3. Edit the MA code and persist it. Add Block 4
   and verify both Blocks.

The E2E mode does **not** require a binary shapefile: EsriJSON polygons are read
from `fixtures/block-hectares-pin-3025.json`. The MA polygons themselves are
computed by KineX from assigned Block boundaries; they are **not** injected directly.

The run can leave persisted records if it stops midway. Review
`output/fixture-runs/<runId>.json` and any failure diagnostics. No automatic deletion,
reversion, or non-idempotent replay is attempted. Each full run creates new records.

### Limitations

The new flow is locally tested for JSON validation/composition and reuses the
existing tested Playwright actions. A live run is still needed to verify current
KineX MA wizard selectors, reference-data eligibility, effective dates and ArcGIS
publish behaviour. Real test Grower Supplier, eligibility compatibility and
required KineX/ArcGIS permissions must exist.

Setup records are reported under `provisionedPrerequisites` in the fixture run
manifest. A failed run is not retried automatically; Entity/Orchard/MA writes
may have persisted.

The scenario defines a `testPrefix` (`KINEX-E2E`) used across all newly
created records, even if `config.json` does not have `mutations.testPrefix`.
The runner never creates unmarked test Properties or Orchards.
