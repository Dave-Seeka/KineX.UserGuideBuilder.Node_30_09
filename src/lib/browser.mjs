import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import process from 'node:process';
import { chromium, firefox, webkit } from 'playwright';
import { waitForMapReady } from './map-ready.mjs';
import { absoluteUrl, ensureDirectory } from './utils.mjs';

const browsers = { chromium, firefox, webkit };
const DEFAULT_WORKBENCH_AUTH_SELECTOR = "[data-guide='orchard-workbench']";
const DEFAULT_PORTAL_SIGN_IN_PATTERN = /^(sign[ -]?in|log[ -]?in|login|continue)(?:\s+.*)?$/i;
const DEFAULT_PORTAL_EMAIL_SUBMIT_PATTERN = /^(next|continue|sign[ -]?in|log[ -]?in|login)(?:\s+.*)?$/i;
const DEFAULT_PORTAL_EMAIL_ENVIRONMENT_VARIABLE = 'KINEX_GUIDE_PORTAL_EMAIL';

export async function launchBrowser(config, args = {}, options = {}) {
  const browserType = browsers[config.browser];
  if (!browserType) {
    throw new Error(`Unsupported browser '${config.browser}'. Use chromium, firefox, or webkit.`);
  }

  const headless = options.forceHeaded
    ? false
    : args.headed
      ? false
      : config.headless;

  const browser = await browserType.launch({
    headless,
    slowMo: Number(args.slowMo ?? 0)
  });

  const storageState = options.ignoreStorageState
    ? undefined
    : await getExistingFile(config.authState);

  const context = await browser.newContext({
    storageState,
    ignoreHTTPSErrors: config.ignoreHTTPSErrors,
    viewport: config.viewport ?? null
  });

  // ArcGIS authentication is deliberately not reconstructed from serialized tokens or
  // sessionStorage. The capture runner keeps one Workbench tab alive so ArcGIS can complete its
  // normal browser OAuth flow and retain that live state in the browsing context that uses it.
  context.setDefaultTimeout(config.defaultTimeoutMs);
  context.setDefaultNavigationTimeout(config.navigationTimeoutMs);
  return { browser, context, headless, page: null };
}

export async function launchAuthenticatedBrowser(config, args = {}) {
  let session = await launchBrowser(config, args);

  if (!config.portalLogin.enabled || args.skipLogin) {
    session.page = await session.context.newPage();
    return session;
  }

  session.page = await session.context.newPage();
  const probe = await prepareWorkbenchCapturePage(session.page, config, {
    interactive: false,
    timeoutMs: config.portalLogin.probeTimeoutMs ?? 8000
  });

  if (probe.ready) {
    return session;
  }

  if (!config.portalLogin.autoLoginOnCapture) {
    await closeSession(session);
    throw new Error(
      `Portal authentication is required. Run capture with --headed and complete the browser ` +
      `login. Current URL: ${probe.url}. Reason: ${probe.reason ?? 'unknown'}.`
    );
  }

  // If the requested capture browser is already headed, continue the interactive login in this
  // exact tab. Otherwise relaunch headed once, then keep that same tab for the whole capture run.
  // We intentionally do not return to headless after GIS login because ArcGIS session state is
  // tab-scoped and should not be copied or reconstructed by Guide Builder.
  if (session.headless) {
    await closeSession(session);
    session = await launchBrowser(
      config,
      { ...args, headed: true },
      { forceHeaded: true }
    );
    session.page = await session.context.newPage();
  }

  console.log(
    '\nWaiting for the Workbench map to become interactive. ' +
    'If GIS Portal asks for sign-in, complete it in this browser window.'
  );

  const interactive = await prepareWorkbenchCapturePage(session.page, config, {
    interactive: true,
    timeoutMs: config.portalLogin.loginTimeoutMs ?? 300000
  });

  if (!interactive.ready) {
    const url = session.page?.isClosed() ? '<closed>' : session.page.url();
    await closeSession(session);
    throw new Error(
      `The Workbench map did not become interactive after login. ` +
      `Current URL: ${url}. Reason: ${interactive.reason ?? 'unknown'}.`
    );
  }

  await saveBrowserStorageState(session.context, config);
  console.log(
    'Workbench map is interactive. Continuing capture in this browser tab; ' +
    'ArcGIS credentials were not serialized by Guide Builder.'
  );

  return session;
}

export async function completePortalLogin(context, config, options = {}) {
  const page = await context.newPage();
  const loginUrl = absoluteUrl(
    config.baseUrl,
    options.path ?? config.portalLogin.loginPath ?? config.portalLogin.probePath ?? '/'
  );

  let completed = false;

  try {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
    console.log(
      `Complete the portal login in the browser window. Waiting up to ` +
      `${Math.round(config.portalLogin.loginTimeoutMs / 60000)} minutes...`
    );

    const result = await waitForInteractiveWorkbench(page, config, {
      interactive: true,
      timeoutMs: config.portalLogin.loginTimeoutMs ?? 300000,
      navigate: false
    });

    if (!result.ready) {
      throw new Error(
        `Portal login did not reach an interactive Workbench map. ` +
        `Current URL: ${page.url()}. Reason: ${result.reason ?? 'unknown'}.`
      );
    }

    await saveBrowserStorageState(context, config);
    completed = true;
  } catch (error) {
    if (options.keepPageOpenOnFailure && process.stdin.isTTY && !page.isClosed()) {
      console.error(
        `\nAuthentication did not complete. The browser is being kept open so the ` +
        `Workbench/GIS state can be inspected.`
      );
      const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
        await prompt.question('Press Enter when you are ready to close the browser... ');
      } finally {
        prompt.close();
      }
    }
    throw error;
  } finally {
    if (!page.isClosed()) {
      await page.close();
    }
  }

  return completed;
}

export async function probeAuthentication(context, config) {
  const page = await context.newPage();
  try {
    return await prepareWorkbenchCapturePage(page, config, {
      interactive: false,
      timeoutMs: config.portalLogin.probeTimeoutMs ?? 8000
    });
  } finally {
    await page.close().catch(() => {});
  }
}

async function prepareWorkbenchCapturePage(page, config, options) {
  const targetUrl = absoluteUrl(
    config.baseUrl,
    config.portalLogin.probePath ?? config.portalLogin.loginPath ?? '/arcgis/orchard-workbench'
  );

  if (page.url() === 'about:blank') {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  }

  return waitForInteractiveWorkbench(page, config, {
    ...options,
    targetUrl,
    navigate: false
  });
}

async function waitForInteractiveWorkbench(page, config, options = {}) {
  const timeoutMs = Number(options.timeoutMs ?? 300000);
  const interactive = options.interactive === true;
  const targetUrl = options.targetUrl ?? absoluteUrl(
    config.baseUrl,
    config.portalLogin.probePath ?? config.portalLogin.loginPath ?? '/arcgis/orchard-workbench'
  );
  const selector = resolveAuthenticatedSelector(config);
  const started = Date.now();
  let lastReason = 'workbench-not-ready';
  let lastPortalClickAt = 0;
  let lastLoginUrl = '';
  let repeatedLoginClicks = 0;
  let promptLogged = false;

  if (options.navigate !== false && page.url() === 'about:blank') {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  }

  while (Date.now() - started < timeoutMs) {
    if (page.isClosed()) {
      return { ready: false, url: '<closed>', reason: 'browser-page-closed' };
    }

    const currentUrl = page.url();
    const workbenchVisible = selector
      ? await page.locator(selector).first().isVisible().catch(() => false)
      : isSameOrigin(currentUrl, config.baseUrl);

    if (workbenchVisible) {
      try {
        await waitForMapReady(page, {
          timeoutMs: Math.min(2500, Math.max(750, timeoutMs - (Date.now() - started))),
          settleMs: 0
        }, config);
        await proveMapInteractivity(page, config);
        return { ready: true, authenticated: true, url: page.url() };
      } catch (error) {
        lastReason = `workbench-map-not-interactive: ${cleanError(error)}`;
      }
    } else {
      lastReason = isSameOrigin(currentUrl, config.baseUrl)
        ? 'workbench-not-rendered'
        : 'external-login-page';
    }

    if (interactive) {
      const now = Date.now();
      // A Workbench with a slow/failed ArcGIS map is not a sign-in page. Clicking
      // generic 'Continue' controls there can close the live OAuth tab. Only
      // advance actual login pages, and never loop indefinitely on one URL.
      const isWorkbenchRoute = (() => {
        try { return new URL(currentUrl).pathname === new URL(targetUrl).pathname && isSameOrigin(currentUrl, config.baseUrl); }
        catch { return false; }
      })();
      if (lastLoginUrl !== currentUrl) { lastLoginUrl = currentUrl; repeatedLoginClicks = 0; }
      if (!workbenchVisible && !isWorkbenchRoute && repeatedLoginClicks < 2 && now - lastPortalClickAt >= 2500) {
        const action = await advanceInteractivePortalLogin(page, config);
        if (action) {
          repeatedLoginClicks++;
          lastPortalClickAt = now;
          console.log(`Portal login: ${action}. Waiting for Workbench...`);
        }
      }

      if (!promptLogged && !workbenchVisible) {
        promptLogged = true;
        console.log(
          `Complete any remaining KineX or GIS Portal sign-in in the browser. ` +
          `Capture will continue automatically when the map is interactive.`
        );
      }
    }

    await page.waitForTimeout(300).catch(() => {});
  }

  return {
    ready: false,
    authenticated: false,
    url: page.isClosed() ? '<closed>' : page.url(),
    reason: lastReason
  };
}

async function advanceInteractivePortalLogin(page, config) {
  const emailAction = await fillVisiblePortalEmail(page, config);
  if (emailAction) {
    return emailAction;
  }

  const clicked = await clickVisibleLoginControl(page);
  return clicked ? `clicked '${clicked}'` : null;
}

async function fillVisiblePortalEmail(page, config) {
  const email = resolvePortalEmail(config);
  if (!email) {
    return null;
  }

  const candidates = [
    page.locator("input[type='email']"),
    page.locator("input[autocomplete='username']"),
    page.locator("input[name='email' i]"),
    page.locator("input[name='username' i]"),
    page.locator("input[id*='email' i]"),
    page.locator("input[placeholder*='email' i]")
  ];

  let input = null;
  for (const candidate of candidates) {
    const count = await candidate.count().catch(() => 0);
    for (let index = 0; index < Math.min(count, 3); index++) {
      const control = candidate.nth(index);
      if (!await control.isVisible().catch(() => false)) {
        continue;
      }
      if (!await control.isEnabled().catch(() => true)) {
        continue;
      }
      input = control;
      break;
    }
    if (input) {
      break;
    }
  }

  if (!input) {
    return null;
  }

  const currentValue = await input.inputValue().catch(() => '');
  if (currentValue.trim() !== email) {
    await input.fill(email, { timeout: 3000 });
  }

  const submitCandidates = [
    page.getByRole('button', { name: DEFAULT_PORTAL_EMAIL_SUBMIT_PATTERN }),
    page.getByRole('link', { name: DEFAULT_PORTAL_EMAIL_SUBMIT_PATTERN }),
    page.locator("button[type='submit']"),
    page.locator("input[type='submit']")
  ];

  for (const candidate of submitCandidates) {
    const count = await candidate.count().catch(() => 0);
    for (let index = 0; index < Math.min(count, 3); index++) {
      const control = candidate.nth(index);
      if (!await control.isVisible().catch(() => false)) {
        continue;
      }
      if (!await control.isEnabled().catch(() => true)) {
        continue;
      }

      const navigated = page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => null);
      await control.click({ timeout: 3000 });
      await navigated;
      return 'entered the configured email and submitted it';
    }
  }

  await input.press('Enter', { timeout: 3000 }).catch(() => null);
  return 'entered the configured email';
}

function resolvePortalEmail(config) {
  const configured = String(config.portalLogin?.email ?? '').trim();
  if (configured) {
    return configured;
  }

  const environmentVariable = String(
    config.portalLogin?.emailEnvironmentVariable ?? DEFAULT_PORTAL_EMAIL_ENVIRONMENT_VARIABLE
  ).trim();

  return environmentVariable
    ? String(process.env[environmentVariable] ?? '').trim()
    : '';
}

async function clickVisibleLoginControl(page) {
  const candidates = [
    page.getByRole('button', { name: DEFAULT_PORTAL_SIGN_IN_PATTERN }),
    page.getByRole('link', { name: DEFAULT_PORTAL_SIGN_IN_PATTERN }),
    page.locator("button[type='submit']").filter({ hasText: /sign[ -]?in|log[ -]?in|login|continue/i }),
    page.locator("input[type='submit'][value*='Sign' i], input[type='submit'][value*='Log' i]")
  ];

  for (const candidate of candidates) {
    const count = await candidate.count().catch(() => 0);
    for (let index = 0; index < Math.min(count, 3); index++) {
      const control = candidate.nth(index);
      if (!await control.isVisible().catch(() => false)) {
        continue;
      }
      if (!await control.isEnabled().catch(() => true)) {
        continue;
      }

      const label = String(
        await control.innerText().catch(async () => await control.getAttribute('value').catch(() => ''))
      ).trim() || 'Sign in';

      const navigated = page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => null);
      await control.click({ timeout: 3000 }).catch(() => null);
      await navigated;
      return label;
    }
  }

  return null;
}

async function proveMapInteractivity(page, config) {
  const settings = config.map ?? {};
  const readySelector = String(settings.readySelector ?? "[data-guide='map-tool-home']");
  const canvasSelector = String(
    settings.canvasSelector ?? '.arcgis-map-view-container .esri-view-surface canvas'
  );

  const readyControl = page.locator(readySelector).first();
  if (!await readyControl.isVisible().catch(() => false) ||
      !await readyControl.isEnabled().catch(() => false)) {
    throw new Error('the Workbench map controls are not interactive');
  }

  // Hovering the enabled map control and moving across the canvas proves Playwright can interact
  // with the live ArcGIS view without changing the map extent or application state.
  await readyControl.hover({ timeout: 2000 });
  const canvas = page.locator(canvasSelector).first();
  const box = await canvas.boundingBox().catch(() => null);
  if (!box || box.width <= 0 || box.height <= 0) {
    throw new Error('the ArcGIS canvas is not interactive');
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

function resolveAuthenticatedSelector(config) {
  const configured = String(config.portalLogin.authenticatedSelector ?? '').trim();
  return configured || DEFAULT_WORKBENCH_AUTH_SELECTOR;
}

async function saveBrowserStorageState(context, config) {
  await ensureDirectory(path.dirname(config.authState));
  await context.storageState({
    path: config.authState,
    indexedDB: true
  });

  // Remove legacy Guide Builder ArcGIS/sessionStorage snapshots so older attempts cannot be
  // replayed accidentally. ArcGIS authentication now remains live in the capture tab instead.
  if (config.authSessionStorage) {
    await fs.rm(config.authSessionStorage, { force: true }).catch(() => {});
  }

  const storage = JSON.parse(await fs.readFile(config.authState, 'utf8'));
  const cookieCount = Array.isArray(storage.cookies) ? storage.cookies.length : 0;
  const originCount = Array.isArray(storage.origins) ? storage.origins.length : 0;
  const stat = await fs.stat(config.authState);

  console.log(
    `Saved browser login state to ${config.authState} ` +
    `(${stat.size} bytes, ${cookieCount} cookies, ${originCount} origins).`
  );
  console.log('ArcGIS credentials are intentionally not serialized by Guide Builder.');
}

async function getExistingFile(filePath) {
  if (!filePath) {
    return undefined;
  }

  try {
    await fs.access(filePath);
    return filePath;
  } catch {
    return undefined;
  }
}

async function closeSession(session) {
  if (!session) {
    return;
  }

  if (session.page && !session.page.isClosed()) {
    await session.page.close().catch(() => {});
  }
  await session.context?.close().catch(() => {});
  await session.browser?.close().catch(() => {});
}

function isSameOrigin(currentUrl, baseUrl) {
  try {
    return new URL(currentUrl).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

function cleanError(error) {
  return error instanceof Error ? error.message : String(error);
}
