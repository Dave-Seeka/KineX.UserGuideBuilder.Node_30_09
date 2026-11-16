# Maturity Area guide flows

These flows are distinct from Block-hectares E2E. They do **not** create a new Property,
Orchard or Block, and they never inject MA geometry directly into the FeatureServer.
KineX owns MA membership, validation and ArcGIS publication.

## Safe: prerequisites and review

- `npm run capture:ma:requirements` opens the MA Details drawer, shows required fields and
  the disabled Continue action, then cancels. Requires an accessible Orchard.
- `npm run capture:ma:review` fills an alphanumeric MA code, chooses Truck access and
  an Orchard-linked Grower Supply, checks the Orchard/season-constrained effective date,
  selects one compatible unassigned Block, captures Review and cancels. Nothing is saved.
- Existing `144-edit-maturity-area.json`, `146-edit-maturity-area-assignment.json` and
  `148-block-maturity-area-assignment.json` remain separate safe review flows.

## Opt-in: create a real MA

`npm run capture:ma:create` runs `335-mutation-create-maturity-area.json` and **persists**
MA membership. It is standalone, and never runs via `capture-all`, including the `all` profile. It requires `config.mutations.enabled=true` plus the exact confirmation
phrase `ALLOW KINEX GUIDE MUTATIONS`, an allowed test host, and an Orchard whose
rendered identity contains `<mutations.testPrefix> Orchard`. The Orchard must already
have a Grower Supply link and eligible unassigned Blocks. The Guide Builder's existing
mutation Block create flow does **not** guarantee these prerequisites.

- A new alphanumeric code is generated from the current run identifier.
- The flow uses KineX's normal Create MA wizard and server-side validations.
- Required Truck access and Grower Supply choices are made from the live reference lists.
- One unassigned eligible Block is selected; others are left unchanged.
- The MA and its temporal membership persist even if later guide capture fails.
- The flow does **not** delete or undo the MA; review the created record for cleanup.

**Do not point this flow at production.** The host guard accepts localhost,
`.test`, `.localhost` and `kinextest.seeka.co.nz` only. Ensure the KineX session is
in an isolated test tenant and the Orchard is guide-owned. Do not enable mutations
in shared or production environments.

Geometry is **not** invented for an MA. KineX derives/publishes it from selected
mapped Blocks; if Blocks lack boundaries the MA remains spatially pending.

## Source contract

Selectors and validation were checked against the supplied KineX source snapshot
(`KineX-20261028-142254.zip`), including
`WorkbenchCreateMaturityAreaFlow.razor` and `WorkbenchMaturityAreaCreateFlow.cs`.
Live browser/service tests still need to be run against the current deployment.
