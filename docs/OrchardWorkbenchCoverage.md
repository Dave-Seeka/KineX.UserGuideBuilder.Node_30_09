# Orchard Workbench flow coverage

Version 1.7.0 defines **70 ordered flows**: **61 safe publication flows** and **9 guarded mutation-verification flows**.

## Profiles

- `smoke`: 6 fast orientation flows
- `core`: 31 primary user journeys
- `full`: 61 non-destructive publication flows
- `mutation`: 9 persistent create/save/Pick/delete checks
- `all`: safe and mutation definitions together; mutation confirmation remains mandatory

## Capability matrix

| Order | Capability | Category | Profiles | Mode | Data/permission gated |
|---:|---|---|---|---|---|
| 10 | Orchard Workbench overview | Getting started | smoke, core, full | safe | Yes |
| 20 | Set AppSelection | Getting started | smoke, core, full | safe | No |
| 25 | Apply the current AppSelection | Getting started | core, full | safe | No |
| 26 | Find and select Properties | Navigation and selection | core, full | safe | Yes |
| 27 | Search and clear Properties | Navigation and selection | full | safe | Yes |
| 28 | Filter Properties by boundary status | Navigation and selection | full | safe | Yes |
| 30 | Find and filter Orchards | Navigation and selection | smoke, core, full | safe | Yes |
| 32 | Search and clear Orchards | Navigation and selection | full | safe | Yes |
| 34 | Filter linked and unlinked Orchards | Navigation and selection | full | safe | No |
| 36 | Find and select Maturity Areas | Navigation and selection | core, full | safe | Yes |
| 38 | Search Maturity Areas | Navigation and selection | full | safe | Yes |
| 40 | Browse Blocks | Navigation and selection | core, full | safe | Yes |
| 42 | Search and clear Blocks | Navigation and selection | full | safe | Yes |
| 50 | Select multiple Blocks | Navigation and selection | core, full | safe | Yes |
| 52 | Manage a multi-Block selection | Navigation and selection | full | safe | Yes |
| 60 | Use map selection tools | Map tools | smoke, core, full | safe | No |
| 62 | Navigate the ArcGIS map | Map tools | core, full | safe | No |
| 64 | Use automatic and targeted map selection | Map tools | full | safe | No |
| 68 | Move and collapse the map toolbar | Map tools | full | safe | No |
| 70 | Change basemap and layers | Map tools | core, full | safe | No |
| 72 | Change and restore the basemap | Map tools | full | safe | No |
| 74 | Show and hide operational layers | Map tools | full | safe | No |
| 76 | Show Pick strategy indicators | Map tools | full | safe | Yes |
| 78 | Focus on the Business Form | View details | full | safe | Yes |
| 80 | View Orchard details | Records | smoke, core, full | safe | Yes |
| 82 | Review the no-selection state | View details | full | safe | No |
| 84 | View Property details | View details | full | safe | Yes |
| 85 | Use Orchard inspector tabs | View details | core, full | safe | Yes |
| 86 | Use Block inspector tabs | View details | core, full | safe | Yes |
| 88 | View Block details | View details | full | safe | Yes |
| 89 | View Maturity Area details | View details | core, full | safe | Yes |
| 90 | Create Orchard under an existing Property | Create records | smoke, core, full | safe | Yes |
| 92 | Understand Orchard creation requirements | Create records | full | safe | No |
| 94 | Move backward and cancel Orchard creation | Create records | full | safe | Yes |
| 100 | Create Orchard with a new Property and manual address | Create records | core, full | safe | Yes |
| 102 | Switch between address lookup and manual entry | Create records | full | safe | No |
| 110 | Use an ArcGIS-verified Property address | Create records | core, full | safe | Yes |
| 120 | Create a Block | Create records | core, full | safe | Yes |
| 122 | Understand Block creation requirements | Create records | full | safe | Yes |
| 124 | Create a Maturity Area | Create records | core, full | safe | Yes |
| 130 | Edit a Orchard | Edit records | core, full | safe | Yes |
| 132 | Cancel a Orchard edit | Edit records | full | safe | Yes |
| 140 | Edit a Block | Edit records | core, full | safe | Yes |
| 142 | Cancel a Block edit | Edit records | full | safe | Yes |
| 144 | Edit a Maturity Area | Edit records | core, full | safe | Yes |
| 146 | Edit Maturity Area Block assignment | Edit records | full | safe | Yes |
| 148 | Change a Block Maturity Area assignment | Edit records | full | safe | Yes |
| 150 | Edit a Property | Edit records | core, full | safe | Yes |
| 152 | Cancel a Property edit | Edit records | full | safe | Yes |
| 160 | Add a boundary to an unlinked Orchard | Geometry | core, full | safe | Yes |
| 162 | Choose how to add an Orchard boundary | Geometry | full | safe | Yes |
| 170 | Edit a linked boundary | Geometry | core, full | safe | Yes |
| 172 | Use boundary drawing controls | Geometry | full | safe | Yes |
| 174 | Use Split Pick | Pick strategies | core, full | safe | Yes |
| 176 | Use Select Pick | Pick strategies | core, full | safe | Yes |
| 177 | Review Block split lifecycle actions | Block lifecycle | full | safe | Yes |
| 178 | Review Select Pick history and reversal | Pick strategies | full | safe | Yes |
| 180 | Delete an Orchard | Delete records | core, full | safe | Yes |
| 190 | Delete a Block | Delete records | core, full | safe | Yes |
| 200 | Delete a Property | Delete records | core, full | safe | Yes |
| 202 | Cancel record deletion | Delete records | full | safe | Yes |
| 300 | Verify Orchard create notifications | Mutation verification | mutation | mutation | Yes |
| 310 | Verify Orchard save notification | Mutation verification | mutation | mutation | Yes |
| 320 | Verify Block create notifications | Mutation verification | mutation | mutation | Yes |
| 322 | Verify Block save notification | Mutation verification | mutation | mutation | Yes |
| 324 | Verify Property save notification | Mutation verification | mutation | mutation | Yes |
| 326 | Apply Split Pick | Mutation verification | mutation | mutation | Yes |
| 328 | Apply Select Pick | Mutation verification | mutation | mutation | Yes |
| 330 | Verify Block delete notification | Mutation verification | mutation | mutation | Yes |
| 340 | Verify Orchard delete notification | Mutation verification | mutation | mutation | Yes |

## Current Workbench coverage boundaries

- The safe suite never submits a create, saves an edit/assignment, applies a Pick strategy, confirms a Select Pick reversal, commits Block split/rejoin/undo, or confirms deletion.
- Split Pick is documented as allocation of percentages of a whole non-spatial Block; Select Pick is documented as sizing-based allocation with estimated yield planning shares. Physical Split Block is covered separately.
- The MA Clearance / CTP display is captured as the current Workbench requirement signal derived from an effective Select Pick; downstream regulatory/Harvest approval execution is outside this guide suite.
- Maturity Area create/reversal/lifecycle flows are data and permission gated because they require representative MA/Block history.
- Standalone Create Property remains intentionally excluded; Property creation is covered inside Create Orchard.
- Normal publication runs do not manufacture backend failures.

See `FullCoverageTestData.md` for the fixture required to generate every data-gated guide.

## Manual regression guides

- `BlockHectaresManualTesting.md` covers the entered-vs-GIS Block hectare rule, split conservation, manual overrides, Maturity Area recalculation, split undo and next-season rejoin. These scenarios remain manual because they require controlled business/GIS area mismatches and temporal lineage data.
