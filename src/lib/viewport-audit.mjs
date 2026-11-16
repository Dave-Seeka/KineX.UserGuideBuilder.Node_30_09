import { isLaptopProfile } from './profiles.mjs';

const DEFAULT_LAPTOP_VIEWPORT = Object.freeze({ width: 1366, height: 768 });

export function resolveViewport(flow, config, args = {}) {
  const profile = String(args.profile ?? config.coverage?.profile ?? 'full')
    .trim()
    .toLowerCase();

  if (isLaptopProfile(profile)) {
    return normalizeViewport(
      config.viewports?.laptop ?? DEFAULT_LAPTOP_VIEWPORT,
      DEFAULT_LAPTOP_VIEWPORT
    );
  }

  return normalizeViewport(
    flow.viewport ?? config.viewport ?? { width: 1440, height: 900 },
    { width: 1440, height: 900 }
  );
}

export async function auditViewport(page, config, args = {}) {
  const profile = String(args.profile ?? config.coverage?.profile ?? 'full')
    .trim()
    .toLowerCase();

  if (!isLaptopProfile(profile) || config.viewportAudit?.enabled === false) {
    return [];
  }

  const expected = resolveViewport({}, config, { profile });
  const actual = page.viewportSize();
  if (!actual || actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error(
      `Laptop viewport assertion failed. Expected ${expected.width}x${expected.height}, ` +
      `actual ${actual ? `${actual.width}x${actual.height}` : 'unknown'}.`
    );
  }

  const horizontalTolerance = Number(
    config.viewportAudit?.horizontalOverflowTolerance ?? 2
  );
  const pageMetrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    documentWidth: Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth ?? 0
    ),
    documentHeight: Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight ?? 0
    )
  }));

  const horizontalOverflow = pageMetrics.documentWidth - pageMetrics.innerWidth;
  if (horizontalOverflow > horizontalTolerance) {
    throw new Error(
      `Laptop layout has ${horizontalOverflow}px of horizontal page overflow at ` +
      `${actual.width}x${actual.height}. Document width=${pageMetrics.documentWidth}, ` +
      `viewport width=${pageMetrics.innerWidth}.`
    );
  }

  const overlayChecks = await auditVisibleOverlays(page, config, actual);

  return [
    result('assertViewport', 'Laptop viewport', `${actual.width}x${actual.height} viewport verified.`),
    result(
      'assertNoHorizontalOverflow',
      'No horizontal overflow',
      `Document width ${pageMetrics.documentWidth}px fits the ${pageMetrics.innerWidth}px viewport.`
    ),
    result(
      'assertOverlaysWithinViewport',
      'Overlays fit viewport',
      `${overlayChecks} visible overlay${overlayChecks === 1 ? '' : 's'} fit within the laptop viewport.`
    )
  ];
}

async function auditVisibleOverlays(page, config, viewport) {
  const selectors = config.viewportAudit?.overlaySelectors ?? [
    "[data-guide='entity-create-drawer']",
    "[data-guide='map-basemap-menu']",
    "[data-guide='map-layers-menu']",
    "[data-guide='geometry-choice']",
    "[data-guide='geometry-task-panel']",
    "[role='dialog']"
  ];
  const tolerance = Number(config.viewportAudit?.overlayTolerance ?? 3);
  const locator = page.locator(selectors.join(', '));
  const count = await locator.count().catch(() => 0);
  const seen = new Set();
  let checked = 0;

  for (let index = 0; index < count; index++) {
    const candidate = locator.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) {
      continue;
    }

    const handle = await candidate.elementHandle().catch(() => null);
    if (!handle) continue;
    const identity = await handle.evaluate((element) => {
      if (!element.dataset.viewportAuditId) {
        element.dataset.viewportAuditId = `${Date.now()}-${Math.random()}`;
      }
      return element.dataset.viewportAuditId;
    }).catch(() => null);
    if (identity && seen.has(identity)) continue;
    if (identity) seen.add(identity);

    const box = await candidate.boundingBox();
    if (!box) continue;
    checked++;

    const outside = {
      left: Math.max(0, -box.x),
      top: Math.max(0, -box.y),
      right: Math.max(0, box.x + box.width - viewport.width),
      bottom: Math.max(0, box.y + box.height - viewport.height)
    };

    if (Object.values(outside).some((amount) => amount > tolerance)) {
      const metadata = await candidate.evaluate((element) => ({
        tag: element.tagName.toLowerCase(),
        guide: element.getAttribute('data-guide'),
        role: element.getAttribute('role'),
        text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
      })).catch(() => ({ tag: 'unknown', guide: null, role: null, text: '' }));

      throw new Error(
        `Visible overlay extends outside the ${viewport.width}x${viewport.height} laptop viewport: ` +
        `${JSON.stringify(metadata)}; box=${JSON.stringify(roundBox(box))}; ` +
        `outside=${JSON.stringify(roundBox(outside))}.`
      );
    }
  }

  return checked;
}

function normalizeViewport(value, fallback) {
  const width = Number(value?.width ?? fallback.width);
  const height = Number(value?.height ?? fallback.height);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error(`Invalid viewport: ${JSON.stringify(value)}.`);
  }
  return { width, height };
}

function roundBox(value) {
  return Object.fromEntries(
    Object.entries(value).map(([key, number]) => [key, Math.round(Number(number) * 100) / 100])
  );
}

function result(type, label, summary) {
  return { type, label, summary };
}
