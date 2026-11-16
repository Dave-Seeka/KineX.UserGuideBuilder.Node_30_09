# E2E-07 standalone Orchard lookup (drift-safe)

This standalone script remains available, but the main `npm run test:e2e:07 -- --stage resolve` now uses the same resolver directly; `--stage preflight` also resolves in memory. It performs only authenticated `GET` requests and writes a **new** copy of the configuration; no KineX mutations. It does not claim to provision MAs, Pick records, or an unmapped Block.

## PowerShell

```powershell
node ./scripts/e2e07-lookup-by-pin.mjs --config ./scenarios/e2e07-picks.local.json --target local-api -k
```

Set exactly one of `KINEX_E2E07_API_KEY` or `KINEX_E2E07_BEARER_TOKEN` as in the existing E2E-07 setup. `--target local-api` uses `https://localhost:7002`, and `-k` disables certificate verification only for that loopback request. You can override the base URL explicitly with `--api-base-url` for a different local test endpoint.

Successful lookup prints a `configFile` path, usually `output/fixture-runs/e2e07-resolved-<testRunId>.json`. Use that in **your existing** preflight:

```powershell
npm run test:e2e:07 -- --config ./output/fixture-runs/e2e07-resolved-<testRunId>.json --target local-api --stage preflight -k
```

The script will refuse to overwrite an existing output file. Specify another filename with `--output` to re-run; don't delete an existing E2E run state if any mutation may have occurred.

## Matching guarantees and limitations

- Lookup key is the **saved** Orchard PIN, crop `KIWIFRUIT`, country `NZ`, and KineX season code, resolved through the season definition and parent Property country. KineX's season definition, not calendar-year inference, constrains effective dates.
- Orchard name must have an E2E ownership marker (`UG PIN3025 E2E ...` or `KINEX-E2E ...`). Supplied Orchard/Season IDs and name are verified, not overwritten silently.
- This lookup does not solve an invalid PIN. The original 17-step fixture may have generated a fresh 4-character test PIN instead of saving source PIN `3025`.
- The main runner now accepts the existing fixture markers (`UG PIN3025 E2E ...` and `KINEX-E2E ...`), while rejecting other Orchard names. Do not bypass that ownership check.
- A successful lookup does not imply MA, Block, Pick, or geometry prerequisites exist. No write commands are run here.
