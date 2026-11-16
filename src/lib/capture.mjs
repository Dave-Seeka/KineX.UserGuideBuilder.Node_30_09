import path from 'node:path';
import { addHighlightBoxes, removeHighlightBoxes } from './highlights.mjs';
import { resolveLocator } from './locator.mjs';
import { ensureDirectory } from './utils.mjs';

export async function captureScreenshot(page, capture, config, imageDirectory) {
  const annotatedPath = path.join(imageDirectory, capture.file);
  const captureBlank = capture.blank ?? config.screenshot.blank ?? true;
  const blankFile = captureBlank
    ? capture.blankFile ?? buildBlankFileName(capture.file, config.screenshot.blankSuffix)
    : null;
  const blankPath = blankFile ? path.join(imageDirectory, blankFile) : null;

  await ensureDirectory(path.dirname(annotatedPath));
  if (blankPath) await ensureDirectory(path.dirname(blankPath));

  const mask = (capture.maskSelectors ?? config.maskSelectors ?? [])
    .map((selector) => page.locator(selector));

  const captureTo = async (outputPath) => {
    const options = {
      path: outputPath,
      animations: config.screenshot.animations,
      caret: config.screenshot.caret,
      scale: config.screenshot.scale,
      mask,
      maskColor: config.screenshot.maskColor,
      timeout: capture.timeoutMs ?? config.defaultTimeoutMs
    };

    if (capture.target) {
      const target = resolveLocator(page, capture.target);
      await target.waitFor({
        state: 'visible',
        timeout: capture.timeoutMs ?? config.defaultTimeoutMs
      });
      await target.screenshot(options);
      return;
    }

    await page.screenshot({
      ...options,
      fullPage: capture.fullPage ?? false
    });
  };

  let highlights = await includeBusinessFormViewAction(page, capture.highlights ?? []);
  highlights = await includeWorkbenchDragControls(page, highlights);

  let legend = [];
  try {
    legend = await addHighlightBoxes(page, highlights, config.highlight);
    await captureTo(annotatedPath);
  } finally {
    await removeHighlightBoxes(page);
  }

  if (blankPath) {
    await captureTo(blankPath);
  }

  return {
    annotatedPath,
    blankPath,
    image: capture.file,
    blankImage: blankFile,
    legend
  };
}

export function buildBlankFileName(file, suffix = '-blank') {
  const extension = path.extname(file);
  const stem = extension ? file.slice(0, -extension.length) : file;
  return `${stem}${suffix || '-blank'}${extension || '.png'}`;
}

export async function includeBusinessFormViewAction(page, highlights = []) {
  const selector = "[data-guide='business-form-full-screen']";
  const existing = highlights.some((highlight) => highlight?.locator?.selector === selector);
  if (existing || typeof page?.locator !== 'function') {
    return highlights;
  }

  const locator = page.locator(selector);
  if (!locator || typeof locator.first !== 'function') {
    return highlights;
  }

  const button = locator.first();
  const visible = typeof button?.isVisible === 'function'
    ? await button.isVisible().catch(() => false)
    : false;
  if (!visible) {
    return highlights;
  }

  const ariaLabel = typeof button.getAttribute === 'function'
    ? await button.getAttribute('aria-label').catch(() => null)
    : null;
  const explicitNumbers = highlights
    .map((highlight, index) => Number(highlight?.number ?? index + 1))
    .filter(Number.isFinite);
  const number = (explicitNumbers.length ? Math.max(...explicitNumbers) : 0) + 1;

  return [
    ...highlights,
    {
      locator: { selector },
      label: ariaLabel?.trim() || 'Business Form view',
      number,
      padding: 6,
      optional: true
    }
  ];
}

export async function includeWorkbenchDragControls(page, highlights = []) {
  const controls = [
    {
      selector: "[role='separator'][aria-label='Resize sidebar and work area']",
      fallbackLabel: 'Resize sidebar and work area',
      padding: 4
    },
    {
      selector: "[role='separator'][aria-label='Resize map and business form']",
      fallbackLabel: 'Resize map and business form',
      padding: 4
    },
    {
      selector: "[data-guide='workbench-map-toolbar-drag']",
      fallbackLabel: 'Move map tools',
      padding: 5
    }
  ];

  let result = highlights;
  for (const control of controls) {
    result = await includeVisibleOptionalControl(page, result, control);
  }

  return result;
}

async function includeVisibleOptionalControl(page, highlights, control) {
  const existing = highlights.some((highlight) => highlight?.locator?.selector === control.selector);
  if (existing || typeof page?.locator !== 'function') {
    return highlights;
  }

  const locator = page.locator(control.selector);
  if (!locator || typeof locator.first !== 'function') {
    return highlights;
  }

  const element = locator.first();
  const visible = typeof element?.isVisible === 'function'
    ? await element.isVisible().catch(() => false)
    : false;
  if (!visible) {
    return highlights;
  }

  const ariaLabel = typeof element.getAttribute === 'function'
    ? await element.getAttribute('aria-label').catch(() => null)
    : null;
  const explicitNumbers = highlights
    .map((highlight, index) => Number(highlight?.number ?? index + 1))
    .filter(Number.isFinite);
  const number = (explicitNumbers.length ? Math.max(...explicitNumbers) : 0) + 1;

  return [
    ...highlights,
    {
      locator: { selector: control.selector },
      label: ariaLabel?.trim() || control.fallbackLabel,
      number,
      padding: control.padding,
      optional: true
    }
  ];
}
