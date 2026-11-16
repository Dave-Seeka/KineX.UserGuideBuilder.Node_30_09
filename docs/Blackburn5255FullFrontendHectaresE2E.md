# Blackburn PIN 5255 — full browser MA + physical Block split + hectare regression

**Scope:** OMD-1638 / OMD-1649, NZ / Kiwifruit / 2027, existing Blackburn Orchard PIN `5255`. The runner **reuses the existing Property, Orchard and Blocks**, but **creates two test Maturity Areas from the frontend** when they do not already exist. It never silently creates another Orchard or Block and never sends business writes directly to the KineX API. It is not E2E-07 Select Pick/Split Pick.

## Browser E2E phases

1. Resolve the exact existing Blackburn Orchard, season and its Block list using authenticated **API GET** only. Identify the source mapped Block and a *different* eligible unassigned Block for the second MA.
2. For MA #1 and MA #2, open **Blackburn → Create Maturity Area**, fill its unique test code, effective date, Truck access and active Grower Supply, select the specific Block in the eligibility group, review and submit **through the Workbench**. Record intent immediately before each Create click.
3. Re-read each saved MA from KineX, verify its Orchard and exact Block membership, and capture MA effective (business) and GIS hectares for the test report.
4. In MA #1's Allocation, confirm the source is mapped and **Split Block**, not Split Pick, is available. Open the Block form and apply an explicitly entered hectare value using **Manual override**. Verify the API persists this business value and the GIS value did not change.
5. Return to MA #1. Open **Split Block**, choose a split date later than the source effective-from, draw a real line through the browser map, review exactly two preview polygons and click **Confirm split**.
6. Verify the parent has retired on the split date, two persisted children have the correct lineage and date, child business hectares sum exactly to the parent's *entered* hectares to 4 decimal places, GIS hectare measurements remain separate, unaffected Blocks retain their areas, and the MA Allocation table shows the saved children.
7. Capture screenshots and a durable journal. Use **verify** to inspect a possibly committed split without sending more writes.

The MA's business and spatial hectares are reported separately. A conservation-preserving split checks that the MA effective area does not change between the manual-area date and split date when both measurements are available. **The full MA derivation rule remains a separate business decision in OMD-1649; this test does not silently assert that all MA area totals are always the sum of Block business hectares.**

## Data expectations and safeguards

- Existing Blackburn PIN `5255`, active season 2027, valid mapped source **active leaf Block** (original root or split child with no active children), and a second distinct eligible unassigned active leaf Block. Nested splits are supported by KineX. The test does not reassign a Block that already belongs to another MA.
- Required permissions: create and view Maturity Areas; edit Blocks; edit MA membership; edit ArcGIS Business Model. The UI must have active Grower Supply and Truck access options in the Orchard's effective date scope. If multiple Grower Supplies exist, specify the intended Entity ID in the scenario; never select one at random. Truck access selects the first enabled reference option unless `truckAccessId` is pinned.
- Config file: `scenarios/block-hectares-frontend-blackburn-5255.json`. Set **`sourceBlockCode`** to the exact mapped, unassigned active leaf Block shown by inventory. Do not exclude a valid Block simply because it was produced by an earlier split. The first MA always owns this Block. Set `maSetup.areas[1].blockCode` for deterministic second MA selection; `null` uses the first distinct unassigned Block by code. The test codes default to `BH5255A2027` and `BH5255B2027`. Change them only before creating test data and keep the code stable when recovering a partial run.
- If `enteredHectares` is `null`, the source's existing positive business area is used. That value must differ from GIS. To exercise manual-authority behaviour, configure an explicitly different test value, for example a value chosen after inspecting the source's live measurements. No hectare value is invented by the runner.
- Dates: `2027-06-01` MA creation / baseline, `2027-06-02` manual entry, `2027-06-03` split. Verify these are valid for the selected Block's actual effective history and season. The runner checks that the source is active and has no active children on the split date; the frontend/API remain authoritative for detailed split eligibility.
- The API key/bearer token is **read-only** in this script; MA and Block mutations happen through Playwright clicks against authenticated KineX WEB. `-k` disables TLS verification **only** for loopback API GET requests.
- MA existence is checked by exact test code *and* exact expected Block assignment. Reusing a code owned by another MA or changing another Block's assignment fails immediately. For uncertain Create/Confirm submissions the journal prevents automatic re-submission.

## Commands (PowerShell at Guide Builder root)

```powershell
# 1. Inspect existing Blackburn Blocks and MA assignments without writes
node --env-file=.env ./scripts/test-block-hectares-5255.mjs --stage inventory --target local-api -k

# 2. Edit the scenario, pin the sourceBlockCode and optionally second MA blockCode,
#    enteredHectares, growerSupplyEntityId and truckAccessId
notepad .\scenarios\block-hectares-frontend-blackburn-5255.json

# 3. Exercise the actual MA wizard to its Review step, then Cancel. NO writes.
node --env-file=.env ./scripts/test-block-hectares-5255.mjs --stage preflight --target local-api --headed -k

# 4. Optional: create/verify the two MAs only through the frontend
node --env-file=.env ./scripts/test-block-hectares-5255.mjs --stage setup-mas --target local-api --headed -k --apply --confirm I-APPROVE-BLACKBURN-5255-MAS-AND-SPLIT

# 5. Full browser E2E, including MA creation if setup-mas was not separately run
node --env-file=.env ./scripts/test-block-hectares-5255.mjs --stage run --target local-api --headed -k --apply --confirm I-APPROVE-BLACKBURN-5255-MAS-AND-SPLIT

# 6. Read-only verification after any possible split commit
node --env-file=.env ./scripts/test-block-hectares-5255.mjs --stage verify --target local-api -k
```

Outputs: `output/blackburn-5255/<testRunId>/` with journal, `ma-1-review.png`, `ma-1-saved.png`, `ma-2-review.png`, `ma-2-saved.png`, and the existing manual-area and split screenshots.

**Important:** `--stage setup-mas` creates MAs but does not split. `--stage run` prepares MAs itself, so setup-mas is optional. A non-confirmed partial preparation can resume only if persisted MA codes and assignments are verified. If `journal.json` contains `confirmRequested: true`, **never rerun `run`**: use `verify` and inspect the saved state. Do not delete the journal just to bypass this safeguard.

## Not covered by this single scenario

- Physical Block geometry reshape **after** the split, bulk-import behaviour, missing-entered-hectares rejection, MA reassignment, undo/rejoin, and alternative crop rules. Those require separate test data or separate destructive sub-scenarios. Existing test/unit coverage does not prove a live browser/ArcGIS split has succeeded.
