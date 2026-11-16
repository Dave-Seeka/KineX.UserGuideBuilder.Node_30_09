const DEFAULT_ROUTE = '/arcgis/orchard-workbench';

export function shouldAutoWaitForMap(targetUrl, config = {}) {
  const settings = config.map ?? {};
  if (settings.autoWaitOnWorkbenchNavigation === false) {
    return false;
  }

  const workbenchPath = String(settings.workbenchPath ?? DEFAULT_ROUTE).trim();
  if (!workbenchPath) {
    return false;
  }

  try {
    const url = new URL(targetUrl, config.baseUrl ?? 'https://kinex.test:7004');
    return url.pathname === workbenchPath || url.pathname.startsWith(`${workbenchPath}/`);
  } catch {
    return String(targetUrl ?? '').includes(workbenchPath);
  }
}

export async function waitForMapReady(page, action = {}, config = {}) {
  const settings = {
    ...(config.map ?? {}),
    ...(action.map ?? {})
  };

  const timeoutMs = positiveNumber(
    action.timeoutMs ?? settings.timeoutMs,
    120000
  );
  const settleMs = nonNegativeNumber(
    action.settleMs ?? settings.settleMs,
    8000
  );
  const pollIntervalMs = positiveNumber(
    action.pollIntervalMs ?? settings.pollIntervalMs,
    250
  );
  const readySelector = String(
    action.readySelector ?? settings.readySelector ?? "[data-guide='map-tool-home']"
  );
  const surfaceSelector = String(
    action.surfaceSelector ?? settings.surfaceSelector ?? '.arcgis-map-view-container .esri-view-surface'
  );
  const canvasSelector = String(
    action.canvasSelector ?? settings.canvasSelector ?? '.arcgis-map-view-container .esri-view-surface canvas'
  );
  const errorSelector = String(
    action.errorSelector ?? settings.errorSelector ?? '.arcgis-map-view-error'
  );
  const requireCanvas = action.requireCanvas ?? settings.requireCanvas ?? true;
  const minimumWidth = nonNegativeNumber(
    action.minimumWidth ?? settings.minimumWidth,
    320
  );
  const minimumHeight = nonNegativeNumber(
    action.minimumHeight ?? settings.minimumHeight,
    200
  );

  const started = Date.now();
  let diagnostics = emptyDiagnostics();

  while (Date.now() - started < timeoutMs) {
    diagnostics = await readMapDiagnostics(page, {
      readySelector,
      surfaceSelector,
      canvasSelector,
      errorSelector,
      minimumWidth,
      minimumHeight
    });

    if (
      diagnostics.enabledReadyControls > 0 &&
      diagnostics.validSurfaces > 0 &&
      (!requireCanvas || diagnostics.validCanvases > 0)
    ) {
      if (settleMs > 0) {
        await page.waitForTimeout(settleMs);
        diagnostics = await readMapDiagnostics(page, {
          readySelector,
          surfaceSelector,
          canvasSelector,
          errorSelector,
          minimumWidth,
          minimumHeight
        });
      }

      if (
        diagnostics.enabledReadyControls > 0 &&
        diagnostics.validSurfaces > 0 &&
        (!requireCanvas || diagnostics.validCanvases > 0)
      ) {
        return diagnostics;
      }
    }

    await page.waitForTimeout(pollIntervalMs);
  }

  const errorDetail = diagnostics.errorText
    ? ` ArcGIS reported: ${diagnostics.errorText}`
    : '';
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for the ArcGIS map to finish loading. ` +
    `url=${page.url()}, ` +
    `readyControls=${diagnostics.readyControls}, ` +
    `enabled=${diagnostics.enabledReadyControls}, ` +
    `surfaces=${diagnostics.validSurfaces}/${diagnostics.surfaces}, ` +
    `canvases=${diagnostics.validCanvases}/${diagnostics.canvases}.` +
    errorDetail
  );
}

async function readMapDiagnostics(page, settings) {
  const ready = page.locator(settings.readySelector);
  const surfaces = page.locator(settings.surfaceSelector);
  const canvases = page.locator(settings.canvasSelector);
  const errors = page.locator(settings.errorSelector);

  const readyControls = await ready.count().catch(() => 0);
  const surfaceCount = await surfaces.count().catch(() => 0);
  const canvasCount = await canvases.count().catch(() => 0);

  let enabledReadyControls = 0;
  for (let index = 0; index < readyControls; index++) {
    const candidate = ready.nth(index);
    const attached = await candidate.isVisible().catch(() => false) ||
      await candidate.isEnabled().catch(() => false);
    const enabled = attached && await candidate.isEnabled().catch(() => false);
    if (enabled) {
      enabledReadyControls++;
    }
  }

  const validSurfaces = await countValidBoxes(
    surfaces,
    surfaceCount,
    settings.minimumWidth,
    settings.minimumHeight
  );
  const validCanvases = await countValidBoxes(
    canvases,
    canvasCount,
    settings.minimumWidth,
    settings.minimumHeight
  );

  let errorText = '';
  const errorCount = await errors.count().catch(() => 0);
  for (let index = 0; index < errorCount; index++) {
    const candidate = errors.nth(index);
    if (!await candidate.isVisible().catch(() => false)) {
      continue;
    }
    errorText = String(await candidate.innerText().catch(() => '')).trim();
    if (errorText) {
      break;
    }
  }

  return {
    readyControls,
    enabledReadyControls,
    surfaces: surfaceCount,
    validSurfaces,
    canvases: canvasCount,
    validCanvases,
    errorText
  };
}

async function countValidBoxes(locator, count, minimumWidth, minimumHeight) {
  let valid = 0;
  for (let index = 0; index < count; index++) {
    const candidate = locator.nth(index);
    if (!await candidate.isVisible().catch(() => false)) {
      continue;
    }

    const box = await candidate.boundingBox().catch(() => null);
    if (
      box &&
      box.width >= minimumWidth &&
      box.height >= minimumHeight
    ) {
      valid++;
    }
  }
  return valid;
}

function emptyDiagnostics() {
  return {
    readyControls: 0,
    enabledReadyControls: 0,
    surfaces: 0,
    validSurfaces: 0,
    canvases: 0,
    validCanvases: 0,
    errorText: ''
  };
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegativeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}
