import { resolveLocator } from './locator.mjs';

const overlayAttribute = 'data-kinex-guide-overlay';
const defaultBoxTimeoutMs = 5000;
const stableTolerance = 1;

export async function addHighlightBoxes(page, highlights, defaults) {
  if (!highlights?.length) {
    return [];
  }

  await removeHighlightBoxes(page);
  const boxes = [];

  for (const [index, highlight] of highlights.entries()) {
    const locator = resolveLocator(page, highlight.locator);
    const box = await getStableVisibleBox(
      page,
      locator,
      highlight.boxTimeoutMs ?? defaults.boxTimeoutMs ?? defaultBoxTimeoutMs
    );

    if (!box) {
      if (highlight.optional) continue;

      const diagnostics = await describeLocator(locator);
      throw new Error(
        `Unable to calculate a stable highlight box for ${JSON.stringify(highlight.locator)}. ` +
        `Matched ${diagnostics.count} element(s); visible=${diagnostics.visibleCount}; ` +
        `nonZero=${diagnostics.nonZeroCount}. The element may still be re-rendering or hidden by a responsive layout.`
      );
    }

    boxes.push({
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      number: highlight.number ?? index + 1,
      label: highlight.label ?? '',
      color: highlight.color ?? defaults.color,
      padding: highlight.padding ?? defaults.padding,
      lineWidth: highlight.lineWidth ?? defaults.lineWidth,
      labelBackground: highlight.labelBackground ?? highlight.color ?? defaults.labelBackground,
      labelColor: highlight.labelColor ?? defaults.labelColor
    });
  }

  await page.evaluate(({ boxes: overlayBoxes, overlayAttribute: attribute }) => {
    for (const box of overlayBoxes) {
      const padding = Number(box.padding ?? 0);
      const x = Math.max(0, box.x - padding);
      const y = Math.max(0, box.y - padding);
      const width = box.width + padding * 2;
      const height = box.height + padding * 2;

      const frame = document.createElement('div');
      frame.setAttribute(attribute, 'frame');
      Object.assign(frame.style, {
        position: 'fixed',
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
        boxSizing: 'border-box',
        border: `${box.lineWidth}px solid ${box.color}`,
        borderRadius: '6px',
        boxShadow: '0 0 0 2px rgba(255,255,255,.95), 0 4px 18px rgba(0,0,0,.25)',
        pointerEvents: 'none',
        zIndex: '2147483646'
      });

      const badge = document.createElement('div');
      badge.setAttribute(attribute, 'label');
      badge.textContent = String(box.number);
      Object.assign(badge.style, {
        position: 'absolute',
        left: x >= 18 ? '-14px' : '4px',
        top: y >= 18 ? '-14px' : '4px',
        display: 'grid',
        placeItems: 'center',
        minWidth: '28px',
        height: '28px',
        padding: '0 7px',
        border: '2px solid #ffffff',
        borderRadius: '999px',
        background: box.labelBackground,
        color: box.labelColor,
        fontFamily: 'Arial, sans-serif',
        fontSize: '12px',
        fontWeight: '800',
        lineHeight: '1',
        boxShadow: '0 2px 8px rgba(0,0,0,.28)'
      });

      frame.appendChild(badge);
      document.body.appendChild(frame);
    }
  }, { boxes, overlayAttribute });

  return boxes.map((box) => ({
    number: box.number,
    label: box.label || `Highlight ${box.number}`,
    color: box.labelBackground,
    textColor: box.labelColor
  }));
}

export async function removeHighlightBoxes(page) {
  await page.evaluate((attribute) => {
    document.querySelectorAll(`[${attribute}]`).forEach((element) => element.remove());
  }, overlayAttribute).catch(() => {});
}

async function getStableVisibleBox(page, locator, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const count = await locator.count().catch(() => 0);

    for (let index = 0; index < count; index++) {
      const candidate = locator.nth(index);
      const visible = await candidate.isVisible().catch(() => false);
      if (!visible) continue;

      await candidate.scrollIntoViewIfNeeded().catch(() => {});
      await waitForTwoAnimationFrames(page);

      const first = await candidate.boundingBox().catch(() => null);
      if (!isUsableBox(first)) continue;

      await waitForTwoAnimationFrames(page);
      const second = await candidate.boundingBox().catch(() => null);
      if (isUsableBox(second) && boxesAreStable(first, second)) {
        return second;
      }
    }

    await page.waitForTimeout(100);
  }

  return null;
}

async function waitForTwoAnimationFrames(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  })).catch(() => {});
}

function isUsableBox(box) {
  return box
    && Number.isFinite(box.x)
    && Number.isFinite(box.y)
    && Number.isFinite(box.width)
    && Number.isFinite(box.height)
    && box.width > 0.5
    && box.height > 0.5;
}

function boxesAreStable(first, second) {
  return Math.abs(first.x - second.x) <= stableTolerance
    && Math.abs(first.y - second.y) <= stableTolerance
    && Math.abs(first.width - second.width) <= stableTolerance
    && Math.abs(first.height - second.height) <= stableTolerance;
}

async function describeLocator(locator) {
  const count = await locator.count().catch(() => 0);
  let visibleCount = 0;
  let nonZeroCount = 0;

  for (let index = 0; index < count; index++) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      visibleCount++;
    }

    const box = await candidate.boundingBox().catch(() => null);
    if (isUsableBox(box)) {
      nonZeroCount++;
    }
  }

  return { count, visibleCount, nonZeroCount };
}
