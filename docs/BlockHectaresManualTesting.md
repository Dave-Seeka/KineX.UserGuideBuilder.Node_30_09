# Block hectares — manual QA guide

Use this guide to verify that **entered Block hectares remain the authoritative business value**, while GIS-calculated hectares are stored and displayed separately for spatial checking.

The central regression rule is:

> Geometry operations may change GIS hectares, but must never silently change entered/business hectares.

## Test data — PIN 1285-derived E2E Orchard

The source fixture is `fixtures/block-hectares-pin-1285.json`, based on CAB Orchard **31239 / PIN 1285 / Kiwifruit**. Do **not** run the destructive scenarios against the source Orchard. The Guide Builder creates an isolated copy through the real Workbench create and geometry flows.

Enable mutation mode in `config.json`, then run:

```powershell
npm run capture:block-hectares:e2e
```

The flow creates:

- a unique guide-owned Property using a run-specific manual address;
- a unique Kiwifruit Orchard named `... PIN1285 E2E ...`;
- translated Property and Orchard boundaries derived from the source PIN 1285 Block layout;
- four Blocks created in one batch and mapped with translated copies of the source Block polygons.

The 5 km east / 2 km north translation keeps the E2E geometry isolated from the source GIS records while preserving shape and area.

| E2E Block | Source reference | Entered business area | Source-derived GIS area | Role |
| --- | --- | ---: | ---: | --- |
| PIN1285-E2E-1 | PhysicalAreaId `317464`, GIS `ce645a0d-8a37-4d94-9ba9-acb812d9a542` | 1.50 ha | ~1.5043 ha | Control |
| PIN1285-E2E-2 | PhysicalAreaId `317465`, GIS `23a85182-e8b7-4bb5-bc4e-ec54a1b7750d` | 2.59 ha | ~2.5872 ha | Control |
| **PIN1285-E2E-3** | PhysicalAreaId `317466`, GIS `032826d5-7326-473b-8e1b-16720c1925ba` | **3.00 ha** | **~3.3715 ha** | **Primary destructive test Block** |
| PIN1285-E2E-4 | PhysicalAreaId `317467`, GIS `5bdb7ddc-2bb8-4e98-a047-82d8e4d47147` | 2.65 ha | ~2.6491 ha | Control |

### Baseline for the destructive Block

After the setup flow completes, locate **PIN1285-E2E-3** in the newly created E2E Orchard and confirm:

- business hectares = **3.0000 ha**;
- GIS hectares = approximately **3.3715 ha**;
- Blocks 1, 2 and 4 remain available as stable controls.

For split tests, geometry is only a weighting mechanism. The children must always total **3.0000 business ha**, regardless of their measured GIS total. A roughly 25% / 75% geometric split would therefore produce approximately **0.7500 / 2.2500 business ha**.

## 1. Create a Block with entered hectares

1. Use **PIN1285-E2E-3** and confirm its entered/business hectares are **3.0000 ha**.
2. Use its existing boundary measuring approximately **3.3715 ha**, or republish the same geometry.
3. Re-open the Block details.

Expected:

- Block business hectares remain **3.0000 ha**.
- GIS/spatial hectares show approximately **3.3715 ha** separately.
- Publishing the boundary does not replace the entered **3.0000 ha**.

## 2. Reshape an existing Block

1. Start with **PIN1285-E2E-3** showing **3.0000 ha business / ~3.3715 ha GIS**.
2. Reshape the polygon enough for the measured GIS area to change clearly.
3. Save/publish the geometry and re-open the Block.

Expected:

- Business hectares remain **3.0000 ha**.
- GIS hectares update to the new measured value.
- No geometry save silently overwrites the entered value.

## 3. Edit entered hectares after GIS exists

1. Start with a Block that already has a GIS boundary.
2. Edit **PIN1285-E2E-3** business hectares from **3.0000 ha** to **2.9000 ha**.
3. Save the edit.
4. Perform another geometry save or reshape.

Expected:

- Business hectares become **2.9000 ha**.
- GIS hectares remain independent.
- Later geometry operations do not restore or overwrite the business value.

## 4. Apply and remove a manual area override

1. Start with **PIN1285-E2E-3** at **2.9000 ha** entered/business hectares and a different GIS area.
2. Apply a manual area override of **2.8000 ha**.
3. Confirm the effective/displayed business area is **2.8000 ha**.
4. Remove the manual override.

Expected:

- While the override is active, the effective business hectares are **2.8000 ha**.
- Removing the override restores the underlying entered value of **2.9000 ha**.
- Removing the override does **not** replace the business value with the GIS/calculated area.

## 5. Split a Block when entered and GIS hectares differ

1. Start with a parent Block containing:
   - business hectares = **3.0000 ha**
   - GIS hectares = approximately **3.3715 ha**
2. Split the geometry into two obvious unequal parts; a roughly 25% / 75% split is easiest to verify.
3. Complete the split and inspect both child Blocks.

Expected:

- Geometry is used only to determine the split proportions.
- Child business hectares are approximately:
  - child A ≈ **0.7500 ha**
  - child B ≈ **2.2500 ha**
  - use the actual measured GIS proportions if the split is not exactly 25% / 75%
- Child business hectares total exactly **3.0000 ha** at the supported precision.
- Child GIS hectares total approximately the parent GIS area and remain separate from the business values.

## 6. Split a Block with no entered business hectares

1. Use a Block that has a GIS area but no valid entered/business hectare value.
2. Attempt to split the Block.

Expected:

- The split is rejected with validation requiring Block hectares.
- GIS hectares are **not** silently adopted as the business total.

## 7. Edit split-child business hectares

1. Start with PIN1285-E2E-3 split children whose business hectares total **3.0000 ha**, for example **0.7500 + 2.2500**.
2. Attempt to edit only one child so the active child total no longer equals **3.0000 ha**.
3. Confirm the save is rejected.
4. Use the multi-Block/bulk edit path to change both children while preserving the original total, for example **1.0000 + 2.0000 = 3.0000 ha**.

Expected:

- A change that breaks the split-family business-area total is rejected.
- A balanced multi-child update that still totals the original parent hectares succeeds.

## 8. Verify Maturity Area hectares use Block business hectares

1. Assign **PIN1285-E2E-3** with **3.0000 ha business / ~3.3715 ha GIS** to a Maturity Area.
2. Inspect the Maturity Area hectares.
3. Change only the Block geometry so its GIS area changes.

Expected:

- The Maturity Area business hectares use PIN1285-E2E-3's **3.0000 ha** business value, not its **~3.3715 ha GIS**.
- Changing only GIS geometry does not change the Maturity Area business hectares.

## 9. Recalculate Maturity Area hectares after a Block business edit

1. Use a Block assigned to a Maturity Area.
2. Change **PIN1285-E2E-3** business hectares from **3.0000 ha** to **2.9000 ha** with an appropriate effective date.
3. Inspect the Maturity Area at and after that effective date.

Expected:

- The Maturity Area recalculates using **2.9000 ha** from the effective date.
- Historical views before that date retain the previous value.

## 10. Publish or reshape Maturity Area geometry

1. Use a Maturity Area whose business total comes from assigned Blocks.
2. Publish or reshape its GIS polygon so the measured GIS area differs from the business total.
3. Re-open the Maturity Area.

Expected:

- MA GIS/spatial hectares update from the polygon.
- MA business hectares remain derived from assigned Block business hectares.
- GIS publication does not overwrite the MA business total.

## 11. Undo a physical Block split

1. Split a Block whose business hectares differ from its GIS hectares.
2. Without making later child changes that would make Undo unavailable, undo the split.
3. Inspect the restored Block.

Expected:

- The restored Block receives the original parent **business hectares**.
- Restored GIS hectares reflect the restored polygon separately.
- The GIS measurement does not become the restored business value.

## 12. Rejoin split Blocks next season

1. Use a valid split lineage that is eligible to rejoin at the next season boundary.
2. Rejoin the children.
3. Inspect the rejoined Block and its geometry.

Expected:

- The rejoined Block restores the original parent business hectares.
- GIS/spatial hectares are populated separately from the rejoined geometry.
- The measured GIS value does not replace the restored business value.

## Regression checklist

Before signing off the change, confirm all of the following:

- Entered Block hectares remain authoritative by default.
- GIS hectares are visible/stored separately and can differ from business hectares.
- Geometry create/edit/publish does not overwrite entered hectares.
- Missing business hectares never fall back silently to GIS hectares.
- Split allocations conserve the parent business-hectare total.
- Later active split-child edits continue to conserve that total.
- Manual override removal returns to the underlying entered value.
- Maturity Area business hectares are calculated from Block business hectares.
- Block business edits recalculate affected Maturity Areas temporally.
- MA geometry publication does not overwrite the MA business total.
- Split undo and rejoin restore business hectares independently from GIS measurements.

### Automated setup versus regression coverage

`npm run capture:block-hectares:setup` creates the test hierarchy and publishes six boundaries using the Workbench UI. It does **not** execute the manual hectare, split, override, MA or rejoin regressions above. Confirm baseline business/GIS values and run those scenarios separately. Each setup attempt leaves `output/fixture-runs/<runId>.json` including the generated Orchard PIN and failed/completed stage. No automated cleanup is attempted: geometry and temporal records must be inspected before deletion.

### Automated ArcGIS drawing diagnostics

The E2E setup uses actual SketchViewModel pointer input, not a direct ArcGIS feature write. Before each polygon, Guide Builder identifies the Workbench map and active capture session, projects NZTM coordinates to the map view's spatial reference if needed, frames vertices away from floating controls, and confirms that each click increments the committed-vertex count.

If drawing stops, the error now identifies the polygon and the affected vertex. **Do not retry the same run blindly after a partial publish:** use the generated fixture-run manifest to identify the Property/Orchard created in that run. A blocked canvas requires exposing the map or moving the toolbar; a missing capture session indicates the geometry editor never started; a disabled Done button with all vertices registered indicates spatial-validation or geometry-completion feedback in the Workbench toolbar. This automated stage still requires live KineX + ArcGIS credentials and does not cover split, MA or rejoin mutations.
