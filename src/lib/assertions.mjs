import { resolveLocator } from './locator.mjs';

export const assertionTypes = new Set([
  'assertVisible',
  'assertHidden',
  'assertEnabled',
  'assertDisabled',
  'assertText',
  'assertValue',
  'assertCount',
  'assertAttribute',
  'assertUrl',
  'assertToast',
  'assertNoToast'
]);

export function isAssertionType(type) {
  return assertionTypes.has(type);
}

export async function runAssertion(page, action, config, runtime, helpers = {}) {
  const timeoutMs = Number(action.timeoutMs ?? config.defaultTimeoutMs ?? 20000);
  const template = (value) => helpers.resolveTemplate
    ? helpers.resolveTemplate(value, config, runtime)
    : value;

  switch (action.type) {
    case 'assertVisible': {
      const locator = resolveActionLocator(page, action);
      await locator.waitFor({ state: 'visible', timeout: timeoutMs });
      return result(action, `Visible: ${describeLocator(action.locator)}`);
    }
    case 'assertHidden': {
      const locator = resolveActionLocator(page, action);
      await locator.waitFor({ state: 'hidden', timeout: timeoutMs });
      return result(action, `Hidden: ${describeLocator(action.locator)}`);
    }
    case 'assertEnabled': {
      const locator = resolveActionLocator(page, action);
      await waitForState(page, locator, timeoutMs, async (candidate) => candidate.isEnabled(), 'enabled');
      return result(action, `Enabled: ${describeLocator(action.locator)}`);
    }
    case 'assertDisabled': {
      const locator = resolveActionLocator(page, action);
      await waitForState(page, locator, timeoutMs, async (candidate) => !(await candidate.isEnabled()), 'disabled');
      return result(action, `Disabled: ${describeLocator(action.locator)}`);
    }
    case 'assertText': {
      const locator = await firstVisible(resolveActionLocator(page, action), timeoutMs, page);
      const expectation = buildTextExpectation(action, template);
      const actual = await waitForTextMatch(page, locator, expectation, timeoutMs, 'innerText');
      return result(action, action.summary ?? `Text matched: ${expectation.description} (${actual})`);
    }
    case 'assertValue': {
      const locator = await firstVisible(resolveActionLocator(page, action), timeoutMs, page);
      const expectation = buildTextExpectation(action, template);
      const actual = await waitForTextMatch(page, locator, expectation, timeoutMs, 'inputValue');
      return result(action, action.summary ?? `Value matched: ${expectation.description} (${actual})`);
    }
    case 'assertCount': {
      const locator = resolveActionLocator(page, action);
      const visibleOnly = action.visibleOnly === true;
      const count = await waitForCountMatch(page, locator, action, timeoutMs, visibleOnly);
      return result(action, action.summary ?? `${visibleOnly ? 'Visible ' : ''}count verified: ${count}`);
    }
    case 'assertAttribute': {
      const locator = await firstVisible(resolveActionLocator(page, action), timeoutMs, page);
      const expected = {
        exact: template(action.value ?? action.exact),
        contains: template(action.contains),
        matches: action.matches
      };
      const started = Date.now();
      let actual = await locator.getAttribute(action.name);
      while (Date.now() - started < timeoutMs && !attributeMatches(actual, expected)) {
        await page.waitForTimeout(100);
        actual = await locator.getAttribute(action.name);
      }
      if (!attributeMatches(actual, expected)) {
        throw new Error(`Attribute assertion failed for '${action.name}'. Expected ${describeExpectation(expected)}, actual '${actual}'.`);
      }
      return result(action, action.summary ?? `${action.name} matched: ${describeExpectation(expected)}`);
    }
    case 'assertUrl': {
      const expected = {
        exact: template(action.url ?? action.exact),
        contains: template(action.contains),
        matches: action.matches
      };
      const started = Date.now();
      let actual = page.url();
      while (Date.now() - started < timeoutMs && !urlMatches(actual, expected)) {
        await page.waitForTimeout(100);
        actual = page.url();
      }
      if (!urlMatches(actual, expected)) {
        throw new Error(`URL assertion failed. Expected ${describeExpectation(expected)}, actual '${actual}'.`);
      }
      return result(action, action.summary ?? `URL matched: ${describeExpectation(expected)}`);
    }
    case 'assertToast':
      return assertToast(page, action, config, runtime, template);
    case 'assertNoToast':
      return assertNoToast(page, action, config, runtime, template);
    default:
      throw new Error(`Unsupported assertion type '${action.type}'.`);
  }
}


async function waitForTextMatch(page, locator, expectation, timeoutMs, reader) {
  const started = Date.now();
  let actual = '';
  while (Date.now() - started < timeoutMs) {
    actual = normalize(await locator[reader]().catch(() => ''));
    if (textMatches(actual, expectation)) return actual;
    await page.waitForTimeout(100);
  }
  throw new Error(`Text assertion failed. Expected ${expectation.description}, actual '${actual}'.`);
}

async function waitForCountMatch(page, locator, action, timeoutMs, visibleOnly) {
  const started = Date.now();
  let count = 0;
  while (Date.now() - started < timeoutMs) {
    count = visibleOnly ? await visibleCount(locator) : await locator.count().catch(() => 0);
    if (countMatches(count, action)) return count;
    await page.waitForTimeout(100);
  }
  assertCount(count, action);
  return count;
}

function countMatches(actual, action) {
  const exact = action.count ?? action.exact;
  if (exact !== undefined && actual !== Number(exact)) return false;
  if (action.min !== undefined && actual < Number(action.min)) return false;
  if (action.max !== undefined && actual > Number(action.max)) return false;
  return exact !== undefined || action.min !== undefined || action.max !== undefined;
}

async function assertToast(page, action, config, runtime, template) {
  const timeoutMs = Number(action.timeoutMs ?? config.toast?.timeoutMs ?? config.defaultTimeoutMs ?? 20000);
  const locator = toastLocator(page, action, config);
  const expectation = buildTextExpectation(action, template, { optional: true });

  if (!action.locator && !expectation.hasExpectation && !action.tone && !action.severity && !action.kind) {
    throw new Error('assertToast requires a locator, text expectation, or tone/severity to avoid matching an unrelated status message.');
  }

  const started = Date.now();
  let matched = null;
  let diagnostics = [];

  while (Date.now() - started < timeoutMs) {
    const count = await locator.count().catch(() => 0);
    diagnostics = [];
    for (let index = 0; index < count; index++) {
      const candidate = locator.nth(index);
      if (!(await candidate.isVisible().catch(() => false))) continue;

      const metadata = await candidate.evaluate((element) => ({
        text: element.textContent?.trim() ?? '',
        role: element.getAttribute('role') ?? '',
        tone: element.getAttribute('data-tone') ?? element.getAttribute('data-severity') ?? element.getAttribute('data-type') ?? '',
        classes: element.className?.toString() ?? '',
        ariaLive: element.getAttribute('aria-live') ?? ''
      })).catch(() => ({ text: '', role: '', tone: '', classes: '', ariaLive: '' }));
      diagnostics.push(metadata);

      if (expectation.hasExpectation) {
        try {
          assertTextMatches(normalize(metadata.text), expectation, 'Toast text did not match');
        } catch {
          continue;
        }
      }

      const expectedTone = normalize(action.tone ?? action.severity ?? action.kind ?? '');
      if (expectedTone) {
        const toneSource = normalize(`${metadata.tone} ${metadata.classes} ${metadata.role}`);
        if (!toneSource.includes(expectedTone)) continue;
      }

      matched = { candidate, metadata };
      break;
    }

    if (matched) break;
    await page.waitForTimeout(100);
  }

  if (!matched) {
    throw new Error(
      `Expected toast was not found within ${timeoutMs}ms. ` +
      `Expectation: ${expectation.hasExpectation ? expectation.description : 'any matching toast'}; ` +
      `visible candidates: ${JSON.stringify(diagnostics.slice(0, 5))}`
    );
  }

  const summaryText = normalize(matched.metadata.text).slice(0, 180);

  if (action.waitForDismiss === true || action.dismissedWithinMs) {
    const dismissTimeoutMs = Number(action.dismissedWithinMs ?? config.toast?.dismissTimeoutMs ?? 10000);
    await matched.candidate.waitFor({ state: 'hidden', timeout: dismissTimeoutMs }).catch(async () => {
      if (await matched.candidate.isVisible().catch(() => false)) {
        throw new Error(`Toast did not dismiss within ${dismissTimeoutMs}ms: '${summaryText}'.`);
      }
    });
  }

  return result(action, action.summary ?? `Toast verified: ${summaryText || expectation.description}`);
}

async function assertNoToast(page, action, config, runtime, template) {
  const durationMs = Number(action.durationMs ?? action.timeoutMs ?? 1500);
  const locator = toastLocator(page, action, config);
  const expectation = buildTextExpectation(action, template, { optional: true });
  const started = Date.now();

  while (Date.now() - started < durationMs) {
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index++) {
      const candidate = locator.nth(index);
      if (!(await candidate.isVisible().catch(() => false))) continue;
      const text = normalize(await candidate.innerText().catch(() => ''));
      if (!expectation.hasExpectation || textMatches(text, expectation)) {
        throw new Error(`Unexpected toast was visible: '${text.slice(0, 180)}'.`);
      }
    }
    await page.waitForTimeout(100);
  }

  return result(action, action.summary ?? 'No matching toast appeared.');
}

function toastLocator(page, action, config) {
  if (action.locator) return resolveActionLocator(page, action);
  const selectors = action.selectors ?? config.toast?.selectors ?? [
    "[data-guide='toast']",
    "[data-guide*='toast']",
    '.ui-toast',
    '.e-toast',
    '.e-toast-container .e-toast',
    "[role='alert'][class*='toast']",
    "[role='status'][class*='toast']",
    "[role='alert']",
    "[role='status']"
  ];
  return page.locator(selectors.join(', '));
}

function resolveActionLocator(page, action) {
  let locator = resolveLocator(page, action.locator);
  if (Number.isInteger(action.nth)) locator = locator.nth(action.nth);
  return locator;
}

async function waitForState(page, locator, timeoutMs, predicate, stateName) {
  const started = Date.now();
  await locator.waitFor({ state: 'visible', timeout: timeoutMs });
  while (Date.now() - started < timeoutMs) {
    if (await predicate(locator).catch(() => false)) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`Element did not become ${stateName} within ${timeoutMs}ms.`);
}

async function firstVisible(locator, timeoutMs, page) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index++) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`No visible element found within ${timeoutMs}ms.`);
}

async function visibleCount(locator) {
  const count = await locator.count();
  let visible = 0;
  for (let index = 0; index < count; index++) {
    if (await locator.nth(index).isVisible().catch(() => false)) visible++;
  }
  return visible;
}

function assertCount(actual, action) {
  const exact = action.count ?? action.exact;
  if (exact !== undefined && actual !== Number(exact)) {
    throw new Error(`Count assertion failed. Expected ${Number(exact)}, actual ${actual}.`);
  }
  if (action.min !== undefined && actual < Number(action.min)) {
    throw new Error(`Count assertion failed. Expected at least ${Number(action.min)}, actual ${actual}.`);
  }
  if (action.max !== undefined && actual > Number(action.max)) {
    throw new Error(`Count assertion failed. Expected at most ${Number(action.max)}, actual ${actual}.`);
  }
}

function buildTextExpectation(action, template, options = {}) {
  const exactValue = action.text ?? action.exactText;
  const containsValue = action.contains;
  const matchesValue = action.matches;
  const expected = {
    exact: exactValue === undefined ? undefined : normalize(template(exactValue)),
    contains: containsValue === undefined ? undefined : normalize(template(containsValue)),
    matches: matchesValue
  };
  expected.hasExpectation = expected.exact !== undefined || expected.contains !== undefined || expected.matches !== undefined;
  expected.description = describeExpectation(expected);
  if (!options.optional && !expected.hasExpectation) {
    throw new Error(`${action.type} requires one of text, exactText, contains, or matches.`);
  }
  return expected;
}

function assertTextMatches(actual, expectation, prefix) {
  if (!textMatches(actual, expectation)) {
    throw new Error(`${prefix}. Expected ${expectation.description}, actual '${actual}'.`);
  }
}

function textMatches(actual, expectation) {
  if (expectation.exact !== undefined && actual !== expectation.exact) return false;
  if (expectation.contains !== undefined && !actual.includes(expectation.contains)) return false;
  if (expectation.matches !== undefined && !(new RegExp(expectation.matches, 'i')).test(actual)) return false;
  return true;
}


function attributeMatches(actual, expected) {
  const normalized = actual === null ? '' : String(actual);
  if (expected.exact !== undefined && expected.exact !== null && normalized !== String(expected.exact)) return false;
  if (expected.contains !== undefined && expected.contains !== null && !normalized.includes(String(expected.contains))) return false;
  if (expected.matches !== undefined && expected.matches !== null && !(new RegExp(expected.matches, 'i')).test(normalized)) return false;
  return expected.exact !== undefined || expected.contains !== undefined || expected.matches !== undefined;
}

function urlMatches(actual, expected) {
  if (expected.exact !== undefined && expected.exact !== null && actual !== expected.exact) return false;
  if (expected.contains !== undefined && expected.contains !== null && !actual.includes(expected.contains)) return false;
  if (expected.matches !== undefined && expected.matches !== null && !(new RegExp(expected.matches, 'i')).test(actual)) return false;
  return expected.exact !== undefined || expected.contains !== undefined || expected.matches !== undefined;
}

function describeExpectation(expected) {
  if (expected.exact !== undefined && expected.exact !== null) return `exactly '${expected.exact}'`;
  if (expected.contains !== undefined && expected.contains !== null) return `containing '${expected.contains}'`;
  if (expected.matches !== undefined && expected.matches !== null) return `matching /${expected.matches}/i`;
  return 'the configured expectation';
}

function describeLocator(locator) {
  return typeof locator === 'string' ? locator : JSON.stringify(locator);
}

function normalize(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function result(action, summary) {
  return {
    type: action.type,
    label: action.label ?? action.name ?? defaultLabel(action.type),
    summary
  };
}

function defaultLabel(type) {
  return type
    .replace(/^assert/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim() || 'Check';
}
