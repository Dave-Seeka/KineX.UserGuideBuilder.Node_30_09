# E2E-07 — Select Pick, Split Pick, Select Pick reversal

This is an **API-backed persistence and reversal scenario** for the Guide Builder's Pick milestone. It runs three independently restartable stages against the real KineX Orchard API, not against a fake browser toast. It does not yet click/record all three UI mutation drawers; existing `flows/326-mutation-split-pick.json`, `flows/328-mutation-select-pick.json` and `flows/178-select-pick-history-reversal.json` document those UI affordances separately. Do not run those independent mutation captures on arbitrary existing MAs to simulate this E2E scenario.

## Before running

1. Complete the PIN3025 Property/Orchard/Block/MA foundation E2E and check the KineX records **persisted**; don't rerun earlier mutation steps without inspecting partial data.
2. Confirm two eligible test-created MAs exist in the same Orchard for the selected effective date.
3. Identify a **mapped test Block** for Select Pick, and a *different*, explicitly **unmapped test Block** for Split Pick. Do **not** reuse any of the four published-geometry Blocks for Split Pick. KineX independently rejects mapped Blocks.
4. Create/identify two distinct test Pick IDs and the Season ID; use the actual KineX UUIDs. Both Pick operations must refer to run-owned test data. Record all IDs in your local scenario file.
5. Copy `scenarios/e2e07-picks.example.json` to `scenarios/e2e07-picks.local.json`. Set a stable `testRunId`, API target and **saved test Orchard PIN**, crop and season. `--stage resolve` looks up Orchard and Season IDs; `preflight` and other non-plan stages resolve automatically. You still need real Block, Pick and MA IDs before Pick preflight/writes. Verify the Orchard from `resolve` before proceeding. Set `unmappedGeometryConfirmed` only after independently confirming mapping state; this declaration does **not** bypass KineX's server-side gate.
6. Configure a **test** API credential with the necessary Orchard allocation strategy view, Select Pick, and Split Pick permissions; never commit it. The API key header is `X-KineX-Api-Key`. Alternatively use a bearer access token. Neither is written to the run manifest.

Run from the Guide Builder root (PowerShell; no host Python):

```powershell
$env:KINEX_E2E07_API_KEY = '<test-api-key>'
node ./scripts/e2e-07.mjs --config ./scenarios/e2e07-picks.local.json --stage plan
node ./scripts/e2e-07.mjs --config ./scenarios/e2e07-picks.local.json --stage resolve
node ./scripts/e2e-07.mjs --config ./scenarios/e2e07-picks.local.json --stage preflight
node ./scripts/e2e-07.mjs --config ./scenarios/e2e07-picks.local.json --stage select --apply
node ./scripts/e2e-07.mjs --config ./scenarios/e2e07-picks.local.json --stage split --apply
node ./scripts/e2e-07.mjs --config ./scenarios/e2e07-picks.local.json --stage reverse --apply
node ./scripts/e2e-07.mjs --config ./scenarios/e2e07-picks.local.json --stage verify
```

Or run `--stage all --apply` **only after** preflight and confirming all prerequisites.


## Existing Orchard in a disposable local test dataset

When **all KineX data is disposable test data**, you can use the existing Orchard instead of a specially named Guide Builder fixture. Run with **`--allow-existing-orchard`**, which accepts the actual Orchard name returned by KineX **only for `localhost` / `127.0.0.1` API origins**. This is an explicit per-command opt-in; the default name ownership check remains enabled, and the override is rejected for `*.test` or other hosts. It does **not** bypass the exact PIN/crop/season/Property-country lookup, Orchard/Block/MA linkage, effective dates, unmapped Split Block requirement, existing strategy protection, operation journal or `--apply` requirement. Keep the scenario's real Orchard name blank or matching the actual persisted name; don't spoof a fixture name.

Use the opt-in consistently for resolve/preflight and any later mutation stage:

```powershell
node --env-file=.env ./scripts/e2e-07.mjs --config ./scenarios/e2e07-picks.local.json --target local-api --stage resolve --allow-existing-orchard -k
node --env-file=.env ./scripts/e2e-07.mjs --config ./scenarios/e2e07-picks.local.json --target local-api --stage preflight --allow-existing-orchard -k
```

## Orchard and Season lookup (integrated)

`--stage resolve` performs read-only lookup without requiring Block/Pick/MA UUIDs or creating an E2E operation state file. All other stages except `plan` and `probe` use the same lookup **in memory** before validation. It uses authenticated paged GETs to resolve crop, season definition and Orchard for the given saved PIN, verifies the parent Property country and checks the Orchard's test-only name marker. Supplied real IDs and an explicit non-template name are treated as assertions; mismatches stop execution. The exact shipped placeholder UUIDs and template name are ignored only during lookup. An arbitrary incorrect UUID is **never** ignored.

```powershell
npm run test:e2e:07 -- --config ./scenarios/e2e07-picks.local.json --target local-api --stage resolve -k
npm run test:e2e:07 -- --config ./scenarios/e2e07-picks.local.json --target local-api --stage preflight -k
```

The generated PIN3025 fixture usually **does not save PIN `3025`** to its new Orchard: that is the CAB/GIS source PIN. Use the actual saved four-character test PIN from its fixture manifest. If the lookup returns zero matches, do not substitute an arbitrary Orchard. Preflight can still fail for missing MA/Block/Pick IDs after Orchard lookup succeeds; it does not provision them. No scenario JSON is overwritten and run-state fingerprints include resolved IDs, protecting resumed writes.

## What is verified

- Select Pick: 50/50 estimated-yield percentages, sizing codes, selected Pick/Season/Block IDs and date, saved strategy ID and read-by-ID plus effective read-back.
- Split Pick: 50/50 Block percentages against the explicitly unmapped Block, selected Pick/Season/Block IDs and date, saved strategy ID and effective read-back.
- Select Pick reversal: persisted immutable reversal with a new strategy ID, correct link to the original strategy, zero allocation lines and effective read-back. The **original Select Pick remains readable by its ID**.
- The runner writes a durable state file under `output/fixture-runs/e2e07-<testRunId>.json` **before** calling each mutation. Retry a failed pending stage with the *same* config, state and operation ID; KineX's server checks equivalent retries. Successful stages verify instead of reapplying.

## Safeguards and limitations

- No writes on `plan`, `preflight`, or `verify`. Mutating stages need `--apply` and a `localhost`/`*.test` API hostname matching `approvedTestHost`.
- Existing untracked effective strategies block new writes. Changing scenario parameters under the same run ID is rejected. An on-disk `.lock` prevents concurrent executions.
- All Pick stages require Block, Pick and MA IDs and two distinct MA allocations totaling 100%. Orchard and Season IDs resolve from the saved PIN/crop/season against the KineX API. The API must return the exact owner Orchard and both Blocks/active MAs within that Orchard before mutation. No automatic provisioning of new Pick records or an unmapped Block is performed in this version. The application API remains authoritative for temporal/eligibility/permissions/spatial enforcement.
- Do not treat an API state check as proof of correct UI navigation, sidebar state, loaded MA history, visual indicator or real GIS publication. **Browser UI Pick integration and test-data provisioning remain follow-up work.**
- A reported HTTP failure after a POST may occur after the server committed. Re-run with the same state file and operation ID; do not delete the state and create a second operation.
- Clear any temporary credentials from your PowerShell session after finishing. Never upload scenario files containing credentials.

## Select the running KineX API target

The Guide Builder's `baseUrl` is the **WEB/Workbench** browser target. E2E-07
uses an independently selectable **API** target defined by `apiTargets` in the
same `config.json`. This avoids accidentally sending Pick writes to the WEB port.

Copy/update the following entries in `config.json` (these are origins, not URL paths):

```json
"apiTargets": {
  "local-api": { "baseUrl": "https://localhost:7002" },
  "kinex-test-api": { "baseUrl": "https://kinex.test:7001" }
}
```

The local HTTPS port is taken from KineX.API `launchSettings.json`; adjust it
if your running local API uses another port. The Guide WEB `baseUrl` stays
`https://kinex.test:7004` until explicitly changed for browser captures.

From the Guide Builder repository root, using PowerShell:

```powershell
# Assign the key in your local PowerShell environment; do not commit it.
$env:KINEX_E2E07_API_KEY = '<test-api-key>'

npm run test:e2e:07 -- --targets
npm run test:e2e:07 -- --config ./scenarios/e2e07-picks.example.json --target local-api --stage probe
npm run test:e2e:07 -- --config ./scenarios/e2e07-picks.local.json --target local-api --stage plan
npm run test:e2e:07 -- --config ./scenarios/e2e07-picks.local.json --target local-api --stage preflight
```

For the guarded mutation stage, append `--stage select --apply` (and later
`split` / `reverse` as described above). The `probe` stage issues a read-only
Block-list request and verifies authenticated JSON from the API. It needs
`Orchard.Blocks.View` but no test scenario UUIDs; the example scenario works.
It is not a proof of Pick write permissions or MA eligibility.

Specify `--guide-config ./path/to/config.json` when Guide Builder is using a
non-default configuration file. Without `--target`, E2E-07 continues to use
`apiBaseUrl` and `approvedTestHost` from its scenario for backwards
compatibility. Explicit target selection overrides those two fields only in
memory; no scenario JSON is rewritten. The resulting API origin participates
in the run-state fingerprint, so **switching API targets cannot accidentally
reuse a Pick state file from another server**. Use a distinct `testRunId` and
state file for each independently provisioned target.

Only localhost, 127.0.0.1 and `*.test` API origins are allowed, and remote
requests require HTTPS. Redirects are not followed. Credentials are read only
from `KINEX_E2E07_API_KEY` or `KINEX_E2E07_BEARER_TOKEN`; `--targets`, `plan`
and the state JSON never print or store them.

If your local .NET HTTPS development certificate is not trusted by Node,
prefer trusting it (`dotnet dev-certs https --trust`) or configuring a CA for
Node. For **local test APIs only**, add `-k` (alias `--insecure-local-tls`)
just as with `curl -k`:

```powershell
npm run test:e2e:07 -- --config ./scenarios/e2e07-picks.example.json --target local-api --stage probe -k
```

`-k` bypasses TLS verification **only** for the loopback `https://localhost`
or `https://127.0.0.1` API selected for that invocation. It refuses
`*.test`, public hosts and HTTP endpoints, never modifies environment-wide
TLS settings, and does not affect Playwright's WEB target. Do not use it for
production or remote environments. If the connection still fails, the runner
now reports the underlying connection/TLS error rather than just `fetch failed`.
For a local HTTP development listener, select `http://localhost:5288` instead
and omit `-k`.
