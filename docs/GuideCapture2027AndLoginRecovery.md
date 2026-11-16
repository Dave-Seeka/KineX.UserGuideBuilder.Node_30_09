# Safe guide capture — 2027 AppSelection, login and stale-dialog handling

The `full` profile is **read-only**: MA creation, Pick mutation and Block-hectare fixture writes remain excluded. To run a separate destructive regression use its dedicated command and inspect its journal first.

## Run the complete safe guide

From the Guide Builder root, in PowerShell:

```powershell
npm run check
npm test
npm run capture:all -- --season 2027 --crop KIWIFRUIT --country NZ --headed
```

`capture:all` now defaults to `NZ / KIWIFRUIT / 2027`, even without the CLI flags, unless you explicitly disable scope using `--no-guide-scope`. The flags make the requested values visible in command history. They do **not** create missing Orchard, Grower Supply or Maturity Area records.

The runner reapplies the selected season/crop/country through the real AppSelection modal after each Workbench navigation. It verifies that all three dropdown values survived crop/country narrowing before clicking Apply. If the option is missing or invalid, the capture fails with a specific message instead of silently reverting to an old season.

The resulting `output/coverage.md` and `output/coverage.json` record the **AppSelection** used in the guide run. `output/index.html` still provides links to the generated guides.

## Browser and ArcGIS login

If GIS asks for sign-in, complete it in the **headed** browser tab. The runner no longer repeatedly clicks a generic `Continue` control on the Workbench route or more than twice on the same login URL. ArcGIS credentials are intentionally not serialized to `storage-state.json` and the live browser tab must remain open until capture finishes.

If you see `browser-page-closed`, the live browser page was closed or replaced and the capture cannot continue. Check that no code, browser extension or login page automatically closes the Workbench tab. Retry with `--headed`, and keep the ArcGIS login tab visible. Do not assume `-k` fixes browser authentication; that flag belongs to the separate loopback API test runner.

## Why the Regions guide can skip

`Show and hide operational layers` now reports **Regions layer is not configured in the current operational Layers menu** if the option isn't offered. A skipped flow is **not** counted as generated; the report retains the exact reason. No layer is fabricated or hidden in ArcGIS.

## Dialog recovery

At the beginning of every guide, the runner uses visible KineX Cancel/Close controls to dismiss transient UI. For a **safe** guide only, if a modal still intercepts navigation, it reloads the Workbench in the **same authenticated tab** and verifies that the modal is gone. For a mutation guide, it refuses to abandon an in-progress edit. It never edits the DOM to bypass an overlay or force-clicks a background control.

## What this patch cannot fix from the report alone

The supplied coverage report showed 31/62 selected guides generated, 22 failed and 9 data-gated. Year/crop/country selection, stale dialogs and absent Regions layer are directly addressed. Other failures such as missing Grower Supply, absent MAs, a multi-Block clear control not visible in the current state, and a particular Business Form tab not appearing can still require correct test data, KineX permissions or a further UI-flow adjustment. They are not claimed to pass until a full capture runs against the live site.

`npm run capture:block-hectares:e2e` is an **independent mutation fixture** with its own hardcoded date assumptions; it is not changed by this safe `capture:all` patch. The user's prior log showed its 2026-07-01 date outside the selected season's valid range. Do not run it just to improve the safe guide coverage; use its dedicated fixture E2E rules and the correct season/date to avoid unintentional writes.
