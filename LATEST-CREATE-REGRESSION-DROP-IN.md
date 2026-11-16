# Latest create regression drop-in

Copy this package over the existing `KineX.UserGuideBuilder.Node` folder. It adds a separate, non-destructive test suite for the latest Orchard Workbench create changes.

## Coverage

The suite verifies:

1. **Drawer lifecycle**
   - Continue moves forward.
   - Previous returns to step one.
   - Cancel closes the drawer.
   - Reopening starts a fresh session with no stale Property selection or errors.

2. **Standalone Property temporal policy**
   - Property creation requires country, not crop.
   - A valid minimum, maximum and default effective date resolve.
   - The date falls inside the resolved range.
   - Navigation does not lose or recalculate the resolved Property context.

3. **Create Property + Orchard temporal policy**
   - The new Property date resolves before Orchard details.
   - Orchard crop selection resolves the Orchard effective-date context.
   - Returning to the parent step proves the Orchard resolution did not overwrite the Property range or date.

The flows never click the final Create button.

## Run

From the guide-builder root:

```powershell
.\scripts\test-latest-create.ps1 -Headed -NoPdf
```

For a normal headless run with PDF output:

```powershell
.\scripts\test-latest-create.ps1
```

The script first runs flow validation, Node tests and syntax checks. Skip those when iterating only on the browser test:

```powershell
.\scripts\test-latest-create.ps1 -Headed -NoPdf -SkipStaticChecks
```

## Output

The suite uses an isolated output directory and does not clear the normal guide output:

```text
output/latest-create-regression/
├── index.html
├── coverage.html
├── latest-create-drawer-lifecycle/
├── latest-property-temporal-policy/
├── latest-orchard-dual-temporal-policy/
└── combined/latest-create-regression/
```

## Added harness capability

The drop-in adds `rememberAttribute`, which stores a DOM attribute in a flow runtime variable:

```json
{
  "type": "rememberAttribute",
  "key": "propertyMin",
  "name": "min",
  "locator": {
    "selector": "[data-guide='property-effective-date'] input[type='date']"
  }
}
```

A later assertion can compare against it:

```json
{
  "type": "assertAttribute",
  "locator": {
    "selector": "[data-guide='property-effective-date'] input[type='date']"
  },
  "name": "min",
  "exact": "{{propertyMin}}"
}
```
