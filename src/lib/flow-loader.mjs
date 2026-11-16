import fs from 'node:fs/promises';
import path from 'node:path';

const supportedActionTypes = new Set([
  'goto', 'click', 'clickIfVisible', 'clickCandidateUntil', 'clickUntilVisible', 'clickFirst',
  'fill', 'fillValidOrchardPin', 'continueOrchardDetailsWithUniquePin', 'fillFromText', 'selectOption', 'selectFirstOption', 'selectFirstOptionIfEmpty', 'check', 'uncheck',
  'press', 'hover', 'dragBy', 'rememberText', 'rememberValue', 'rememberAttribute', 'scrollIntoView', 'waitFor', 'waitForEnabled', 'require',
  'skipIfVisible', 'waitForLoadState', 'waitForTimeout', 'waitForMapReady', 'preflightFixturePlacement', 'drawFixturePolygon', 'injectFixturePolygon', 'assertFixtureGeometryPublished', 'verifyBlockHectareFixture', 'selectOptionByAliases', 'assertFixtureScope', 'assertMaMutationScope', 'assertE2eTestHost', 'provisionE2eGrowerSupplier', 'stageFixtureGrowerSupplier', 'openFixtureOrchardForMa', 'selectFixtureMaBlock', 'verifyFixtureMaCode', 'verifyFixtureMaMembership', 'selectMaSafeGuideOrchard', 'selectExistingMaFixtureOrchard', 'ensureExistingMaFixtureSupplier', 'fillExistingMaFixtureDetails', 'selectExistingMaFixtureBlock', 'submitExistingMaFixture', 'setViewport', 'evaluate',
  'assertVisible', 'assertHidden', 'assertEnabled', 'assertDisabled', 'assertText',
  'assertValue', 'assertCount', 'assertAttribute', 'assertUrl', 'assertToast', 'assertNoToast'
]);

const assertionActionTypes = new Set([
  'assertVisible', 'assertHidden', 'assertEnabled', 'assertDisabled', 'assertText',
  'assertValue', 'assertCount', 'assertAttribute', 'assertUrl', 'assertToast', 'assertNoToast'
]);

export async function loadFlow(flowPath) {
  const absolutePath = path.resolve(flowPath);
  const flow = JSON.parse(await fs.readFile(absolutePath, 'utf8'));
  validateFlow(flow, absolutePath);
  return { flow, absolutePath };
}

export async function listFlowFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const jsonEntries = entries.filter((entry) =>
    entry.isFile() && entry.name.endsWith('.json'));
  const orderedEntries = jsonEntries.filter((entry) => /^\d{3}-.+\.json$/i.test(entry.name));

  // The packaged Orchard Workbench suite uses three-digit ordering prefixes. When
  // those files are present, ignore old unnumbered starter/demo flows that may have
  // survived an in-place upgrade of an earlier builder folder.
  const selectedEntries = orderedEntries.length > 0 ? orderedEntries : jsonEntries;

  return selectedEntries
    .map((entry) => path.join(directory, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

export function validateFlow(flow, source = '<flow>') {
  const failures = [];

  if (!flow || typeof flow !== 'object') failures.push('root must be an object');
  if (!nonEmpty(flow.id)) failures.push('id is required');
  if (!nonEmpty(flow.title)) failures.push('title is required');
  if (!Array.isArray(flow.steps) || flow.steps.length === 0) failures.push('steps must contain at least one step');
  if (flow.profiles !== undefined && (!Array.isArray(flow.profiles) || flow.profiles.some((item) => !nonEmpty(item)))) failures.push('profiles must be an array of non-empty strings');
  if (flow.mutation !== undefined && typeof flow.mutation !== 'boolean') failures.push('mutation must be a boolean');

  for (const [index, step] of (flow.steps ?? []).entries()) {
    const prefix = `steps[${index}]`;
    if (!nonEmpty(step.heading)) failures.push(`${prefix}.heading is required`);
    if (!nonEmpty(step.instruction)) failures.push(`${prefix}.instruction is required`);
    if (!step.capture?.file) failures.push(`${prefix}.capture.file is required`);
    if (step.capture?.blank !== undefined && typeof step.capture.blank !== 'boolean') failures.push(`${prefix}.capture.blank must be a boolean`);
    if (step.capture?.blankFile !== undefined && !nonEmpty(step.capture.blankFile)) failures.push(`${prefix}.capture.blankFile must be a non-empty string`);
    if (step.capture?.blankFile && step.capture.blankFile === step.capture.file) failures.push(`${prefix}.capture.blankFile must differ from capture.file`);
    if (step.actions !== undefined && !Array.isArray(step.actions)) failures.push(`${prefix}.actions must be an array`);
    if (step.checks !== undefined && !Array.isArray(step.checks)) failures.push(`${prefix}.checks must be an array`);

    for (const [actionIndex, action] of (step.actions ?? []).entries()) {
      validateAction(action, `${prefix}.actions[${actionIndex}]`, failures, false);
    }
    for (const [checkIndex, check] of (step.checks ?? []).entries()) {
      validateAction(check, `${prefix}.checks[${checkIndex}]`, failures, true);
    }
    for (const [highlightIndex, highlight] of (step.capture?.highlights ?? []).entries()) {
      if (!highlight.locator) failures.push(`${prefix}.capture.highlights[${highlightIndex}].locator is required`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`${source} is invalid:\n- ${failures.join('\n- ')}`);
  }
}

function validateAction(action, prefix, failures, assertionOnly) {
  if (!action || typeof action !== 'object') {
    failures.push(`${prefix} must be an object`);
    return;
  }
  if (!nonEmpty(action.type)) {
    failures.push(`${prefix}.type is required`);
    return;
  }
  if (!supportedActionTypes.has(action.type)) failures.push(`${prefix}.type '${action.type}' is unsupported`);
  if (assertionOnly && !assertionActionTypes.has(action.type)) failures.push(`${prefix}.type must be an assertion action`);

  const locatorAssertions = new Set([
    'assertVisible', 'assertHidden', 'assertEnabled', 'assertDisabled',
    'assertText', 'assertValue', 'assertCount', 'assertAttribute'
  ]);
  if (locatorAssertions.has(action.type) && !action.locator) {
    failures.push(`${prefix}.locator is required for ${action.type}`);
  }
  if (['assertText', 'assertValue'].includes(action.type) && !hasTextExpectation(action)) {
    failures.push(`${prefix} requires text, exactText, contains, or matches`);
  }
  if (action.type === 'assertAttribute' && !nonEmpty(action.name)) {
    failures.push(`${prefix}.name is required for assertAttribute`);
  }
  if (action.type === 'assertAttribute' && action.value === undefined && action.exact === undefined && action.contains === undefined && action.matches === undefined) {
    failures.push(`${prefix} requires value, exact, contains, or matches`);
  }
  if (action.type === 'fillValidOrchardPin' && (!action.locator || !action.cropLocator)) {
    failures.push(`${prefix} requires locator and cropLocator for fillValidOrchardPin`);
  }
  if (action.type === 'continueOrchardDetailsWithUniquePin'
      && (!action.locator || !action.cropLocator || !action.continueLocator || !action.successLocator)) {
    failures.push(`${prefix} requires locator, cropLocator, continueLocator and successLocator for continueOrchardDetailsWithUniquePin`);
  }
  if (action.type === 'selectOptionByAliases' && (!action.locator || !Array.isArray(action.aliases) || !action.aliases.length)) failures.push(`${prefix} requires locator and aliases`);
  if (['drawFixturePolygon', 'injectFixturePolygon'].includes(action.type)
    && (!nonEmpty(action.fixture) || !nonEmpty(action.geometryPath))) {
    failures.push(`${prefix} requires fixture and geometryPath for ${action.type}`);
  }
  if (['rememberText', 'rememberValue'].includes(action.type) && (!nonEmpty(action.key) || !action.locator)) {
    failures.push(`${prefix} requires key and locator`);
  }
  if (action.type === 'rememberAttribute' && (!nonEmpty(action.key) || !action.locator || !nonEmpty(action.name))) {
    failures.push(`${prefix} requires key, locator and attribute name`);
  }
  if (action.type === 'assertCount' && action.count === undefined && action.exact === undefined && action.min === undefined && action.max === undefined) {
    failures.push(`${prefix} requires count, exact, min, or max`);
  }
  if (action.type === 'assertUrl' && action.url === undefined && action.exact === undefined && action.contains === undefined && action.matches === undefined) {
    failures.push(`${prefix} requires url, exact, contains, or matches`);
  }
  if (action.type === 'assertToast' && !action.locator && !hasTextExpectation(action) && !action.tone && !action.severity && !action.kind) {
    failures.push(`${prefix} requires a locator, text expectation, or tone/severity`);
  }
  if (action.type === 'clickUntilVisible' && !action.successLocator) {
    failures.push(`${prefix}.successLocator is required for clickUntilVisible`);
  }
  if (action.type === 'clickCandidateUntil') {
    if (!action.successLocator) {
      failures.push(`${prefix}.successLocator is required for clickCandidateUntil`);
    }
    if (action.afterClickActions !== undefined) {
      if (!Array.isArray(action.afterClickActions)) {
        failures.push(`${prefix}.afterClickActions must be an array`);
      } else {
        for (const [nestedIndex, nestedAction] of action.afterClickActions.entries()) {
          validateAction(nestedAction, `${prefix}.afterClickActions[${nestedIndex}]`, failures, false);
        }
      }
    }
  }
}

function hasTextExpectation(action) {
  return action.text !== undefined || action.exactText !== undefined || action.contains !== undefined || action.matches !== undefined;
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
