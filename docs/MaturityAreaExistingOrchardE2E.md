# Create Maturity Areas on an existing test Orchard (frontend only)

This is a standalone **destructive** KineX Workbench E2E capture, not part of `npm run capture:all`. It reuses an existing Orchard, Block and existing active Grower Supplier **Entity**. If the Orchard has no effective-dated Grower Supplier link, the runner adds that exact Entity through the Orchard's **Grower Suppliers** tab, with the configured effective date, then creates an MA through the **Create Maturity Area** wizard. No direct API POST/PUT or ArcGIS `applyEdits` calls occur.

## Preflight and required configuration

Use only a disposable test KineX environment and an explicitly approved test Orchard. Fill these fields in local `config.json` (example below). **Do not create a made-up Grower Supplier**. Locate the exact active Entity name and Entity code in KineX's Entity Manager. The search uses Entity **name**; the returned option is verified by its **code**. Set Truck access to a real offered reference code (or leave blank only if the wizard offers exactly one value).

```json
{
  "mutations": {
    "enabled": true,
    "confirmation": "ALLOW KINEX GUIDE MUTATIONS",
    "requiredConfirmation": "ALLOW KINEX GUIDE MUTATIONS",
    "testPrefix": "UG"
  },
  "maFixture": {
    "enabled": true,
    "allowExistingTestOrchard": true,
    "orchardPin": "5255",
    "orchardName": "Blackburn",
    "orchardId": "01a19e20-03c6-77a9-8603-ad85a1460eac",
    "blockCode": "BLK-0002",
    "maCode": "UG5255A2027",
    "effectiveDate": "2027-06-01",
    "supplierName": "REPLACE_WITH_EXISTING_ACTIVE_ENTITY_NAME",
    "supplierCode": "REPLACE_WITH_MATCHING_ENTITY_CODE",
    "fifthCharacter": "Z",
    "truckAccessCode": ""
  }
}
```

Merge these properties into your existing config; **do not overwrite** your other settings. The Orchard ID, PIN, name and Block code above come from the Blackburn 5255 read-only inventory. An active mapped Block and compatible Production Status/Variety/Management attributes are still required by the real KineX wizard; this runner does not bypass them. Kiwifruit PIN 5255 needs a fifth-character grower-number suffix; change `Z` if the business requires a different one. Confirm the effective date is valid for the Orchard and season.

## Commands (PowerShell)

```powershell
# Validate JS/JSON flows without any writes
npm run check
npm run validate
npm test

# Creates or reuses the exact Grower Supplier link, then creates one MA
npm run capture:ma:existing

# After data exists, rebuild the safe guide with 2027 selected
npm run capture:all -- --season 2027 --crop KIWIFRUIT --country NZ --headed
```

For a second MA, choose a **different unassigned compatible Block** and a **different MA code** (e.g. `UG5255B2027`), then rerun the standalone command. Do not rerun the same code to force another MA.

## Guardrails / known limitations

- `capture:ma:existing` requires the exact mutation opt-in, an approved test host, a configured existing Orchard and an existing active Grower Supplier Entity. No mutation flow is auto-retried on a closed browser or page timeout.
- A journal at `.auth/ma-fixture-journals/<PIN>-<MA_CODE>/journal.json` records the Grower Supplier link submission and the MA submission separately and is **not erased by** `capture:all`. `ma-submission-uncertain` means **Create may have committed**. Inspect the database/Workbench manually, do not delete the journal or rerun without resolving the outcome.
- The runner checks exact selected Orchard identity, existing Entity name/code, specific unassigned Block, effective date, wizard Review, and saved MA code. The backend remains authoritative for valid Grower numbers, MA membership and ArcGIS publication.
- This is **not a synthetic fixture**. A missing or inactive supplier Entity, missing permission, invalid date, incompatible Block, missing Truck access, missing GIS geometry or inconsistent season will be reported, not fabricated.
- `capture:all` remains read-only. Its safe Create MA guide will target the configured Orchard when `maFixture.orchardPin` and `orchardName` are populated, but it never adds a Grower Supplier link or submits a new MA.
- A UI save alone does not prove ArcGIS publication has finished; check the Workbench's mapped/pending status or the spatial reconciliation diagnostics separately.

Live browser/ArcGIS execution is not possible from this artifact-building environment; the package includes Node validations and tests only.
