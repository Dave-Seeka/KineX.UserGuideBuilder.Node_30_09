# Full coverage test data

The flow suite separates **defined coverage** from **runnable coverage**. A flow is defined when its journey exists in JSON. It is generated only when AppSelection, permissions, Orchard data and ArcGIS state satisfy the prerequisites; otherwise it is reported as data/permission gated rather than failed.

## Minimum data for the 61-flow safe profile

Use a dedicated Season/Crop/Country combination containing:

- at least one Property and Orchard;
- at least one linked and one unlinked Orchard;
- at least one Orchard with one Block and one Orchard with two or more Blocks;
- at least one linked Block for physical Split Block action coverage;
- at least one Maturity Area visible in the selected scope;
- at least one MA with an assigned mapped Block;
- an eligible Block plus a Grower Supply option for Create Maturity Area review;
- at least one Maturity Area with an assigned unmapped Block so the dedicated Split Pick guide can open;
- at least one effective Select Pick so strategy indicators can appear;
- one reversible Select Pick audit event to generate the reversal guide rather than gate it;
- an ArcGIS address search that returns a complete verified Property result;
- view/create/edit/delete-dialog permissions for Property, Orchard, Block and Maturity Area;
- Split Pick and Select Pick permissions, plus audit-history permission for the Pick guides.

The safe profile never commits persistence. Create flows stop at Review; profile and assignment edits cancel; Pick strategy drawers close; reversal drawers close; lifecycle action guides do not invoke Split/Undo/Rejoin; geometry flows cancel; delete flows close confirmation.

## Mutation verification environment

Run the 9 mutation flows only in a disposable environment. The create/edit/delete checks are one dependent guide-owned scenario; the Pick checks use disposable MA fixture data:

1. Create a guide-owned Orchard under an existing Property.
2. Save and restore the Orchard name through the effective-date modal.
3. Create a guide-owned Block. Its code is auto-generated; the guide-owned prefix is stored in the Block name.
4. Save and restore the Block name.
5. Save and restore an editable Property code.
6. Apply a Split Pick to an unmapped assigned Block using two Maturity Areas.
7. Apply a Select Pick using two sizing allocations and two Maturity Areas.
8. Delete the guide-owned Block by its name prefix.
9. Delete the guide-owned Orchard.

Enable the profile explicitly:

```json
"mutations": {
  "enabled": true,
  "confirmation": "ALLOW KINEX GUIDE MUTATIONS",
  "requiredConfirmation": "ALLOW KINEX GUIDE MUTATIONS",
  "testPrefix": "UG"
}
```

Then run:

```powershell
npm run capture:mutations
```

Do not interrupt the mutation suite between guide-owned creation and cleanup. If interrupted, use the configured prefix to locate the guide-owned Orchard and Block name and remove them manually. Split/Select Pick flows intentionally persist immutable strategy history against disposable fixture data, so reset that fixture between publication runs when a clean history is required.

## Interpreting coverage

- **generated** — the journey completed and was published;
- **skipped** — the journey is defined but required data, permission or service state was unavailable;
- **failed** — an unexpected selector, browser, validation or application error occurred;
- **excluded** — the journey is outside the selected profile.

Generated coverage measures published guides. Accounted coverage treats generated and expected data-gated skips as covered definitions while still exposing missing fixtures.

## Block-hectare regression fixture

For the manual Block-hectare regression suite, use the checked-in fixture `fixtures/block-hectares-pin-1285.json`:

- Property GIS GlobalID: `98a721c9-d82a-4b2c-affa-ba9cf8cf075c`
- Orchard: PIN `1285`, Orchard `31239`, Kiwifruit
- Primary destructive Block: code `3`, PhysicalAreaId `317466`, GIS GlobalID `032826d5-7326-473b-8e1b-16720c1925ba`
- Baseline business hectares for Block 3: `3.0000`
- Baseline GIS hectares for Block 3: approximately `3.3715`
- Control Blocks: `1`, `2`, `4`

Keep the control Blocks unchanged where possible. See `docs/BlockHectaresManualTesting.md` for the complete setup and expected results.

## Block-hectares E2E fixture

The Block-hectares regression does not depend on an existing mutable Orchard. Run `npm run capture:block-hectares:e2e` to create a guide-owned Property, Kiwifruit Orchard and four mapped Blocks derived from source PIN 1285. The geometry is translated before publication so the test copy does not overlap the source GIS records. See `docs/BlockHectaresManualTesting.md`.
