# Portal login

The guide builder now treats ArcGIS authentication as a **live browser prerequisite**, not as token data to serialize and replay.

The capture startup sequence is:

1. restore the normal KineX browser login state from `.auth/storage-state.json` when available;
2. open the Orchard Workbench in the page that will also be used for guide capture;
3. wait for the ArcGIS map to become interactive;
4. if a GIS/SSO login control is visible, click the unambiguous `Sign in`, `Log in`, `Login`, or `Continue` control;
5. when the resulting login page exposes an email/username field, fill the configured portal email and submit `Next`, `Continue`, `Sign in`, or the form's submit control;
6. leave password, MFA, consent, or any provider-specific challenge to the user in the headed browser;
7. continue automatically as soon as the Workbench marker, enabled map controls, rendered ArcGIS surface/canvas, and a benign map hover all succeed;
8. keep that same Workbench tab alive for every flow in the capture run.

The builder does **not** serialize or reconstruct ArcGIS `IdentityManager`, OAuth/PKCE state, or GIS access tokens. This avoids the Workbench ↔ GIS Portal redirect loop caused by replaying browser-auth state in a new tab/context.

Every guide starts with a Workbench navigation, so reusing the authenticated tab still resets the application UI while preserving the browser-owned ArcGIS session for that tab.

## Configuration

```json
{
  "authState": "./.auth/storage-state.json",
  "portalLogin": {
    "enabled": true,
    "autoLoginOnCapture": true,
    "loginPath": "/arcgis/orchard-workbench",
    "probePath": "/arcgis/orchard-workbench",
    "authenticatedSelector": "[data-guide='orchard-workbench']",
    "probeTimeoutMs": 8000,
    "loginTimeoutMs": 300000,
    "email": "",
    "emailEnvironmentVariable": "KINEX_GUIDE_PORTAL_EMAIL"
  }
}
```

`authSessionStorage` may still exist in older `config.json` files. It is treated only as a legacy cleanup path; the builder removes the old file after a successful login and never restores it.

The email is optional. Prefer an environment variable so the address does not need to be written to a project file:

```powershell
$env:KINEX_GUIDE_PORTAL_EMAIL = "you@example.com"
```

Alternatively, `config.json` is Git-ignored and can contain a local `portalLogin.email` value. The builder never logs the configured email value. If no email is configured, the email step remains manual.

## Recommended workflow

Save the reusable KineX browser login state:

```powershell
npm run auth -- --fresh
```

Then run GIS-backed capture headed when the ArcGIS portal requires an interactive SSO step:

```powershell
npm run capture:core -- --headed
```

When GIS Portal appears, the builder first clicks the visible login control. If an email/username field appears and `KINEX_GUIDE_PORTAL_EMAIL` or `portalLogin.email` is configured, the builder fills and submits it automatically. Password, MFA, consent, and any other provider-specific step remain interactive. Do not close the window: capture continues automatically when the map is interactive.

The browser may remain headed for the rest of that capture run. This is intentional; relaunching into a new context would discard the live ArcGIS tab session that the run just established.

The `.auth` directory is ignored by Git and must remain private because the normal Playwright browser storage state still contains authenticated KineX cookies.
