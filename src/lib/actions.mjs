import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveLocator } from './locator.mjs';
import { absoluteUrl } from './utils.mjs';
import { FlowSkippedError } from './errors.mjs';
import { isAssertionType, runAssertion } from './assertions.mjs';
import { shouldAutoWaitForMap, waitForMapReady } from './map-ready.mjs';
import { createHash } from 'node:crypto';
import { detectGeometryTransition, matchesFixtureBatchTask, fixturePlacementOffset, placedFixtureRing, fixtureEsriPolygon } from './fixture-e2e.mjs';
import { classifyFixturePublication, linkedSpatialStatus } from './fixture-publication.mjs';
import { advanceEntityWizardToReview } from './entity-wizard.mjs';
import { isWorkbenchCaptureUrl } from './guide-scope.mjs';
import { selectMaSafeGuideOrchard, selectExistingMaFixtureOrchard, ensureExistingMaFixtureSupplier, fillExistingMaFixtureDetails, selectExistingMaFixtureBlock, submitExistingMaFixture } from './existing-ma-fixture.mjs';

export async function runActions(page, actions = [], config, runtime = {}) {
  const checks = [];

  for (const [index, action] of actions.entries()) {
    runtime.currentAction = { type: action.type, geometryPath: action.geometryPath ?? null };
    const started = Date.now();
    try {
      const outcome = await runAction(page, action, config, runtime);
      if (outcome?.type && isAssertionType(outcome.type)) {
        checks.push(outcome);
      }
    } catch (error) {
      if (action.optional === true) {
        console.warn(`  Optional action '${action.type}' was skipped: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      throw error;
    } finally {
      // Fixture-only diagnostics: never log typed form values or auth/session data.
      if ((runtime.flowId === 'block-hectares-e2e-fixture' || runtime.flowId?.startsWith('ma-e2e-')) && Date.now() - started >= 2000) {
        const guideHook = /^\[data-guide='([a-z0-9-]+)'\]/i.exec(action.locator?.selector ?? '');
        const target = guideHook ? ` [data-guide=${guideHook[1]}]` : '';
        console.warn(`  Slow fixture action ${index + 1}: ${action.type}${target} (${Date.now() - started}ms)`);
      }
    }
  }

  runtime.currentAction = null;
  return checks;
}

async function runAction(page, action, config, runtime) {
  if (isAssertionType(action.type)) {
    return runAssertion(page, action, config, runtime, { resolveTemplate });
  }

  switch (action.type) {
    case 'goto': {
      const targetUrl = absoluteUrl(
        config.baseUrl,
        resolveTemplate(action.url ?? action.path, config, runtime)
      );
      await page.goto(
        targetUrl,
        { waitUntil: action.waitUntil ?? 'domcontentloaded' }
      );

      const autoWait = action.waitForMapReady ?? shouldAutoWaitForMap(targetUrl, config);
      if (autoWait) {
        await waitForMapReady(page, action, config);
      }
      if (runtime.captureScope && !runtime.captureScopeApplied && isWorkbenchCaptureUrl(targetUrl, config)) {
        await applyWorkbenchCaptureScope(page, config, runtime.captureScope);
        runtime.captureScopeApplied = true;
      }
      break;
    }
    case 'click':
      await resolveActionLocator(page, action).click({
        force: action.force ?? false,
        timeout: action.timeoutMs
      });
      break;
    case 'clickIfVisible':
      await clickIfVisible(page, action, config);
      break;
    case 'clickCandidateUntil':
      await clickCandidateUntil(page, action, config, runtime);
      break;
    case 'clickUntilVisible':
      await clickUntilVisible(page, action, config);
      break;
    case 'clickFirst':
      await clickFirst(page, action, config);
      break;
    case 'fill': {
      const locator = await waitForVisibleActionLocator(page, action, config);
      await locator.fill(
        resolveTemplate(action.value ?? '', config, runtime),
        { timeout: action.timeoutMs }
      );
      break;
    }
    case 'fillValidOrchardPin':
      await fillValidOrchardPin(page, action, config, runtime);
      break;
    case 'continueOrchardDetailsWithUniquePin':
      await continueOrchardDetailsWithUniquePin(page, action, config, runtime);
      break;
    case 'fillFromText':
      await fillFromText(page, action, config);
      break;
    case 'selectOption':
      await selectSpecificOption(page, action, config, runtime);
      break;
    case 'selectFirstOption':
      try {
        await selectFirstOption(page, action, config);
      } catch (error) {
        if (action.skipMessage) {
          throw new FlowSkippedError(resolveTemplate(action.skipMessage, config, runtime));
        }
        throw error;
      }
      break;
    case 'selectFirstOptionIfEmpty':
      await selectFirstOptionIfEmpty(page, action, config);
      break;
    case 'check':
      await resolveActionLocator(page, action).check({ timeout: action.timeoutMs });
      break;
    case 'uncheck':
      await resolveActionLocator(page, action).uncheck({ timeout: action.timeoutMs });
      break;
    case 'press': {
      const locator = await waitForVisibleActionLocator(page, action, config);
      await locator.press(action.key, { timeout: action.timeoutMs });
      break;
    }
    case 'hover':
      await resolveActionLocator(page, action).hover({ timeout: action.timeoutMs });
      break;
    case 'dragBy':
      await dragBy(page, action, config);
      break;
    case 'rememberText':
      await rememberValue(page, action, config, runtime, 'text');
      break;
    case 'rememberValue':
      await rememberValue(page, action, config, runtime, 'value');
      break;
    case 'rememberAttribute':
      await rememberAttribute(page, action, config, runtime);
      break;
    case 'scrollIntoView':
      await resolveActionLocator(page, action).scrollIntoViewIfNeeded({ timeout: action.timeoutMs });
      break;
    case 'waitFor':
      await resolveActionLocator(page, action).waitFor({
        state: action.state ?? 'visible',
        timeout: action.timeoutMs
      });
      break;
    case 'waitForEnabled':
      await waitForEnabled(page, action, config);
      break;
    case 'require':
      await requireLocator(page, action, config);
      break;
    case 'skipIfVisible':
      await skipIfVisible(page, action, config);
      break;
    case 'waitForLoadState':
      await page.waitForLoadState(action.state ?? 'networkidle', {
        timeout: action.timeoutMs
      });
      break;
    case 'waitForTimeout':
      await page.waitForTimeout(Number(action.ms ?? 250));
      break;
    case 'waitForMapReady':
      await waitForMapReady(page, action, config);
      break;
    case 'assertE2eTestHost': {
      const host = new URL(config.baseUrl).hostname;
      if (!isMaTestHost(host)) throw new Error(`E2E mutations are forbidden on host '${host}'.`);
      break;
    }
    case 'provisionE2eGrowerSupplier':
      await provisionE2eGrowerSupplier(page, action, config, runtime);
      break;
    case 'stageFixtureGrowerSupplier':
      await stageFixtureGrowerSupplier(page, action, config, runtime);
      break;
    case 'openFixtureOrchardForMa':
      await openFixtureOrchardForMa(page, action, config, runtime);
      break;
    case 'selectFixtureMaBlock':
      await selectFixtureMaBlock(page, action, config, runtime);
      break;
    case 'verifyFixtureMaCode':
      await verifyFixtureMaCode(page, action, config, runtime);
      break;
    case 'verifyFixtureMaMembership':
      await verifyFixtureMaMembership(page, action, config, runtime);
      break;
    case 'preflightFixturePlacement': {
      const fixturePath = path.resolve(resolveTemplate(action.fixture ?? '', config, runtime));
      const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
      assertFixtureTestWriteApproval(fixture);
      for (const geometryPath of [
        'e2e.property.geometry', 'e2e.orchard.geometry',
        ...fixture.e2e.blocks.map((_, index) => `e2e.blocks.${index}.geometry`)
      ]) placedFixtureRing(fixture, geometryPath, runtime.runId);
      break;
    }
    case 'drawFixturePolygon':
      await drawFixturePolygon(page, action, config, runtime);
      break;
    case 'injectFixturePolygon':
      await injectFixturePolygon(page, action, config, runtime);
      break;
    case 'assertFixtureGeometryPublished':
      await assertFixtureGeometryPublished(page, action, runtime);
      break;
    case 'selectMaSafeGuideOrchard':
      await selectMaSafeGuideOrchard(page, config);
      break;
    case 'selectExistingMaFixtureOrchard':
      await selectExistingMaFixtureOrchard(page, config, runtime);
      break;
    case 'ensureExistingMaFixtureSupplier':
      await ensureExistingMaFixtureSupplier(page, config, runtime);
      break;
    case 'fillExistingMaFixtureDetails':
      await fillExistingMaFixtureDetails(page, config, runtime);
      break;
    case 'selectExistingMaFixtureBlock':
      await selectExistingMaFixtureBlock(page, config, runtime);
      break;
    case 'submitExistingMaFixture':
      await submitExistingMaFixture(page, config, runtime);
      break;
    case 'assertMaMutationScope':
      await assertMaMutationScope(page, action, config, runtime);
      break;
    case 'assertFixtureScope':
      await assertFixtureScope(page, action, config);
      break;
    case 'verifyBlockHectareFixture':
      await verifyBlockHectareFixture(page, action, config, runtime);
      break;
    case 'selectOptionByAliases':
      await selectOptionByAliases(page, action, config);
      break;
    case 'setViewport':
      await page.setViewportSize({ width: Number(action.width), height: Number(action.height) });
      break;
    case 'evaluate':
      await page.evaluate(action.script);
      break;
    default:
      throw new Error(`Unsupported action type '${action.type}'.`);
  }
}




export function assertFixtureTestWriteApproval(fixture, environment = process.env) {
  if (fixture?.e2e?.approvalStatus !== 'unapproved-candidate') return;
  const variable = fixture.e2e.approvalRequiredEnvironment;
  // This is a LOCAL operator confirmation, not evidence of actual GIS approval.
  // Never infer permission from the presence of a source CSV or a real GlobalID.
  if (variable !== 'KINEX_PIN3025_TEST_WRITE_APPROVED'
    || environment[variable] !== 'PIN3025-APPROVED-TEST') {
    throw new Error('PIN 3025 is only a GIS candidate; source CSV has no approval for test writes. '
      + 'Do not publish to the real GIS footprint without authorisation and a disposable test layer. '
      + 'Once approved, set KINEX_PIN3025_TEST_WRITE_APPROVED=PIN3025-APPROVED-TEST to explicitly opt in.');
  }
}

// E2E-only adapter: supply a validated EsriJSON polygon to KineX's existing
// geometry-completion promise. KineX's Workbench mutation coordinator then
// performs its normal authenticated, server-mediated publication and validation.
// This deliberately bypasses native Sketch events and the live map preview;
// do not use it as a replacement for an independent interactive drawing E2E.
export async function injectFixturePolygon(page, action, config, runtime) {
  const fixtureTemplate = action.fixture ?? config.guideData?.blockHectaresFixture;
  const geometryPath = resolveTemplate(action.geometryPath ?? '', config, runtime);
  if (!fixtureTemplate || !geometryPath) {
    throw new Error('injectFixturePolygon requires fixture and geometryPath.');
  }
  const fixturePath = path.resolve(resolveTemplate(fixtureTemplate, config, runtime));
  const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
  assertFixtureTestWriteApproval(fixture);
  const polygon = fixtureEsriPolygon(fixture, geometryPath, runtime.runId);
  const timeoutMs = Number(action.timeoutMs ?? 120000);
  const panel = page.locator("[data-guide='geometry-task-panel']").first();
  await panel.waitFor({ state: 'visible', timeout: timeoutMs });
  const blockMatch = /^e2e\.blocks\.(\d+)\.geometry$/.exec(geometryPath);
  const blockNumber = blockMatch ? Number(blockMatch[1]) + 1 : null;
  const batchSize = blockNumber === null ? null : fixture.e2e?.blocks?.length;
  if (blockNumber !== null && (!Number.isInteger(batchSize) || blockNumber > batchSize)) {
    throw new Error(`Cannot inject '${geometryPath}': invalid fixture batch index.`);
  }

  // The C# MultiBlock coordinator switches the panel before it starts the next
  // SketchViewModel. Both the correct Block ordinal AND capture must be ready.
  const started = Date.now();
  let ready;
  let priorPanelText = '';
  let priorPanelLabel = '';
  while (Date.now() - started < Math.min(timeoutMs, 15000)) {
    priorPanelText = ((await panel.textContent().catch(() => '')) ?? '').trim();
    priorPanelLabel = ((await panel.getAttribute('aria-label').catch(() => '')) ?? '').trim();
    const correctBlock = blockNumber === null
      || matchesFixtureBatchTask(priorPanelText, blockNumber, batchSize);
    if (correctBlock) {
      ready = await page.evaluate(inspectFixtureInjectionSession);
      if (ready.ready) break;
      if (!ready.retryable) break;
    }
    await page.waitForTimeout(200);
  }
  if (!ready?.ready || (blockNumber !== null
    && !matchesFixtureBatchTask(priorPanelText, blockNumber, batchSize))) {
    throw new Error(`Cannot inject '${geometryPath}': expected Block ${blockNumber} of ${batchSize} `
      + `with an active capture; panel='${priorPanelText.slice(0, 180)}'; `
      + `session=${ready?.reason ?? 'not ready'}. No geometry was submitted.`);
  }

  // No FeatureServer access or privileged API token is injected. The existing
  // KineX completion consumer still decides whether publication succeeds.
  const outcome = await page.evaluate(resolveFixtureCaptureWithJson,
    { editId: ready.editId, polygon });
  if (!outcome.completed) throw new Error(`Cannot inject '${geometryPath}': ${outcome.reason}`);
  runtime.variables ??= {};
  runtime.variables.fixtureGeometryMethod = 'esri-json-completion';
  console.log(`  Staged ${geometryPath} as EsriJSON (${outcome.vertices} vertices); awaiting KineX publication.`);
  const after = String(action.after ?? 'settled');
  if (['choice', 'choice-or-task', 'next-geometry', 'complete'].includes(after)) {
    await awaitFixtureGeometryTransition(page, {
      after, timeoutMs, geometryPath, priorPanelText, priorPanelLabel,
      expectedNextEntity: action.expectedNextEntity ?? null,
      expectedEntity: action.expectedEntity ?? null,
      expectedNextBlockNumber: after === 'next-geometry' && blockNumber !== null
        ? blockNumber + 1 : null,
      batchSize, completedEditId: ready.editId
    }, runtime);
  } else {
    await page.waitForTimeout(Number(action.settleMs ?? 1000));
  }
}

// Read-only inspection: never select a different or previously completed edit.
async function inspectFixtureInjectionSession() {
  const host = window.location.hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '::1'].includes(host)
    && !host.endsWith('.test') && !host.endsWith('.localhost')) {
    return { ready: false, retryable: false,
      reason: `Test-only geometry injection is disabled on host '${host}'` };
  }
  const state = await import('/js/arcgis-map-state.js');
  const sessions = [...state.activeGeometryEdits.values()]
    .filter((edit) => edit?.mode === 'capture' && !edit?.completion?.isSettled);
  if (sessions.length !== 1) {
    return { ready: false, retryable: sessions.length === 0,
      reason: `Expected one active KineX capture session, found ${sessions.length}` };
  }
  const edit = sessions[0];
  if (edit.sketchViewModel?.activeTool !== 'polygon') {
    return { ready: false, retryable: true,
      reason: `Expected polygon capture tool, found ${edit.sketchViewModel?.activeTool ?? 'none'}` };
  }
  if (typeof edit.completion?.resolve !== 'function' || typeof edit.editId !== 'string') {
    return { ready: false, retryable: false, reason: 'KineX geometry completion contract unavailable' };
  }
  if (edit.terminalIntent !== null) {
    return { ready: false, retryable: false, reason: 'KineX geometry already has a terminal intent' };
  }
  return { ready: true, editId: edit.editId };
}

// Delivers EsriJSON to the same completion promise consumed by the Workbench
// coordinator. Its normal server-mediated PublishSpatialEntityAsync remains the
// only persistence path; no direct FeatureServer edits or auth bypass occur.
async function resolveFixtureCaptureWithJson({ editId, polygon }) {
  const state = await import('/js/arcgis-map-state.js');
  const edit = state.activeGeometryEdits.get(editId);
  if (!edit || edit.mode !== 'capture' || edit.terminalIntent !== null
    || edit.completion?.isSettled || typeof edit.completion?.resolve !== 'function') {
    return { completed: false, reason: 'capture session changed before injection' };
  }
  if (edit.sketchViewModel?.activeTool !== 'polygon') {
    return { completed: false, reason: 'polygon capture tool is not active' };
  }
  if (Number(edit.captureVertexCount ?? 0) > 0) {
    return { completed: false, reason: 'capture already has drawn vertices; refusing to overwrite' };
  }
  const rings = polygon?.rings;
  const ring = Array.isArray(rings) && rings.length === 1 ? rings[0] : null;
  const unique = new Set((ring ?? []).map((point) => `${point?.[0]}:${point?.[1]}`));
  if (!Array.isArray(ring) || unique.size < 3 || polygon?.spatialReference?.wkid !== 2193) {
    return { completed: false, reason: 'invalid NZTM polygon geometry' };
  }
  const view = state.activeMapViews.get(edit.mapViewId)?.view;
  if (!view || !view.container?.isConnected) {
    return { completed: false, reason: 'KineX MapView has been disposed' };
  }
  // Important: this is an internal test-only hand-off. It omits the live Sketch
  // preview; the server's containment, overlap and publishing rules still apply.
  // KineX WorkbenchGeometryEditService.WaitForCompletionAsync owns the edit
  // lifetime. It may call waitForGeometryEditCompletion(editId) *after* this
  // promise resolves (Blazor async interop scheduling). Disposing here removes
  // activeGeometryEdits[editId] before that waiter can subscribe, producing
  // 'No active geometry edit found'. Leave the settled promise registered;
  // WorkbenchGeometryEditService finally disposes the GeometryEditHandle and
  // releases its edit slot after reading the result.
  edit.completion.resolve({ editId, geometryJson: JSON.stringify(polygon),
    globalId: '', layerId: '', isCancelled: false, trimPreview: null });
  return { completed: true, vertices: unique.size };
}

export async function drawFixturePolygon(page, action, config, runtime) {
  const fixtureTemplate = action.fixture ?? config.guideData?.blockHectaresFixture;
  const fixturePath = path.resolve(resolveTemplate(fixtureTemplate ?? '', config, runtime));
  const geometryPath = resolveTemplate(action.geometryPath ?? '', config, runtime);
  if (!fixtureTemplate || !geometryPath) {
    throw new Error('drawFixturePolygon requires fixture and geometryPath.');
  }

  const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
  const coordinates = readObjectPath(fixture, geometryPath);
  if (!Array.isArray(coordinates) || coordinates.length < 4) {
    throw new Error(`Fixture geometry '${geometryPath}' must contain a closed polygon ring.`);
  }

  // Preflight the destination before touching MapView.goTo(): the original
  // PIN 1285 geometry is in Northland while this fixture uses a Te Puke address.
  // All six geometries receive the same target-region displacement.
  const offset = fixturePlacementOffset(fixture, runtime.runId);
  runtime.variables ??= {};
  runtime.variables.fixtureOffset = `${offset.x},${offset.y}`;
  const ring = placedFixtureRing(fixture, geometryPath, runtime.runId);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) ring.pop();
  if (ring.length < 3 || ring.some((point) => point.some((number) => !Number.isFinite(number)))) {
    throw new Error(`Fixture geometry '${geometryPath}' requires at least three finite vertices.`);
  }

  const wkid = Number(action.wkid ?? fixture.e2e?.spatialReferenceWkid ?? 2193);
  const timeoutMs = Number(action.timeoutMs ?? 120000);
  const panel = page.locator("[data-guide='geometry-task-panel']").first();
  await panel.waitFor({ state: 'visible', timeout: timeoutMs });
  // Scroll the map itself into the browser viewport before calculating screen
  // coordinates. A visible geometry task does not mean its MapView is onscreen.
  await page.locator("[data-guide='workbench-map']").first()
    .scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  const priorPanelText = ((await panel.textContent().catch(() => '')) ?? '').trim();
  const priorPanelLabel = ((await panel.getAttribute('aria-label').catch(() => '')) ?? '').trim();

  // The panel can render before KineX has registered its SketchViewModel.
  // Only use read-only ArcGIS state: all vertices still go through mouse input.
  let plan;
  const prepareStarted = Date.now();
  while (Date.now() - prepareStarted < Math.min(timeoutMs, 15000)) {
    plan = await page.evaluate(prepareFixtureSketch, { ring, wkid });
    if (plan.ready) break;
    if (!plan.retryable) throw new Error(`Cannot draw '${geometryPath}': ${plan.reason}`);
    await page.waitForTimeout(250);
  }
  if (!plan?.ready) {
    throw new Error(`Sketch did not start for '${geometryPath}': ${plan?.reason ?? 'no active capture session'}`);
  }
  if (plan.vertexCount !== 0) {
    throw new Error(`Sketch for '${geometryPath}' already contains ${plan.vertexCount} vertices. Refusing to append another polygon.`);
  }

  // Observe genuine DOM pointer input and SketchViewModel events. Nothing in
  // this probe synthesizes drawing or mutates the sketch.
  await page.evaluate(startFixturePointerProbe, plan.editId);
  try {
    for (let index = 0; index < plan.points.length; index++) {
      const point = plan.points[index];
      const hit = await page.evaluate(fixturePointerHitTest, point);
      if (!hit.valid) {
        throw new Error(`Cannot click vertex ${index + 1}/${plan.points.length} for '${geometryPath}': ${hit.reason}`);
      }
      // Give ArcGIS time to process pointer movement and snapping previews
      // before pressing, instead of relying on a zero-dwell mouse.click().
      await page.mouse.move(point.x, point.y, { steps: Number(action.pointerSteps ?? 8) });
      await page.waitForTimeout(Number(action.pointerSettleMs ?? 120));
      await page.mouse.down({ button: 'left' });
      await page.waitForTimeout(Number(action.pointerPressMs ?? 75));
      await page.mouse.up({ button: 'left' });
      await page.waitForTimeout(Number(action.pointerReleaseMs ?? 200));
      const needed = index + 1;
      let progress = await page.evaluate(fixtureCaptureProgress, plan.editId);
      if (!progress.active) {
        throw new Error(`Sketch '${geometryPath}' ended unexpectedly after vertex ${needed}: ${progress.reason}.`);
      }
      // The KineX vertex counter is driven by SketchViewModel's vertex-add event
      // only when the event already contains geometry. A new polygon can report
      // 0 for its first one or two mouse clicks even though Sketch has started.
      // Do not replay these clicks: that would risk a duplicate vertex. Require
      // an authoritative count from the third vertex onwards, before Done.
      if (needed >= 3) {
        const vertexDeadline = Date.now() + Number(action.vertexTimeoutMs ?? 6000);
        while (progress.count < needed && Date.now() < vertexDeadline) {
          await page.waitForTimeout(120);
          progress = await page.evaluate(fixtureCaptureProgress, plan.editId);
          if (!progress.active) {
            throw new Error(`Sketch '${geometryPath}' ended unexpectedly after vertex ${needed}: ${progress.reason}.`);
          }
        }
        if (progress.count < needed) {
          const details = `sketch state=${progress.sketchState ?? 'unknown'}, `
            + `tool=${progress.activeTool ?? 'none'}, minimum=${progress.minimumVertices ?? 'unknown'}, `
            + `createGraphic vertices=${progress.geometryVertices ?? 'unavailable'}, `
            + `map selection=${progress.mapClickEnabled ?? 'unknown'}, `
            + `draw mode=${progress.drawMode ?? 'unknown'}, `
            + `pointer down/up=${progress.pointerDown ?? 0}/${progress.pointerUp ?? 0}, `
            + `sketch events=${JSON.stringify(progress.sketchEvents ?? [])}`;
          throw new Error(`ArcGIS confirmed only ${progress.count}/${needed} vertices while drawing '${geometryPath}' `
            + `(vertex ${needed} at ${Math.round(point.x)},${Math.round(point.y)}; ${details}). `
            + 'Check whether the polygon tool is active and whether mouse clicks reach the sketch; '
            + 'the first two clicks may not update the KineX vertex counter.');
        }
      }
      await page.waitForTimeout(Number(action.vertexDelayMs ?? 160));
    }

    const done = page.locator("[data-guide='geometry-done'] button").first();
    await done.waitFor({ state: 'visible', timeout: timeoutMs });
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await done.isEnabled().catch(() => false)) break;
      await page.waitForTimeout(150);
    }
    if (!await done.isEnabled().catch(() => false)) {
      const progress = await page.evaluate(fixtureCaptureProgress, plan.editId);
      const error = ((await page.locator("[data-guide='map-error']").first().textContent().catch(() => '')) ?? '').trim();
      throw new Error(`Geometry Done remains disabled for '${geometryPath}' after ${progress.count ?? '?'} `
        + `vertices. ${error || 'Check the live containment/overlap preview and map toolbar.'}`);
    }
    await done.click({ timeout: timeoutMs });

    const after = String(action.after ?? 'settled');
    if (['choice', 'choice-or-task', 'next-geometry', 'complete'].includes(after)) {
      await awaitFixtureGeometryTransition(page, {
        after, timeoutMs, geometryPath, priorPanelText, priorPanelLabel,
        expectedNextEntity: action.expectedNextEntity ?? null,
        expectedEntity: action.expectedEntity ?? null
      }, runtime);
    } else {
      await page.waitForTimeout(Number(action.settleMs ?? 1000));
    }
  } finally {
    await page.evaluate(stopFixturePointerProbe, plan.editId).catch(() => {});
  }
}

// This callback is evaluated in the browser and uses KineX's public map-state
// module strictly for observation. It does not insert graphics or call applyEdits.
async function prepareFixtureSketch({ ring, wkid }) {
  // Playwright serializes page.evaluate callbacks without module closures. Keep
  // this local so it can run in the browser without importing Guide Builder.
  function assessMapHit({ x, y, viewportWidth, viewportHeight, surfaceRect,
    insideSurface, blockedUi, hitTag, hitClass }) {
    if (!Number.isFinite(x) || !Number.isFinite(y))
      return { valid: false, reason: 'map projection returned non-finite screen coordinates' };
    const pixel = `(${Math.round(x)}, ${Math.round(y)})`;
    if (!(viewportWidth > 0 && viewportHeight > 0))
      return { valid: false, reason: 'browser viewport has zero width or height' };
    if (x < 0 || y < 0 || x >= viewportWidth || y >= viewportHeight)
      return { valid: false, reason: `screen point ${pixel} is outside browser viewport ${viewportWidth}x${viewportHeight}` };
    if (!surfaceRect || !(surfaceRect.right > surfaceRect.left && surfaceRect.bottom > surfaceRect.top))
      return { valid: false, reason: 'active MapView canvas has no displayed bounds' };
    if (x < surfaceRect.left + 8 || y < surfaceRect.top + 8
      || x > surfaceRect.right - 8 || y > surfaceRect.bottom - 8) {
      const bounds = [surfaceRect.left, surfaceRect.top, surfaceRect.right, surfaceRect.bottom]
        .map(Math.round).join(',');
      return { valid: false, reason: `screen point ${pixel} is outside active MapView canvas [${bounds}]` };
    }
    if (hitTag === 'none')
      return { valid: false, reason: `no DOM element at screen point ${pixel} inside the active MapView` };
    if (!insideSurface || blockedUi)
      return { valid: false, reason: `screen point ${pixel} is obscured by ${hitTag} (${String(hitClass).slice(0, 100)})` };
    return { valid: true };
  }
  const state = await import('/js/arcgis-map-state.js');
  const root = document.querySelector("[data-guide='workbench-map']");
  const mapViews = [...state.activeMapViews.entries()].filter(([, candidate]) => {
    const container = candidate?.view?.container;
    return container instanceof HTMLElement && container.isConnected && root?.contains(container);
  });
  const visibleMapViews = mapViews.filter(([, candidate]) => {
    const rect = candidate.view.container.getBoundingClientRect();
    return rect.width > 24 && rect.height > 24 && rect.right > 0 && rect.bottom > 0
      && rect.left < window.innerWidth && rect.top < window.innerHeight;
  });
  // A stale, still-registered MapView may also be visible. Prefer the one
  // that actually owns the active KineX polygon capture session.
  const pair = visibleMapViews.find(([id]) => [...state.activeGeometryEdits.values()]
    .some((edit) => edit.mapViewId === id && edit.mode === 'capture' && edit.terminalIntent === null))
    ?? visibleMapViews[0];
  if (!pair) return { ready: false, retryable: true,
    reason: mapViews.length ? 'Workbench MapView is connected but its canvas is outside the browser viewport'
      : 'Workbench MapView is not registered' };
  const [mapViewId, entry] = pair;
  const edit = [...state.activeGeometryEdits.values()].find((candidate) =>
    candidate.mapViewId === mapViewId && candidate.mode === 'capture' && candidate.terminalIntent === null);
  if (!edit) return { ready: false, retryable: true, reason: 'no active polygon capture SketchViewModel' };
  // Feature-selection view.click calls stopPropagation() in KineX. The normal
  // selection handler must have been disabled before sketch input can work.
  if (entry.mapClickEnabled === true) return { ready: false, retryable: true,
    reason: 'KineX map feature-selection click handler is still enabled during polygon capture' };
  const view = entry.view;
  await view.when();

  // MapView.toScreen expects an ArcGIS Point, not a point-shaped plain object.
  // The previous code constructed real Points only when reprojection was needed,
  // so it broke on NZTM2000 MapViews (where the fixture WKID already matches).
  let projected;
  let Extent;
  let Point;
  const viewWkid = Number(view.spatialReference?.wkid ?? view.spatialReference?.latestWkid);
  try {
    const [pointModule, extentModule] = await window.$arcgis.import([
      '@arcgis/core/geometry/Point.js',
      '@arcgis/core/geometry/Extent.js'
    ]);
    Point = pointModule.default ?? pointModule;
    Extent = extentModule.default ?? extentModule;
    const source = ring.map(([x, y]) => new Point({ x, y, spatialReference: { wkid } }));
    const equivalent = viewWkid === wkid || (viewWkid === 102100 && wkid === 3857)
      || (viewWkid === 3857 && wkid === 102100);
    if (equivalent) {
      projected = source;
    } else {
      const [projectModule] = await window.$arcgis.import([
        '@arcgis/core/geometry/operators/projectOperator.js'
      ]);
      const operator = projectModule.default ?? projectModule;
      await operator.load();
      projected = source.map((point) => operator.execute(point, view.spatialReference));
    }
    if (projected.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
      throw new Error('ArcGIS projection returned invalid coordinates');
    }
    // Normalise operator output back to ArcGIS Point instances in the view SR.
    projected = projected.map((p) => new Point({
      x: p.x, y: p.y, spatialReference: view.spatialReference
    }));
  } catch (error) {
    return { ready: false, retryable: false,
      reason: `Cannot prepare ArcGIS Points from EPSG:${wkid} into map EPSG:${viewWkid}: ${error.message}` };
  }

  const xs = projected.map((point) => point.x);
  const ys = projected.map((point) => point.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const width = Math.max(20, maxX - minX), height = Math.max(20, maxY - minY);
  const centerPoint = new Point({ x: (minX + maxX) / 2, y: (minY + maxY) / 2,
    spatialReference: view.spatialReference });
  const actualView = () => {
    const c = view.center;
    const e = view.extent;
    return `map EPSG:${viewWkid}, actual center `
      + `(${Math.round(c?.x ?? NaN)},${Math.round(c?.y ?? NaN)}), `
      + `target center (${Math.round(centerPoint.x)},${Math.round(centerPoint.y)}), `
      + `extent [${[e?.xmin, e?.ymin, e?.xmax, e?.ymax].map((v) => Math.round(v ?? NaN)).join(',')}]`;
  };
  const savedViewpoint = typeof view.viewpoint?.clone === 'function' ? view.viewpoint.clone() : null;
  async function placementFailure(reason) {
    // Navigation has no business side effects; restore the user's original
    // map location if the synthetic polygon cannot safely be drawn.
    if (savedViewpoint && !Number(edit.captureVertexCount)) {
      try {
        await view.goTo(savedViewpoint, { animate: false });
      } catch (restoreError) {
        reason += `; could not restore initial view: ${String(restoreError?.message ?? restoreError)}`;
      }
    }
    return { ready: false, retryable: false, reason };
  }
  // Zoom and pan to fit the *visible* MapView, not just the geographic
  // polygon extent. A map constrained by scale or partially off-screen can
  // project correct map coordinates outside the browser's viewport.
  // At most six bounded navigation attempts. Repeatedly sending a WebMap
  // outside its imagery coverage is not a reliable fix for missing tiles.
  const margins = [[0.35, 1.15], [0.75, 0.75], [1.25, 0.35]];
  const expansions = [1, 2];
  const surface = view.container.matches('.esri-view')
    ? view.container : (view.container.querySelector('.esri-view') ?? view.container);
  let lastFailure = 'no placement attempted';
  let attempts = 0;
  for (const expansion of expansions) {
    for (const [left, right] of margins) {
      attempts++;
      try {
        // Use ArcGIS Extent rather than a JSON-shaped extent. Checking the actual
        // MapView position is important: goTo can be superseded by KineX navigation.
        await view.goTo(new Extent({ xmin: minX - width * left * expansion,
          xmax: maxX + width * right * expansion,
          ymin: minY - height * 0.45 * expansion,
          ymax: maxY + height * 0.45 * expansion,
          spatialReference: view.spatialReference }), { animate: false });
      } catch (error) {
        lastFailure = `MapView.goTo attempt ${attempts} failed: ${String(error?.message ?? error)}`;
        continue;
      }
      if (view.fatalError) {
        return placementFailure(`MapView rendering failed after navigation: `
          + `${String(view.fatalError?.message ?? view.fatalError)}. ${actualView()}`);
      }
      // goTo completion alone does not guarantee the MapView is stationary.
      for (let attempt = 0; !view.stationary && attempt < 40; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!view.stationary) {
        lastFailure = `MapView did not become stationary after goTo attempt ${attempts}`;
        continue;
      }
      // A settled navigation promise is not proof that the destination was
      // honoured. When a Workbench selection/constraint overrides it, try a
      // centred Point navigation once and fail with useful SR/extent evidence.
      if (!view.extent?.contains(centerPoint)) {
        try {
          await view.goTo({ target: centerPoint,
            scale: Math.max(Number(view.scale) || 18000, 18000) }, { animate: false });
          for (let i = 0; !view.stationary && i < 40; i++) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        } catch (error) {
          return placementFailure(`MapView refused target navigation: `
            + `${String(error?.message ?? error)}; ${actualView()}`);
        }
        if (!view.stationary || !view.extent?.contains(centerPoint)) {
          return placementFailure(`MapView did not navigate to fixture after Extent and Point goTo; ${actualView()}`);
        }
      }
      const rect = view.container.getBoundingClientRect();
      const surfaceRect = surface.getBoundingClientRect();
      const points = projected.map((point) => {
        const screen = view.toScreen(point);
        return { x: rect.left + (screen?.x ?? NaN), y: rect.top + (screen?.y ?? NaN),
          mapViewId };
      });
      const centerScreen = view.toScreen(centerPoint);
      if (!Number.isFinite(centerScreen?.x) || !Number.isFinite(centerScreen?.y)
        || centerScreen.x < -view.width || centerScreen.x > 2 * view.width
        || centerScreen.y < -view.height || centerScreen.y > 2 * view.height) {
        return placementFailure(`MapView.toScreen is inconsistent with its navigated extent; `
          + `center screen (${Math.round(centerScreen?.x ?? NaN)},${Math.round(centerScreen?.y ?? NaN)}), `
          + actualView());
      }
      const problems = points.map((point, i) => {
        const hit = Number.isFinite(point.x) && Number.isFinite(point.y)
          ? document.elementFromPoint(point.x, point.y) : null;
        const assessed = assessMapHit({ ...point,
          viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
          surfaceRect, hitTag: hit?.tagName ?? 'none', hitClass: String(hit?.className ?? ''),
          insideSurface: Boolean(hit && surface.contains(hit)),
          blockedUi: Boolean(hit?.closest('.esri-ui, .esri-popup, button, [role="button"]'))
        });
        return { index: i, ...assessed };
      }).filter(({ valid }) => !valid);
      for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x;
        const dy = points[i].y - points[i - 1].y;
        if (Number.isFinite(dx) && Number.isFinite(dy) && Math.hypot(dx, dy) < 7) {
          problems.push({ index: i, reason: 'adjacent vertices are closer than 7 screen pixels' });
        }
      }
      if (problems.length === 0) {
        return { ready: true, editId: edit.editId, vertexCount: edit.captureVertexCount ?? 0,
          points, mapWkid: viewWkid };
      }
      lastFailure = `vertex ${problems[0].index + 1}: ${problems[0].reason}`;
    }
  }
  return placementFailure(`Could not fit polygon on the visible MapView after ${attempts} goTo attempts `
    + `(view ${view.width}x${view.height}, scale ${Math.round(view.scale)}, `
    + `viewport ${window.innerWidth}x${window.innerHeight}, ${actualView()}): ${lastFailure}. `
    + 'Check the fixture-run diagnostic screenshot and map extent before retrying.');
}

async function fixturePointerHitTest(point) {
  // Playwright serializes page.evaluate callbacks without module closures. Keep
  // this local so it can run in the browser without importing Guide Builder.
  function assessMapHit({ x, y, viewportWidth, viewportHeight, surfaceRect,
    insideSurface, blockedUi, hitTag, hitClass }) {
    if (!Number.isFinite(x) || !Number.isFinite(y))
      return { valid: false, reason: 'map projection returned non-finite screen coordinates' };
    const pixel = `(${Math.round(x)}, ${Math.round(y)})`;
    if (!(viewportWidth > 0 && viewportHeight > 0))
      return { valid: false, reason: 'browser viewport has zero width or height' };
    if (x < 0 || y < 0 || x >= viewportWidth || y >= viewportHeight)
      return { valid: false, reason: `screen point ${pixel} is outside browser viewport ${viewportWidth}x${viewportHeight}` };
    if (!surfaceRect || !(surfaceRect.right > surfaceRect.left && surfaceRect.bottom > surfaceRect.top))
      return { valid: false, reason: 'active MapView canvas has no displayed bounds' };
    if (x < surfaceRect.left + 8 || y < surfaceRect.top + 8
      || x > surfaceRect.right - 8 || y > surfaceRect.bottom - 8) {
      const bounds = [surfaceRect.left, surfaceRect.top, surfaceRect.right, surfaceRect.bottom]
        .map(Math.round).join(',');
      return { valid: false, reason: `screen point ${pixel} is outside active MapView canvas [${bounds}]` };
    }
    if (hitTag === 'none')
      return { valid: false, reason: `no DOM element at screen point ${pixel} inside the active MapView` };
    if (!insideSurface || blockedUi)
      return { valid: false, reason: `screen point ${pixel} is obscured by ${hitTag} (${String(hitClass).slice(0, 100)})` };
    return { valid: true };
  }
  const state = await import('/js/arcgis-map-state.js');
  const entry = state.activeMapViews.get(point.mapViewId);
  const container = entry?.view?.container;
  if (!(container instanceof HTMLElement) || !container.isConnected) {
    return { valid: false, reason: 'original MapView was disposed before the click' };
  }
  const surface = container.matches('.esri-view')
    ? container : (container.querySelector('.esri-view') ?? container);
  const hit = Number.isFinite(point.x) && Number.isFinite(point.y)
    ? document.elementFromPoint(point.x, point.y) : null;
  return assessMapHit({ ...point,
    viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
    surfaceRect: surface.getBoundingClientRect(),
    hitTag: hit?.tagName ?? 'none', hitClass: String(hit?.className ?? ''),
    insideSurface: Boolean(hit && surface.contains(hit)),
    blockedUi: Boolean(hit?.closest('.esri-ui, .esri-popup, button, [role="button"]'))
  });
}

// Passive, bounded event probe for diagnosing native ArcGIS polygon input.
// Does not call Sketch.create(), change graphics, or manipulate the map state.
async function startFixturePointerProbe(editId) {
  const state = await import('/js/arcgis-map-state.js');
  const edit = state.activeGeometryEdits.get(editId);
  const container = state.activeMapViews.get(edit?.mapViewId)?.view?.container;
  if (!(container instanceof HTMLElement) || !edit?.sketchViewModel) {
    throw new Error('Cannot observe polygon input: active KineX map/sketch is missing.');
  }
  window.__kinexGuideFixturePointerProbe?.dispose?.();
  const probe = { editId, pointerDown: 0, pointerUp: 0, sketchEvents: [] };
  const addDown = (event) => { if (event.button === 0) probe.pointerDown++; };
  const addUp = (event) => { if (event.button === 0) probe.pointerUp++; };
  container.addEventListener('pointerdown', addDown, true);
  container.addEventListener('pointerup', addUp, true);
  const handle = edit.sketchViewModel.on('create', (event) => {
    probe.sketchEvents.push(`${event.state ?? 'unknown'}:${event.toolEventInfo?.type ?? '-'}`);
    if (probe.sketchEvents.length > 12) probe.sketchEvents.shift();
  });
  probe.dispose = () => {
    container.removeEventListener('pointerdown', addDown, true);
    container.removeEventListener('pointerup', addUp, true);
    handle?.remove?.();
  };
  window.__kinexGuideFixturePointerProbe = probe;
}

function stopFixturePointerProbe(editId) {
  const probe = window.__kinexGuideFixturePointerProbe;
  if (probe?.editId !== editId) return;
  probe.dispose?.();
  delete window.__kinexGuideFixturePointerProbe;
}

function fixtureCaptureProgress(editId) {
  // Read-only diagnostics. createGraphic may contain an uncommitted mouse
  // cursor vertex, so its vertex count is diagnostic ONLY, never completion
  // evidence: KineX's committed captureVertexCount remains authoritative.
  return import('/js/arcgis-map-state.js').then((state) => {
    const edit = state.activeGeometryEdits.get(editId);
    if (!edit) return { active: false, count: 0, reason: 'KineX disposed the SketchViewModel' };
    const sketch = edit.sketchViewModel;
    const geometry = sketch?.createGraphic?.geometry;
    const paths = geometry?.rings ?? geometry?.paths;
    const vertices = Array.isArray(paths) ? new Set(paths.flatMap((part) =>
      Array.isArray(part) ? part.filter((p) => Array.isArray(p) && p.length >= 2)
        .map(([x, y]) => `${x}:${y}`) : [])).size : null;
    const entry = state.activeMapViews.get(edit.mapViewId);
    const probe = window.__kinexGuideFixturePointerProbe;
    const recent = probe?.editId === editId ? probe : null;
    return { active: true, count: Number(edit.captureVertexCount ?? 0),
      minimumVertices: edit.minimumVertices ?? null,
      sketchState: sketch?.state ?? null, activeTool: sketch?.activeTool ?? null,
      drawMode: sketch?.activeCreateToolDrawMode ?? null,
      mapClickEnabled: entry?.mapClickEnabled ?? null, geometryVertices: vertices,
      pointerDown: recent?.pointerDown ?? null, pointerUp: recent?.pointerUp ?? null,
      sketchEvents: recent?.sketchEvents?.slice(-8) ?? [] };
  });
}
export async function awaitFixtureGeometryTransition(page, options, runtime = {}) {
  const { after, timeoutMs, geometryPath, priorPanelText, priorPanelLabel,
    expectedNextEntity, expectedEntity, expectedNextBlockNumber = null,
    batchSize = null, completedEditId = null } = options;
  const panel = page.locator("[data-guide='geometry-task-panel']").first();
  const choice = page.locator("[data-guide='geometry-choice']").first();
  const error = page.locator("[data-guide='map-error'], [data-guide='geometry-error']").first();
  const done = page.locator("[data-guide='geometry-done'] button").first();
  const started = Date.now();
  let reselectAttempted = false;
  let successorSessionDiagnostic = '';

  while (Date.now() - started < timeoutMs) {
    if (await error.isVisible().catch(() => false)) {
      throw new Error((await error.textContent().catch(() => ''))?.trim() || `Geometry publish failed: ${geometryPath}`);
    }
    const taskVisible = await panel.isVisible().catch(() => false);
    const choiceVisible = await choice.isVisible().catch(() => false);
    const currentText = taskVisible ? ((await panel.textContent().catch(() => '')) ?? '').trim() : '';
    const currentLabel = taskVisible ? ((await panel.getAttribute('aria-label').catch(() => '')) ?? '').trim() : '';
    const nextDoneDisabled = expectedNextBlockNumber === null && taskVisible
      && !await done.isEnabled().catch(() => true);
    let successorSessionReady = false;
    if (expectedNextBlockNumber !== null && taskVisible
      && matchesFixtureBatchTask(currentText, expectedNextBlockNumber, batchSize)) {
      const session = await page.evaluate(inspectFixtureInjectionSession).catch((error) => ({
        ready: false, reason: String(error)
      }));
      successorSessionReady = session.ready && session.editId !== completedEditId;
      successorSessionDiagnostic = successorSessionReady ? 'new capture ready'
        : `${session.reason ?? 'waiting for distinct capture session'} (id=${session.editId ?? 'none'})`;
    }
    const decision = detectGeometryTransition({
      after, taskVisible, choiceVisible, currentText, currentLabel,
      previousText: priorPanelText, previousLabel: priorPanelLabel,
      nextDoneDisabled, expectedNextEntity, expectedNextBlockNumber, batchSize,
      successorSessionReady
    });
    if (decision === 'ready') return;
    if (decision === 'complete') {
      await restoreFixtureDetails(page, Math.min(timeoutMs, 10000));
      if (expectedEntity) {
        const target = page.locator(`[data-guide='business-form-shell'][data-guide-entity='${expectedEntity}']`).first();
        if (await target.isVisible().catch(() => false)) return;
        if (expectedEntity === 'orchard' && !reselectAttempted && Date.now() - started > 2000) {
          reselectAttempted = true;
          await selectCreatedOrchard(page, runtime.variables?.orchardPin, 15000);
        }
      } else if (await page.locator("[data-guide='business-form-shell']").first().isVisible().catch(() => false)) {
        return;
      }
    }
    await page.waitForTimeout(180);
  }
  throw new Error(`Geometry '${geometryPath}' did not reach '${after}'${expectedEntity ? ` with ${expectedEntity} selected` : ''}. `
    + `Last geometry panel: '${((await panel.textContent().catch(() => '')) ?? '').slice(0, 220)}'. `
    + (expectedNextBlockNumber !== null
      ? `Expected Block ${expectedNextBlockNumber} of ${batchSize}; capture: ${successorSessionDiagnostic || 'not inspected'}. `
      : '')
    + `Check the Workbench toolbar for save/publish errors and the fixture-run manifest.`);
}

async function restoreFixtureDetails(page, timeoutMs) {
  const toggle = page.locator("[data-guide='workbench-focus-toggle']").first();
  if ((await toggle.getAttribute('aria-pressed').catch(() => null)) === 'true') {
    await toggle.click({ timeout: timeoutMs });
  }
}

async function selectCreatedOrchard(page, pin, timeoutMs) {
  if (!pin) throw new Error('Cannot reselect created Orchard: its generated PIN was not recorded.');
  const tab = page.locator("button[role='tab'][title='Orchards']").first();
  if (await tab.isVisible().catch(() => false)) await tab.click({ timeout: timeoutMs });
  const search = page.locator("[data-guide='orchard-search']").first();
  await search.waitFor({ state: 'visible', timeout: timeoutMs });
  await search.fill(pin, { timeout: timeoutMs });
  const row = page.locator("[data-guide='orchard-row']").filter({ hasText: pin }).first();
  await row.waitFor({ state: 'visible', timeout: timeoutMs });
  await row.locator("[data-guide='orchard-select']").first().click({ timeout: timeoutMs });
}

// UiDropdownField renders a read-only Syncfusion input *inside* the clickable
// span[role=combobox]. The input is visible but its wrapper receives pointer
// events. Prefer that nearest ancestor before searching descendants; do not
// force-click the input, because doing so can leave the popup closed.
async function resolveDropdownClickTarget(root, locatorDescription) {
  const control = await firstVisibleLocator([
    root.locator('xpath=ancestor::*[@role="combobox"][1]'),
    root.getByRole('combobox'),
    root.locator('[role="combobox"]'),
    root.locator('button[aria-haspopup="listbox"]'),
    root.locator('input[aria-haspopup="listbox"]'),
    root
  ]);
  if (!control) throw new Error(`No dropdown found at ${JSON.stringify(locatorDescription)}.`);
  const isSyncfusionInput = await root.evaluate((element) =>
    element.matches('input.e-dropdownlist, input[readonly][aria-label="dropdownlist"]')
  ).catch(() => false);
  if (isSyncfusionInput && !(await control.evaluate((element) =>
    element.getAttribute('role') === 'combobox'
  ).catch(() => false))) {
    throw new Error(`Syncfusion dropdown wrapper was not found for ${JSON.stringify(locatorDescription)}.`);
  }
  return control;
}

/** Reapply the requested country/crop/season after a Workbench navigation. */
export async function applyWorkbenchCaptureScope(page, config, scope) {
  const modal = page.locator("[data-guide='app-selection-modal']");
  // A browser reload may show the header before the Blazor click handler is ready.
  // Waiting for the interactive map here also covers flows that skip map readiness.
  await waitForMapReady(page, { timeoutMs: 120000, settleMs: 0 }, config);
  const header = page.locator("[data-guide='app-selection']").first();
  await header.waitFor({ state: 'visible', timeout: 20000 });
  const badges = (await header.innerText()).toUpperCase();
  const alreadySelected = [scope.season, scope.crop, scope.country].every(code =>
    new RegExp(`(^|[^A-Z0-9])${String(code).toUpperCase()}($|[^A-Z0-9])`).test(badges));
  if (alreadySelected) return;
  await header.click({ timeout: 15000 });
  try {
    // KineX awaits season-definition pairs before rendering the AppSelection modal.
    await modal.first().waitFor({ state: 'visible', timeout: 60000 });
  } catch (error) {
    const info = { url: page.url(), header: (await header.innerText().catch(() => 'unavailable')).slice(0, 250),
      modalCount: await modal.count(), blazorError: await page.locator('.blazor-error-boundary').count() };
    throw new Error(`AppSelection did not open after the Workbench became interactive: ${JSON.stringify(info)}. ${error.message}`);
  }
  // Season first: its change can repopulate dependent crop/country options.
  for (const [name, aliases] of [
    ['season', [scope.season]],
    ['crop', [scope.crop]],
    ['country', [scope.country, scope.country === 'NZ' ? 'New Zealand' : scope.country]]
  ]) {
    await selectOptionByAliases(page, {
      locator: { selector: `[data-guide='app-selection-${name}']` },
      aliases,
      timeoutMs: 18000
    }, config);
    const native = page.locator(`[data-guide='app-selection-${name}'] select`).first();
    if (await native.count()) {
      const selectedLabel = await native.locator('option:checked').textContent().catch(() => '');
      const selectedValue = await native.inputValue();
      if (!aliases.some(alias => optionMatches(alias, selectedLabel) || optionMatches(alias, selectedValue))) {
        throw new Error(`Guide capture ${name} '${aliases[0]}' was not retained by AppSelection.`);
      }
    }
  }
  // Draft narrowing can update another selector after its own onchange.
  // Verify the entire final tuple, not just each intermediate selection.
  for (const [name, aliases] of [
    ['season', [scope.season]], ['crop', [scope.crop]],
    ['country', [scope.country, scope.country === 'NZ' ? 'New Zealand' : scope.country]]
  ]) {
    const root = page.locator(`[data-guide='app-selection-${name}']`).first();
    const native = root.locator('select').first();
    let label = '';
    let value = '';
    if (await native.count()) {
      label = await native.locator('option:checked').textContent().catch(() => '');
      value = await native.inputValue();
    } else {
      // UiSelectField may render a Syncfusion combobox instead of a native SELECT.
      const control = await resolveDropdownClickTarget(root, { selector: `[data-guide='app-selection-${name}']` });
      value = await readDropdownDisplayedValue(root, control);
    }
    if (!aliases.some(alias => optionMatches(alias, label) || optionMatches(alias, value))) {
      throw new Error(`Guide capture scope changed after narrowing: ${name} expected '${aliases[0]}', got '${label || value}'.`);
    }
  }
  const apply = page.locator("[data-guide='app-selection-apply']").first();
  const isEnabled = await apply.isEnabled();
  if (isEnabled) {
    await apply.click({ timeout: 12000 });
  } else {
    const reason = await page.locator("[data-guide='app-selection-validation'], [data-guide='app-selection-error'], [data-guide='app-selection-empty']")
      .allTextContents().catch(() => []);
    if (reason.some(item => item.trim())) {
      throw new Error(`Cannot apply guide capture scope: ${reason.join('; ').trim()}`);
    }
    // Current selection already matches all requested options; no write needed.
    await page.locator("[data-guide='app-selection-cancel']").first().click({ timeout: 12000 });
  }
  await modal.first().waitFor({ state: 'hidden', timeout: 25000 });
  await waitForMapReady(page, { timeoutMs: 120000, settleMs: 0 }, config);
}

async function selectOptionByAliases(page, action, config) {
  const root = resolveLocator(page, action.locator).first();
  const timeoutMs = Number(action.timeoutMs ?? config.defaultTimeoutMs ?? 20000);
  await root.waitFor({ state: 'visible', timeout: timeoutMs });
  const aliases = (action.aliases ?? []).map((x) => String(x).trim()).filter(Boolean);
  if (!aliases.length) throw new Error('selectOptionByAliases requires aliases.');
  // getByLabel() generally resolves directly to the native <select> in KineX.
  // Looking only for a descendant <select> caused native controls to be mistaken
  // for JS popups, which could never supply a role=option element.
  const native = await firstVisibleLocator(
    [root, root.locator('select')],
    async (candidate) => (await candidate.evaluate((element) => element.tagName)) === 'SELECT'
  );
  if (native) {
    const options = await native.locator('option').evaluateAll((nodes) => nodes.map((node) => ({
      value: node.value, label: node.textContent?.trim() ?? '', disabled: node.disabled
    })));
    const available = options.filter((option) => !option.disabled && option.value !== '');
    let match = available.find((option) => aliases.some((alias) =>
      optionMatches(alias, option.label) || optionMatches(alias, option.value)));
    // Explicitly opt in per action. The hectare fixture is not an MA eligibility
    // test; its reference data may not include PROD on every test deployment.
    if (!match && action.fallback === 'firstEnabled') {
      match = available[0];
      if (match) console.warn(
        `  Preferred ${aliases.join('/')} is unavailable for ${JSON.stringify(action.locator)}; ` +
        `using '${match.label}' from the live KineX options (hectare fixture only).`
      );
    }
    if (!match) throw new Error(
      `Required dropdown option ${aliases.join('/')} is unavailable for ${JSON.stringify(action.locator)}. ` +
      `Available enabled options: ${JSON.stringify(available.map((option) => option.label))}.`
    );
    // The Workbench Property Country is a native SELECT. Re-selecting the
    // already chosen country fires unnecessary Blazor onchange/re-render work.
    if ((await native.inputValue()) === match.value) return;
    await native.selectOption(match.value, { timeout: timeoutMs });
    if ((await native.inputValue()) !== match.value) {
      throw new Error(`KineX did not retain dropdown selection '${match.label}' for ${JSON.stringify(action.locator)}.`);
    }
    return;
  }
  const control = await resolveDropdownClickTarget(root, action.locator);
  // For Syncfusion, read the displayed input rather than the wrapper's text,
  // which may contain an unrelated label or placeholder.
  const initialValue = await readDropdownDisplayedValue(root, control);
  if (aliases.some((alias) => optionMatches(alias, initialValue))) return;
  await control.click({ timeout: Math.min(timeoutMs, 5000) });
  const popupId = (await control.getAttribute('aria-controls')) ?? (await control.getAttribute('aria-owns'));
  const candidates = [
    ...(popupId ? [page.locator(`#${cssEscape(popupId)} [role='option']:visible, #${cssEscape(popupId)} li.e-list-item:visible`)] : []),
    page.locator('.e-popup-open [role="option"]:visible, .e-popup-open li.e-list-item:visible'),
    page.locator('[role="option"]:visible, li.e-list-item:visible')
  ];
  const seen = new Set();
  const waitMs = Math.min(timeoutMs, 5000);
  const start = Date.now();
  while (Date.now() - start < waitMs) {
    for (const candidate of candidates) {
      const count = await candidate.count().catch(() => 0);
      for (let i=0;i<count;i++) {
        const option = candidate.nth(i);
        const data = await option.evaluate((e) => ({
          text: e.textContent?.trim() ?? '',
          value: e.getAttribute('data-value') ?? '',
          disabled: e.getAttribute('aria-disabled') === 'true' || e.classList.contains('e-disabled')
        })).catch(() => null);
        if (!data) continue;
        if (data.text || data.value) seen.add(`${data.text || data.value}${data.disabled ? ' (disabled)' : ''}`);
        if (!data.disabled && aliases.some((alias) => optionMatches(alias, data.text) || optionMatches(alias, data.value))) {
          await option.click({ timeout: Math.min(timeoutMs, 4000) });
          const feedbackTimeoutMs = Math.min(timeoutMs, 1600);
          const feedbackStarted = Date.now();
          let currentValue = '';
          do {
            currentValue = await readDropdownDisplayedValue(root, control);
            if (aliases.some((alias) => optionMatches(alias, currentValue))) return;
            await page.waitForTimeout(100);
          } while (Date.now() - feedbackStarted < feedbackTimeoutMs);
          throw new Error(
            `Dropdown option '${data.text || data.value}' was clicked but not retained for ${JSON.stringify(action.locator)}. ` +
            `Displayed value: ${JSON.stringify(currentValue)}; previous: ${JSON.stringify(initialValue)}.`
          );
        }
      }
    }
    await page.waitForTimeout(100);
  }
  const currentValue = await readDropdownDisplayedValue(root, control);
  throw new Error(
    `Required dropdown option ${aliases.join('/')} is unavailable for ${JSON.stringify(action.locator)} ` +
    `after ${waitMs}ms. Selected: ${JSON.stringify(currentValue)}. ` +
    `Visible options: ${JSON.stringify([...seen].slice(0, 30))}.`
  );
}

async function readDropdownDisplayedValue(root, control) {
  const input = await firstVisibleLocator([
    root,
    root.locator('input.e-dropdownlist, input[aria-label="dropdownlist"], input[role="combobox"]')
  ], async (candidate) => (await candidate.evaluate((element) => element.tagName)) === 'INPUT');
  if (input) return (await readControlValue(input)).trim();
  return (await readControlValue(control)).trim();
}

function optionMatches(alias, candidate) {
  const needle = String(alias).trim().toUpperCase();
  const haystack = String(candidate).trim().toUpperCase();
  if (!needle || !haystack) return false;
  if (needle === haystack) return true;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Z0-9])${escaped}($|[^A-Z0-9])`).test(haystack);
}

// A geometry task leaving the screen is not proof of a published ArcGIS link.
// Use the Workbench's public linked/pending state for the selected record, and
// its server-driven successor transition for Property -> Orchard creation.
export async function assertFixtureGeometryPublished(page, action, runtime = {}) {
  const entity = String(action.entity ?? '').toLowerCase();
  const timeoutMs = Number(action.timeoutMs ?? 30000);
  const nextEntity = String(action.nextEntity ?? '').toLowerCase();
  if (!['property', 'orchard', 'block'].includes(entity)) {
    throw new Error(`Invalid geometry publish checkpoint entity '${entity}'.`);
  }
  const start = Date.now();
  let last = 'No status reported';
  while (Date.now() - start < timeoutMs) {
    const view = await page.evaluate(() => {
      const visible = (selector) => [...document.querySelectorAll(selector)]
        .filter(el => !!el.getClientRects().length);
      const task = visible("[data-guide='geometry-task-panel']")[0];
      const choice = visible("[data-guide='geometry-choice']")[0];
      const choicePrerequisite = visible("[data-guide='geometry-parent-prerequisite']")[0];
      const parent = visible("[data-guide='geometry-parent-state']")[0];
      const form = visible("[data-guide='business-form-shell']")[0];
      const spatial = form?.querySelector("[data-guide='business-spatial-status']");
      const error = visible("[data-guide='map-error'], [data-guide='geometry-error']")
        .map(el => el.textContent?.trim()).filter(Boolean).join('; ');
      return {
        taskLabel: task?.getAttribute('aria-label') ?? '',
        choiceLabel: choice?.querySelector('h2')?.textContent?.trim() ?? '',
        parentPrerequisite: choicePrerequisite?.textContent?.trim() ?? '',
        parentReady: parent?.classList.contains('workbench-geometry-choice__parent-state--ready') ?? false,
        parentBlocked: parent?.classList.contains('workbench-geometry-choice__parent-state--blocked') ?? false,
        formEntity: form?.getAttribute('data-guide-entity') ?? '',
        spatialClasses: spatial?.className ?? '',
        spatialLabel: spatial?.getAttribute('aria-label') ?? '',
        headerLinked: Boolean(form?.querySelector('.workbench-business-form__entity-dot--linked')),
        error
      };
    });
    const verdict = classifyFixturePublication({ entity, nextEntity, ...view });
    if (verdict.ok) {
      runtime.geometryCheckpoints ??= [];
      runtime.geometryCheckpoints.push({ entity, evidence: verdict.evidence, at: new Date().toISOString() });
      return;
    }
    if (verdict.fatal) throw new Error(`Geometry publish checkpoint '${entity}' failed: ${verdict.reason}`);
    last = verdict.reason;
    await page.waitForTimeout(200);
  }
  throw new Error(`Geometry publish checkpoint '${entity}' timed out after ${timeoutMs}ms: ${last}`);
}

// After geometry publish Workbench can remain in map-focus or business-form
// fullscreen mode. Both hide the navigator: the tab existing in DOM is not
// evidence that Playwright can click it. Exit the modes using public UI controls.
// KineX renders the entity tabs only outside its dedicated Blocks navigator.
// MultiBlock finishes on Blocks, where the supported route back is the
// "Back to orchards" parent button rather than the hidden Orchards tab.
export async function openFixtureOrchardNavigator(page, timeoutMs = 30000) {
  const sidebar = page.locator("[data-guide='workbench-sidebar']").first();
  const tab = sidebar.locator("button[role='tab'][title='Orchards']").first();
  const back = sidebar.locator("[data-guide='back-to-orchards']").first();
  const search = sidebar.locator("[data-guide='orchard-search']").first();
  const blockNavigator = sidebar.locator("[data-guide='block-navigator']").first();
  const fullGis = page.locator("[data-guide='business-focus-full-gis']").first();
  const focus = page.locator("[data-guide='workbench-focus-toggle']").first();
  const started = Date.now();
  let last = '';
  let lastNavigationAction = null;
  while (Date.now() - started < timeoutMs) {
    if (await fullGis.isVisible().catch(() => false)) {
      await fullGis.click({ timeout: Math.min(5000, timeoutMs) });
    }
    const pressed = await focus.getAttribute('aria-pressed').catch(() => null);
    if (pressed === 'true' && await focus.isVisible().catch(() => false)) {
      await focus.click({ timeout: Math.min(5000, timeoutMs) });
    }
    // If MultiBlock left the navigator in Blocks mode, KineX does not render
    // the entity tabs. Navigate back using its explicit hierarchy control.
    if (await search.isVisible().catch(() => false)) return;
    if (await back.isVisible().catch(() => false)) {
      if (lastNavigationAction !== 'back') {
        await back.click({ timeout: Math.min(5000, timeoutMs) });
        lastNavigationAction = 'back';
      }
    } else if (await tab.isVisible().catch(() => false)) {
      if (lastNavigationAction !== 'tab') {
        await tab.click({ timeout: Math.min(5000, timeoutMs) });
        lastNavigationAction = 'tab';
      }
    }
    if (await search.isVisible().catch(() => false)) return;
    const column = page.locator("[data-guide='workbench-sidebar-column']").first();
    last = `mapFocus=${pressed}, fullGisVisible=${await fullGis.isVisible().catch(() => false)}, `
      + `sidebarClass=${(await column.getAttribute('class').catch(() => '')) ?? ''}, `
      + `blockNavigatorVisible=${await blockNavigator.isVisible().catch(() => false)}, `
      + `backToOrchardsVisible=${await back.isVisible().catch(() => false)}, `
      + `orchardTabVisible=${await tab.isVisible().catch(() => false)}`;
    await page.waitForTimeout(250);
  }
  throw new Error(`Cannot open Orchard navigator after MultiBlock publish (${last}). `
    + 'Check the Blocks navigator Back to orchards control and the sidebar navigation.');
}

// Test-only prerequisite: create a unique, run-owned Entity through the same KineX
// UI/API that users use. EntityCode is generated by KineX and must be read back;
// it cannot be specified in EntityCreateDto. Never reuse a similarly named
// commercial Entity or invent a server code such as TEST-0001.
export async function provisionE2eGrowerSupplier(page, action, config, runtime) {
  const host = new URL(config.baseUrl).hostname;
  if (!runtime.flowId?.startsWith('ma-e2e-') || !isMaTestHost(host)) {
    throw new Error('Grower Supplier provisioning is restricted to the standalone MA E2E test host.');
  }
  if (JSON.stringify(action.entityTypeAliases) !== JSON.stringify(['Company', 'COMPANY'])
      || JSON.stringify(action.countryAliases) !== JSON.stringify(['New Zealand', 'NZ'])) {
    throw new Error('Unreviewed E2E Entity reference selection.');
  }
  const timeoutMs = Number(action.timeoutMs ?? 25000);
  const name = resolveTemplate(action.name, config, runtime).trim();
  const prefix = String(config.mutations?.testPrefix ?? '').trim();
  if (!prefix || prefix.length < 3 || !name.startsWith(prefix + ' PIN3025 Supplier ')
      || !name.endsWith(' ' + runtime.runId) || name.includes('{{') || name.length > 200) {
    throw new Error('Refusing to provision a Grower Supplier without the exact run-owned test prefix.');
  }
  // ArcGIS Portal state is tab-scoped and not persisted with auth cookies.
  // Keep the original Workbench tab alive while provisioning through KineX UI.
  const entityPage = await page.context().newPage();
  try {
    await entityPage.goto(absoluteUrl(config.baseUrl, '/entity/entities'), { waitUntil: 'domcontentloaded' });
  const search = entityPage.getByPlaceholder('Search entities by name...').first();
  await search.waitFor({ state: 'visible', timeout: timeoutMs });
  await search.fill(name, { timeout: timeoutMs });
  // Search is debounced in Blazor; wait for the result/empty-state to settle.
  await entityPage.waitForTimeout(450);
  await entityPage.locator('.record-cards__status:has-text("Loading entities")').first()
    .waitFor({state:'hidden', timeout:timeoutMs}).catch(() => {});
  const cards = entityPage.locator('.record-card').filter({ has: entityPage.locator('.record-card__name').getByText(name, { exact: true }) });
  let created = false;
  let id = null;
  let code = null;
  const cardCount = await cards.count();
  if (cardCount > 1) throw new Error(`Ambiguous test Entity '${name}' — refusing to choose one.`);
  if (cardCount === 1) {
    const card = cards.first();
    if (await card.locator('.record-card__pill--inactive').count()) {
      throw new Error(`Run-owned test Entity '${name}' is inactive; refusing to reuse it.`);
    }
    code = (await card.locator('.record-card__code').innerText()).trim();
    await card.click({ timeout: timeoutMs });
  } else {
    const add = entityPage.getByRole('button', { name: /Add entity/i }).first();
    await add.waitFor({ state: 'visible', timeout: timeoutMs });
    if (!await add.isEnabled()) throw new Error('Cannot provision E2E Entity: missing KineX Entity.Create permission.');
    await add.click({ timeout: timeoutMs });
    const nameInput = entityPage.locator('#entity-create-name').first();
    await nameInput.waitFor({ state: 'visible', timeout: timeoutMs });
    await nameInput.fill(name, { timeout: timeoutMs });
    await selectOptionByAliases(entityPage, { locator: { selector: '#entity-create-type' }, aliases: action.entityTypeAliases, timeoutMs }, config);
    await selectOptionByAliases(entityPage, { locator: { selector: '#entity-create-country' }, aliases: action.countryAliases, timeoutMs }, config);
    // Wait for the active step to advance before requesting another Next.
    // Review replaces Next with Create entity; a transient heading check
    // must never lead to a 25s wait for a button that has disappeared.
    await advanceEntityWizardToReview(entityPage, timeoutMs);
    const reviewText = await entityPage.locator('.create-review__subject').innerText();
    if (!reviewText.includes(name) || !/New Zealand/i.test(reviewText)) {
      throw new Error('E2E Entity review does not confirm the exact NZ test identity.');
    }
    // Record possible persistence before POST: a browser timeout after submit
    // must not tempt an operator to blindly replay the same setup.
    runtime.provisionedPrerequisites ??= [];
    runtime.provisionedPrerequisites.push({ kind: 'growerSupplierEntity', name, status: 'submission-uncertain' });
    await entityPage.getByRole('button', { name: 'Create entity', exact: true }).click({ timeout: timeoutMs });
    created = true;
    // Do not submit a second time if navigation stalls: the first write may
    // already have succeeded. Preserve the diagnostic and inspect the Entity.
    const open = entityPage.getByRole('button', { name: 'Open entity', exact: true }).first();
    const detail = entityPage.locator('.record-details__identity');
    await Promise.race([
      detail.waitFor({ state: 'visible', timeout: timeoutMs }),
      open.waitFor({ state: 'visible', timeout: timeoutMs })
    ]);
    if (!await detail.isVisible().catch(() => false)) await open.click({ timeout: timeoutMs });
  }
  const detail = entityPage.locator('.record-details__identity');
  await detail.waitFor({ state: 'visible', timeout: timeoutMs });
  const detailName = (await detail.locator('.record-details__name').innerText()).trim();
  const actualCode = (await entityPage.locator('.record-details__metadata .record-details__code').first().innerText()).trim();
  const match = /\/entity\/entities\/([0-9a-f-]{36})(?:[/?#]|$)/i.exec(new URL(entityPage.url()).pathname);
  id = match?.[1] ?? null;
  if (!id || !actualCode || detailName !== name || (code && code !== actualCode)
      || await detail.locator('.record-card__pill--inactive').count()) {
    throw new Error('E2E Grower Supplier identity did not match the persisted KineX Entity.');
  }
  runtime.variables ??= {};
  runtime.variables.e2eSupplierName = name;
  runtime.variables.e2eSupplierCode = actualCode;
  runtime.variables.e2eSupplierId = id;
  runtime.provisionedPrerequisites ??= [];
  runtime.provisionedPrerequisites = runtime.provisionedPrerequisites
    .filter(record => !(record.kind === 'growerSupplierEntity' && record.name === name));
  runtime.provisionedPrerequisites.push({ kind: 'growerSupplierEntity', id, name, entityCode: actualCode, created });
  console.log(`  E2E prerequisite ${created ? 'created' : 'reused'}: run-owned Grower Supplier Entity (${actualCode}).`);
  } finally {
    await entityPage.close().catch(() => {});
  }
}

async function stageFixtureGrowerSupplier(page, action, config, runtime) {
  const timeoutMs = Number(action.timeoutMs ?? 18000);
  const step = page.locator("[data-guide='orchard-grower-supply-step']").first();
  await step.waitFor({ state: 'visible', timeout: timeoutMs });
  const input = step.locator("input[aria-label='Grower supplier']").first();
  const search = resolveTemplate(action.search ?? '', config, runtime).trim();
  const expectedCode = resolveTemplate(action.entityCode ?? '', config, runtime).trim();
  if (!search || !expectedCode) throw new Error('E2E requires a specific test Grower Supplier name and Entity code.');
  await input.fill(search, { timeout: timeoutMs });
  const candidates = step.locator('button.workbench-reference-picker__option');
  await candidates.first().waitFor({ state: 'visible', timeout: timeoutMs });
  const count = await candidates.count();
  const matches = [];
  for (let index = 0; index < count; index++) {
    const option = candidates.nth(index);
    const code = (await option.locator('.workbench-reference-picker__option-detail').textContent().catch(() => ''))?.trim();
    if (code === expectedCode) matches.push(option);
  }
  if (matches.length !== 1) throw new Error(`Grower Supplier '${expectedCode}' not uniquely available in test Entity search '${search}'; refusing to stage an unrelated supplier.`);
  await matches[0].click({ timeout: timeoutMs });
  const fifth = step.locator('#create-orchard-grower-supply-fifth-character').first();
  if (await fifth.isVisible().catch(() => false)) {
    const character = String(action.fifthCharacter ?? '');
    if (!/^[A-Za-z0-9]$/.test(character)) throw new Error('Orchard PIN requires a valid 5th grower-number character.');
    await fifth.fill(character, { timeout: timeoutMs });
  }
  await step.getByRole('button', { name: 'Stage entity', exact: true }).click({ timeout: timeoutMs });
  const staged = step.locator('.draft-step__staged .draft-step__item').filter({ hasText: expectedCode });
  await staged.waitFor({ state: 'visible', timeout: timeoutMs });
}

async function openFixtureOrchardForMa(page, action, config, runtime) {
  const timeoutMs = Number(action.timeoutMs ?? 25000);
  const hostname = new URL(page.url()).hostname;
  if (!isMaTestHost(hostname)) throw new Error(`E2E MA mutations refused on host '${hostname}'.`);
  const pin = runtime.variables?.orchardPin;
  if (!pin) throw new Error('E2E cannot identify the Orchard from this run; refusing to select an unrelated parent.');
  const exactName = resolveTemplate(action.expectedName ?? '', config, runtime);
  if (!exactName || exactName.includes('{{')) throw new Error('E2E Orchard ownership marker is missing.');
  await openFixtureOrchardNavigator(page, timeoutMs);
  await page.locator("[data-guide='orchard-search']").first().fill(pin, { timeout: timeoutMs });
  const row = page.locator("[data-guide='orchard-row']").filter({ hasText: pin }).filter({ hasText: exactName });
  await row.first().waitFor({ state: 'visible', timeout: timeoutMs });
  if (await row.count() !== 1) throw new Error(`E2E Orchard selection expected exactly one '${exactName}' with PIN '${pin}'.`);
  await row.locator("[data-guide='orchard-select']").first().click({ timeout: timeoutMs });
  const form = page.locator("[data-guide='business-form-shell'][data-guide-entity='orchard']").first();
  await form.waitFor({ state: 'visible', timeout: timeoutMs });
  const text = await form.textContent() ?? '';
  if (!text.includes(pin) && !text.includes(exactName)) throw new Error('Selected Orchard Business Form does not confirm the E2E parent.');
}

async function selectFixtureMaBlock(page, action, config, runtime) {
  const timeoutMs = Number(action.timeoutMs ?? 16000);
  const name = resolveTemplate(action.name ?? '', config, runtime);
  if (!/^PIN3025-E2E-[1-4]$/.test(name)) throw new Error(`MA E2E assignment refused unexpected Block '${name}'.`);
  const rows = page.locator('table.workbench-ma-assignment__table tbody tr').filter({
    has: page.locator('th[scope="row"]').getByText(name, { exact: true })
  });
  await rows.first().waitFor({ state: 'visible', timeout: timeoutMs });
  if (await rows.count() !== 1) throw new Error(`Expected exactly one MA eligible Block row '${name}', found ${await rows.count()}.`);
  const checkbox = rows.first().locator("input[type='checkbox'][aria-label^='Assign Block ']").first();
  if (!await checkbox.isEnabled()) throw new Error(`Block '${name}' is incompatible or assigned to another MA.`);
  await checkbox.check({ timeout: timeoutMs });
  if (!await checkbox.isChecked()) throw new Error(`MA assignment did not retain selected Block '${name}'.`);
}

async function verifyFixtureMaCode(page, action, config, runtime) {
  const expected = resolveTemplate(action.expected ?? '', config, runtime);
  const field = page.locator("[data-guide='business-form-shell'][data-guide-entity='maturity area'] [data-guide='ma-bf-code']").first();
  await field.waitFor({ state: 'visible', timeout: action.timeoutMs ?? 25000 });
  const text = await field.locator('.workbench-business-field__value').first().textContent();
  if (String(text ?? '').trim() !== expected) throw new Error(`MA code was not persisted: expected '${expected}', found '${String(text ?? '').trim()}'.`);
}

async function verifyFixtureMaMembership(page, action, config, runtime) {
  const expected = action.expected ?? [];
  if (!Array.isArray(expected) || expected.length < 2) throw new Error('MA E2E membership verification requires the two named Blocks.');
  const tab = page.locator("[data-guide='business-form-shell'][data-guide-entity='maturity area'] [data-guide='ma-blocks-tab']").first();
  await tab.waitFor({ state: 'visible', timeout: action.timeoutMs ?? 25000 });
  const text = (await tab.innerText()).replace(/\s+/g, ' ');
  // KineX renders the persistent membership count and compact Block rows in
  // the Allocation tab. The Profile-tab ma-bf-block-count may not be rendered.
  if (!new RegExp(`\\b${expected.length} Blocks?\\b`, 'i').test(text)) {
    throw new Error(`MA membership not persisted: expected ${expected.length} Blocks; Allocation summary: '${text.slice(0, 180)}'.`);
  }
  for (const name of expected) {
    if (!text.includes(name)) throw new Error(`MA Allocation is missing newly assigned Block '${name}'.`);
  }
}

async function verifyBlockHectareFixture(page, action, config, runtime) {
  const timeoutMs = Number(action.timeoutMs ?? 30000);
  const pin = runtime.variables?.orchardPin;
  if (!pin) throw new Error('Cannot validate business hectares without the created Orchard PIN.');
  await openFixtureOrchardNavigator(page, timeoutMs);
  const search = page.locator("[data-guide='orchard-search']").first();
  await search.waitFor({ state: 'visible', timeout: timeoutMs });
  await search.fill(pin, { timeout: timeoutMs });
  const orchardRow = page.locator("[data-guide='orchard-row']").filter({hasText: pin}).first();
  await orchardRow.waitFor({state:'visible', timeout:timeoutMs});
  await orchardRow.locator("[data-guide='open-blocks']").first().click({timeout:timeoutMs});
  const blockSearch = page.locator("[data-guide='block-search']").first();
  await blockSearch.waitFor({state:'visible',timeout:timeoutMs});
  const expectations = action.blocks ?? [];
  for (const [blockIndex, block] of expectations.entries()) {
    const name = runtime.variables?.blockPrefix ? `${runtime.variables.blockPrefix}${blockIndex + 1}` : block.name;
    const expectedHectares = runtime.variables?.expectedHectares?.[blockIndex] ?? block.businessHectares;
    await blockSearch.fill(name, {timeout:timeoutMs});
    const row = page.locator("[data-guide='block-row']").filter({hasText:name}).first();
    await row.waitFor({state:'visible',timeout:timeoutMs});
    await row.locator("[data-guide='block-select']").first().click({timeout:timeoutMs});
    const form = page.locator("[data-guide='business-form-shell'][data-guide-entity='block']").first();
    await form.waitFor({state:'visible',timeout:timeoutMs});
    const title = form.locator('.workbench-business-form__title').first();
    await title.filter({ hasText: name }).waitFor({ state:'visible', timeout:timeoutMs });
    const spatial = form.locator("[data-guide='business-spatial-status']").first();
    let spatialState = {};
    const spatialStart = Date.now();
    do {
      spatialState = {
        classes: (await spatial.getAttribute('class').catch(() => '')) ?? '',
        label: (await spatial.getAttribute('aria-label').catch(() => '')) ?? '',
        headerLinked: (await form.locator('.workbench-business-form__entity-dot--linked').count()) > 0
      };
      if (linkedSpatialStatus(spatialState)) break;
      await page.waitForTimeout(200);
    } while (Date.now() - spatialStart < timeoutMs);
    if (!linkedSpatialStatus(spatialState)) {
      throw new Error(`Block '${name}' is not confirmed linked to ArcGIS: ${spatialState.label || spatialState.classes || 'no spatial status'}`);
    }
    runtime.geometryCheckpoints ??= [];
    runtime.geometryCheckpoints.push({ entity:'block', name,
      evidence:'business-form-spatial-linked', at:new Date().toISOString() });
    const field = form.locator('.workbench-business-field').filter({
      has: page.locator('.workbench-business-field__label span').getByText('Area', {exact:true})
    }).first();
    await field.waitFor({state:'visible',timeout:timeoutMs});
    const text = (await field.locator('.workbench-business-field__value').first().innerText()).trim();
    const number = parseDisplayedHectares(text);
    if (number === null || Math.abs(number - Number(expectedHectares)) > 0.0001) {
      throw new Error(`Block '${name}' business hectares after GIS publish: expected ${expectedHectares}, got '${text}'.`);
    }
  }
}

export function parseDisplayedHectares(value) {
  const text = String(value ?? '').replace(/\s/g, '').replace(/,/g, '');
  const match = text.match(/^-?(?:\d+\.?\d*|\.\d+)/);
  return match ? Number(match[0]) : null;
}

export function isMaTestHost(hostname) {
  const host = String(hostname ?? '').trim().toLowerCase();
  return ['localhost', '127.0.0.1', '::1', 'kinextest.seeka.co.nz'].includes(host)
    || host.endsWith('.test') || host.endsWith('.localhost');
}

async function assertMaMutationScope(page, action, config, runtime) {
  const hostname = await page.evaluate(() => window.location.hostname);
  if (!isMaTestHost(hostname)) {
    throw new Error(`MA creation is limited to disposable test hosts; current host '${hostname}'.`);
  }
  const expected = resolveTemplate(action.expectedParentText ?? '', config, runtime).trim();
  if (expected.length < 4 || !/^[a-z0-9][a-z0-9 -]*$/i.test(expected)) {
    throw new Error('MA creation requires a specific guide-owned Orchard prefix.');
  }
  const target = page.locator(action.allowDrawer === true
    ? "[data-guide='maturity-area-parent-context']"
    : "[data-guide='business-form-shell'][data-guide-entity='orchard']").first();
  await target.waitFor({ state: 'visible', timeout: 12000 });
  const actual = (await target.textContent() ?? '').trim();
  if (!actual.toLowerCase().includes(expected.toLowerCase())) {
    throw new Error(`MA creation refused: selected parent does not match configured guide-owned Orchard prefix '${expected}'.`);
  }
}

async function assertFixtureScope(page, action, config) {
  const date = action.effectiveDate ?? '2026-07-01';
  const checks = action.dateSelectors ?? [];
  for (const selector of checks) {
    const input = page.locator(selector).first();
    await input.waitFor({ state: 'visible', timeout: action.timeoutMs ?? 20000 });
    const result = await input.evaluate((node) => ({ min: node.min, max: node.max, value: node.value }));
    if (result.min && date < result.min || result.max && date > result.max) {
      throw new Error(`E2E/fixture effective date ${date} is outside ${selector} allowed range ${result.min}–${result.max}. Check the selected Kiwifruit/NZ season and test effective date; do not reuse the CAB source snapshot date.`);
    }
    await input.fill(date);
    if (await input.inputValue() !== date) throw new Error(`Fixture effective date was not retained: ${selector}`);
  }
}

function readObjectPath(value, dottedPath) {
  return dottedPath.split('.').reduce((current, segment) => {
    if (current === undefined || current === null) return undefined;
    if (/^\d+$/.test(segment)) return current[Number(segment)];
    return current[segment];
  }, value);
}

async function dragBy(page, action, config) {
  const timeoutMs = Number(action.timeoutMs ?? config.defaultTimeoutMs ?? 20000);
  const locator = await waitForVisibleActionLocator(page, action, config);
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const box = await locator.boundingBox();
  if (!box) throw new Error(`Unable to calculate drag origin for ${JSON.stringify(action.locator)}.`);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const deltaX = Number(action.deltaX ?? 0);
  const deltaY = Number(action.deltaY ?? 0);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: Number(action.steps ?? 8) });
  await page.mouse.up();
  if (action.settleMs) await page.waitForTimeout(Number(action.settleMs));
}

async function fillValidOrchardPin(page, action, config, runtime) {
  const timeoutMs = Number(action.timeoutMs ?? config.defaultTimeoutMs ?? 20000);
  const input = await waitForVisibleActionLocator(page, action, config);
  const cropRoot = resolveLocator(page, action.cropLocator).first();

  await cropRoot.waitFor({ state: 'visible', timeout: timeoutMs });

  const nativeSelect = await firstVisibleLocator([
    cropRoot.locator('select'),
    cropRoot
  ], async (candidate) => (await candidate.evaluate((element) => element.tagName)) === 'SELECT');

  let cropContext = '';
  if (nativeSelect) {
    cropContext = await nativeSelect.evaluate((select) => {
      const option = select.options[select.selectedIndex];
      return `${option?.textContent ?? ''} ${option?.value ?? ''}`.trim();
    });
  } else {
    const control = await firstVisibleLocator([
      cropRoot.getByRole('combobox'),
      cropRoot.locator('[role="combobox"]'),
      cropRoot.locator('input.e-dropdownlist'),
      cropRoot.locator('input[aria-haspopup="listbox"]'),
      cropRoot.locator('button[aria-haspopup="listbox"]')
    ]);
    const controlValue = control ? await readControlValue(control) : '';
    const rootText = (await cropRoot.textContent().catch(() => '')) ?? '';
    cropContext = `${controlValue} ${rootText}`.trim();
  }

  if (!cropContext || /select a crop/i.test(cropContext)) {
    throw new Error('Select a Crop before generating the Orchard PIN.');
  }

  const prefix = resolveTemplate(action.prefix ?? 'UG', config, runtime);
  const pin = buildOrchardPin(prefix, runtime.runId ?? '', cropContext);
  await input.fill(pin, { timeout: timeoutMs });
}


async function continueOrchardDetailsWithUniquePin(page, action, config, runtime) {
  const timeoutMs = Number(action.timeoutMs ?? config.defaultTimeoutMs ?? 20000);
  const perAttemptTimeoutMs = Number(action.perAttemptTimeoutMs ?? 6000);
  const maxAttempts = Math.max(1, Number(action.maxAttempts ?? 12));
  const input = await waitForVisibleActionLocator(page, action, config);
  const cropRoot = resolveLocator(page, action.cropLocator).first();
  const continueButton = resolveLocator(page, action.continueLocator).first();
  const success = resolveLocator(page, action.successLocator).first();
  const pinError = page.locator("[data-guide='orchard-pin'] .workbench-create-field__error").first();
  const validationSummary = page.locator("[data-guide='create-validation-summary']").first();
  const createError = page.locator("[data-guide='create-error']").first();

  await cropRoot.waitFor({ state: 'visible', timeout: timeoutMs });

  const nativeSelect = await firstVisibleLocator([
    cropRoot.locator('select'),
    cropRoot
  ], async (candidate) => (await candidate.evaluate((element) => element.tagName)) === 'SELECT');

  let cropContext = '';
  if (nativeSelect) {
    cropContext = await nativeSelect.evaluate((select) => {
      const option = select.options[select.selectedIndex];
      return `${option?.textContent ?? ''} ${option?.value ?? ''}`.trim();
    });
  } else {
    const control = await firstVisibleLocator([
      cropRoot.getByRole('combobox'),
      cropRoot.locator('[role="combobox"]'),
      cropRoot.locator('input.e-dropdownlist'),
      cropRoot.locator('input[aria-haspopup="listbox"]'),
      cropRoot.locator('button[aria-haspopup="listbox"]')
    ]);
    const controlValue = control ? await readControlValue(control) : '';
    const rootText = (await cropRoot.textContent().catch(() => '')) ?? '';
    cropContext = `${controlValue} ${rootText}`.trim();
  }

  if (!cropContext || /select a crop/i.test(cropContext)) {
    throw new Error('Select a Crop before generating the Orchard PIN.');
  }

  const prefix = resolveTemplate(action.prefix ?? 'B', config, runtime);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidateSeed = createHash('sha256').update(`${runtime.runId}-${runtime.flowId}-${attempt}`).digest('hex');
    const pin = buildFixturePin(prefix, candidateSeed, Number(action.pinLength ?? 4));
    await input.fill(pin, { timeout: timeoutMs });

    await continueButton.waitFor({ state: 'visible', timeout: timeoutMs });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !(await continueButton.isEnabled().catch(() => false))) {
      await page.waitForTimeout(100);
    }
    if (!(await continueButton.isEnabled().catch(() => false))) {
      throw new Error('Orchard Continue action did not become enabled.');
    }

    await continueButton.click({ timeout: timeoutMs });

    // Never race four timeouts resolving to null: whichever times out first
    // would mask a later valid result, or an all-pending race would hang.
    let outcome = 'timeout';
    const attemptStart = Date.now();
    while (Date.now() - attemptStart < perAttemptTimeoutMs) {
      if (await success.isVisible().catch(() => false)) { outcome = 'success'; break; }
      if (await pinError.isVisible().catch(() => false)) { outcome = 'pin-error'; break; }
      if (await validationSummary.isVisible().catch(() => false)) { outcome = 'validation'; break; }
      if (await createError.isVisible().catch(() => false)) { outcome = 'create-error'; break; }
      await page.waitForTimeout(100);
    }

    if (outcome === 'success') {
      runtime.variables ??= {};
      runtime.variables.orchardPin = pin;
      return;
    }

    if (outcome === 'pin-error') {
      const message = ((await pinError.textContent().catch(() => '')) ?? '').trim();
      if (/already exists/i.test(message)) {
        continue;
      }
      throw new Error(`Orchard PIN validation failed: ${message || 'Unknown PIN validation error.'}`);
    }

    if (outcome === 'validation') {
      const message = ((await validationSummary.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
      throw new Error(`Orchard details validation failed: ${message || 'Unknown validation error.'}`);
    }

    if (outcome === 'timeout') {
      throw new Error(`Orchard details did not advance and displayed no validation error after ${perAttemptTimeoutMs}ms (PIN ${pin}).`);
    }

    if (outcome === 'create-error') {
      const message = ((await createError.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
      throw new Error(`Orchard details could not continue: ${message || 'Unknown create error.'}`);
    }
  }

  throw new Error(`Unable to find an unused Orchard PIN after ${maxAttempts} attempts.`);
}

export function buildFixturePin(prefix, seed, length = 4) {
  const n = BigInt(`0x${seed.slice(0, 12)}`);
  const suffixLength = length - String(prefix).length;
  if (suffixLength < 2) throw new Error('Fixture PIN prefix leaves insufficient uniqueness.');
  return String(prefix).toUpperCase() + (n % (36n ** BigInt(suffixLength))).toString(36).toUpperCase().padStart(suffixLength, '0');
}

export function buildOrchardPin(prefix, runId, cropContext, explicitLength = null) {
  const parsedLength = Number(explicitLength);
  const requiredLength = Number.isInteger(parsedLength) && parsedLength >= 2
    ? parsedLength
    : (/KIWIFRUIT|AVOCADO/i.test(String(cropContext ?? '')) ? 4 : 5);
  const safePrefix = String(prefix ?? '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
  const safeRunId = String(runId ?? '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();

  const prefixPart = (safePrefix || 'UG').slice(0, Math.min(2, requiredLength - 1));
  const remaining = requiredLength - prefixPart.length;
  const suffixSource = safeRunId || '00000';
  const suffix = suffixSource.slice(-remaining).padStart(remaining, '0');
  return `${prefixPart}${suffix}`.slice(0, requiredLength);
}

async function rememberValue(page, action, config, runtime, mode) {
  const locator = await waitForVisibleActionLocator(page, action, config);
  let value;
  if (mode === 'value') {
    value = await locator.inputValue().catch(async () => (await locator.textContent()) ?? '');
  } else {
    value = (await locator.textContent()) ?? '';
  }
  runtime.variables ??= {};
  runtime.variables[action.key] = String(value).trim();
}


async function rememberAttribute(page, action, config, runtime) {
  const locator = await waitForVisibleActionLocator(page, action, config);
  const value = await locator.getAttribute(action.name);

  if (value === null && action.allowMissing !== true) {
    throw new Error(
      `Attribute '${action.name}' was not present for ${JSON.stringify(action.locator)}.`
    );
  }

  runtime.variables ??= {};
  runtime.variables[action.key] = String(value ?? '').trim();
}

async function clickIfVisible(page, action, config) {
  const timeoutMs = Number(action.timeoutMs ?? 1500);
  const locator = resolveActionLocator(page, action);
  const candidate = await waitForFirstVisible(page, locator, timeoutMs, {
    requireEnabled: action.allowDisabled !== true
  });

  if (!candidate) {
    return false;
  }

  await candidate.scrollIntoViewIfNeeded().catch(() => {});
  await candidate.click({
    timeout: timeoutMs,
    force: action.force ?? false
  }).catch(() => false);
  return true;
}

async function clickCandidateUntil(page, action, config, runtime) {
  const timeoutMs = Number(action.timeoutMs ?? config.defaultTimeoutMs ?? 30000);
  const perCandidateTimeoutMs = Number(action.perCandidateTimeoutMs ?? 4000);
  const minimum = Math.max(1, Number(action.minCount ?? 1));
  const started = Date.now();
  let index = 0;

  while (Date.now() - started < timeoutMs) {
    const candidates = resolveLocator(page, action.locator);
    const count = await candidates.count().catch(() => 0);

    if (count === 0) {
      await page.waitForTimeout(100);
      continue;
    }

    if (index >= count) {
      break;
    }

    const candidate = candidates.nth(index);
    const visible = await candidate.isVisible().catch(() => false);
    const enabled = await candidate.isEnabled().catch(() => false);

    if (!visible || !enabled) {
      index++;
      continue;
    }

    await candidate.scrollIntoViewIfNeeded().catch(() => {});
    await candidate.click({ timeout: perCandidateTimeoutMs }).catch(() => {});

    let candidateReady = true;
    if (Array.isArray(action.afterClickActions) && action.afterClickActions.length > 0) {
      try {
        await runActions(page, action.afterClickActions, config, runtime);
      } catch {
        candidateReady = false;
      }
    }

    if (candidateReady
        && await waitForVisibleMinimum(page, action.successLocator, minimum, perCandidateTimeoutMs)) {
      return;
    }

    if (action.resetLocator) {
      const reset = await waitForFirstVisible(
        page,
        resolveLocator(page, action.resetLocator),
        Math.min(perCandidateTimeoutMs, 2000),
        { requireEnabled: true }
      );

      if (reset) {
        await reset.click({ timeout: perCandidateTimeoutMs }).catch(() => {});
        if (action.returnLocator) {
          await waitForVisibleMinimum(page, action.returnLocator, 1, perCandidateTimeoutMs);
        }
      }
    }

    index++;
  }

  throw new FlowSkippedError(
    action.message ??
    `No candidate for ${JSON.stringify(action.locator)} revealed ` +
    `${minimum} matching element(s) for ${JSON.stringify(action.successLocator)}.`
  );
}

async function waitForVisibleMinimum(page, specification, minimum, timeoutMs) {
  if (!specification) {
    return false;
  }

  const locator = resolveLocator(page, specification);
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const count = await locator.count().catch(() => 0);
    let visible = 0;
    for (let index = 0; index < count; index++) {
      if (await locator.nth(index).isVisible().catch(() => false)) {
        visible++;
      }
    }

    if (visible >= minimum) {
      return true;
    }

    await page.waitForTimeout(100);
  }

  return false;
}

async function waitForVisibleActionLocator(page, action, config) {
  const timeoutMs = Number(action.timeoutMs ?? config.defaultTimeoutMs ?? 30000);
  const locator = resolveActionLocator(page, action);
  const candidate = await waitForFirstVisible(page, locator, timeoutMs, {
    requireEnabled: action.allowDisabled !== true
  });

  if (!candidate) {
    throw new Error(
      `No visible${action.allowDisabled === true ? '' : ' enabled'} element was found for ` +
      `${JSON.stringify(action.locator)} within ${timeoutMs}ms.`
    );
  }

  return candidate;
}

async function waitForFirstVisible(page, locator, timeoutMs, options = {}) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index++) {
      const candidate = locator.nth(index);
      if (!(await candidate.isVisible().catch(() => false))) {
        continue;
      }

      if (options.requireEnabled && !(await candidate.isEnabled().catch(() => false))) {
        continue;
      }

      return candidate;
    }

    await page.waitForTimeout(100);
  }

  return null;
}

function resolveActionLocator(page, action) {
  let locator = resolveLocator(page, action.locator);
  if (Number.isInteger(action.nth)) {
    locator = locator.nth(action.nth);
  }
  return locator;
}

async function clickUntilVisible(page, action, config) {
  const timeoutMs = Number(action.timeoutMs ?? config.defaultTimeoutMs ?? 30000);
  const perAttemptTimeoutMs = Number(action.perAttemptTimeoutMs ?? 1500);
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (await waitForVisibleMinimum(page, action.successLocator, 1, 100)) {
      return;
    }

    const locator = resolveLocator(page, action.locator);
    const count = await locator.count().catch(() => 0);

    for (let index = 0; index < count; index++) {
      const candidate = locator.nth(index);
      if (!(await candidate.isVisible().catch(() => false))
          || !(await candidate.isEnabled().catch(() => false))) {
        continue;
      }

      await candidate.scrollIntoViewIfNeeded().catch(() => {});
      await candidate.click({
        timeout: Math.min(perAttemptTimeoutMs, Math.max(100, timeoutMs - (Date.now() - started))),
        force: action.force ?? false
      }).catch(() => {});

      if (await waitForVisibleMinimum(
        page,
        action.successLocator,
        Number(action.minCount ?? 1),
        Math.min(perAttemptTimeoutMs, 1000))) {
        return;
      }

      break;
    }

    await page.waitForTimeout(100);
  }

  throw new Error(
    action.message ??
    `Clicking ${JSON.stringify(action.locator)} did not reveal ` +
    `${JSON.stringify(action.successLocator)} within ${timeoutMs}ms.`
  );
}

async function clickFirst(page, action, config) {
  const timeoutMs = Number(action.timeoutMs ?? config.defaultTimeoutMs ?? 30000);
  const started = Date.now();
  const locator = resolveLocator(page, action.locator);

  while (Date.now() - started < timeoutMs) {
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index++) {
      const candidate = locator.nth(index);
      const visible = await candidate.isVisible().catch(() => false);
      const enabled = await candidate.isEnabled().catch(() => false);
      if (!visible || (!enabled && action.allowDisabled !== true)) {
        continue;
      }

      await candidate.scrollIntoViewIfNeeded().catch(() => {});
      await candidate.click({ timeout: timeoutMs, force: action.force ?? false });
      return;
    }

    await page.waitForTimeout(100);
  }

  throw new Error(`No visible enabled element was found for ${JSON.stringify(action.locator)}.`);
}

async function fillFromText(page, action, config) {
  const timeoutMs = Number(action.timeoutMs ?? config.defaultTimeoutMs ?? 30000);
  const source = resolveLocator(page, action.source).first();
  const target = resolveLocator(page, action.locator).first();

  await source.waitFor({ state: 'visible', timeout: timeoutMs });
  let value = (await source.textContent())?.trim() ?? '';

  if (action.pattern) {
    const match = new RegExp(action.pattern, action.flags ?? '').exec(value);
    value = match?.[Number(action.group ?? 1)] ?? match?.[0] ?? '';
  }

  if (Number.isInteger(action.maxLength) && action.maxLength > 0) {
    value = value.slice(0, action.maxLength);
  }

  if (!value) {
    throw new Error(`No text could be read from ${JSON.stringify(action.source)}.`);
  }

  await target.fill(value, { timeout: timeoutMs });
}

async function skipIfVisible(page, action, config) {
  const timeoutMs = Number(action.timeoutMs ?? 1500);
  const locator = resolveActionLocator(page, action);
  const candidate = await waitForFirstVisible(page, locator, timeoutMs, {
    requireEnabled: false
  });

  if (!candidate) {
    return;
  }

  const text = (await candidate.textContent().catch(() => ''))?.trim();
  throw new FlowSkippedError(
    action.message ?? text ?? `A skip condition was visible for ${JSON.stringify(action.locator)}.`
  );
}

async function requireLocator(page, action, config) {
  const timeoutMs = Number(action.timeoutMs ?? 5000);
  const minimum = Math.max(1, Number(action.minCount ?? 1));
  const locator = resolveLocator(page, action.locator);
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const count = await locator.count().catch(() => 0);
    let matching = 0;

    for (let index = 0; index < count; index++) {
      const candidate = locator.nth(index);
      if (action.visible === false || await candidate.isVisible().catch(() => false)) {
        matching++;
      }
    }

    if (matching >= minimum) {
      return;
    }

    await page.waitForTimeout(100);
  }

  throw new FlowSkippedError(
    action.message ??
    `Requires at least ${minimum} matching element(s) for ${JSON.stringify(action.locator)}.`
  );
}

async function selectSpecificOption(page, action, config, runtime) {
  const timeoutMs = Number(action.timeoutMs ?? config.defaultTimeoutMs ?? 30000);
  const root = resolveLocator(page, action.locator).first();
  const value = resolveTemplate(action.value ?? '', config, runtime);
  const label = resolveTemplate(action.label ?? '', config, runtime);

  await root.waitFor({ state: 'visible', timeout: timeoutMs });

  const nativeSelect = await firstVisibleLocator([
    root.locator('select'),
    root
  ], async (candidate) => (await candidate.evaluate((element) => element.tagName)) === 'SELECT');

  if (nativeSelect) {
    const option = label
      ? { label }
      : { value };
    await nativeSelect.selectOption(option, { timeout: timeoutMs });
    return;
  }

  const combobox = await resolveDropdownClickTarget(root, action.locator);

  const previousValue = await readControlValue(combobox);
  await combobox.scrollIntoViewIfNeeded().catch(() => {});
  await combobox.click({ timeout: timeoutMs });

  const popupId =
    (await combobox.getAttribute('aria-controls')) ??
    (await combobox.getAttribute('aria-owns'));

  const optionCandidates = [];
  if (popupId) {
    optionCandidates.push(page.locator(`#${cssEscape(popupId)} [role="option"]:visible`));
    optionCandidates.push(page.locator(`#${cssEscape(popupId)} li.e-list-item:visible`));
  }

  optionCandidates.push(root.locator('[role="option"]:visible'));
  optionCandidates.push(root.locator('li.e-list-item:visible'));
  optionCandidates.push(page.locator('.e-popup-open [role="option"]:visible'));
  optionCandidates.push(page.locator('.e-popup-open .e-list-item:visible'));
  optionCandidates.push(page.locator('[role="option"]:visible'));
  optionCandidates.push(page.locator('li.e-list-item:visible'));

  const option = await waitForMatchingEnabledOption(page, optionCandidates, {
    label,
    value,
    timeoutMs
  });

  if (!option) {
    throw new Error(
      `No dropdown option matching ${JSON.stringify(label || value)} appeared for ` +
      `${JSON.stringify(action.locator)} within ${timeoutMs}ms.`
    );
  }

  await option.scrollIntoViewIfNeeded().catch(() => {});
  try {
    await option.click({ timeout: Math.min(timeoutMs, 5000) });
  } catch {
    await option.click({ timeout: Math.min(timeoutMs, 5000), force: true });
  }

  await waitForControlChange(page, combobox, previousValue, dropdownFeedbackWaitMs(timeoutMs)).catch(() => {
    // Third-party controls sometimes never reflect the new value in their input.
    // Do not spend the entire form timeout here; the next form step validates readiness.
  });
}

async function waitForMatchingEnabledOption(page, candidates, options) {
  const started = Date.now();
  const expectedLabel = String(options.label ?? '').trim();
  const expectedValue = String(options.value ?? '').trim();

  while (Date.now() - started < options.timeoutMs) {
    for (const candidate of candidates) {
      const count = await candidate.count().catch(() => 0);
      for (let index = 0; index < count; index++) {
        const option = candidate.nth(index);
        if (!(await option.isVisible().catch(() => false))) {
          continue;
        }

        const state = await option.evaluate((element) => ({
          disabled:
            element.hasAttribute('disabled') ||
            element.getAttribute('aria-disabled') === 'true' ||
            element.classList.contains('e-disabled'),
          text: element.textContent?.trim() ?? '',
          value:
            element.getAttribute('data-value') ??
            element.getAttribute('value') ??
            element.getAttribute('data-uid') ??
            ''
        })).catch(() => null);

        if (!state || state.disabled) {
          continue;
        }

        const labelMatches = expectedLabel.length > 0 && state.text === expectedLabel;
        const valueMatches = expectedValue.length > 0 && state.value === expectedValue;
        if (labelMatches || valueMatches) {
          return option;
        }
      }
    }

    await page.waitForTimeout(100);
  }

  return null;
}

async function selectFirstOptionIfEmpty(page, action, config) {
  const timeoutMs = Number(action.timeoutMs ?? config.defaultTimeoutMs ?? 30000);
  const root = resolveLocator(page, action.locator).first();

  await root.waitFor({ state: 'visible', timeout: timeoutMs });

  const control = await firstVisibleLocator([
    root.locator('select'),
    root.getByRole('combobox'),
    root.locator('[role="combobox"]'),
    root.locator('input.e-dropdownlist'),
    root.locator('input[aria-haspopup="listbox"]'),
    root.locator('button[aria-haspopup="listbox"]'),
    root
  ]);

  if (!control) {
    throw new Error(
      `No visible dropdown control was found inside ${JSON.stringify(action.locator)}.`
    );
  }

  const currentValue = (await readControlValue(control)).trim();
  if (currentValue.length > 0) {
    return;
  }

  await selectFirstOption(page, action, config);
}

async function selectFirstOption(page, action, config) {
  const timeoutMs = Number(action.timeoutMs ?? config.defaultTimeoutMs ?? 30000);
  const root = resolveLocator(page, action.locator).first();

  await root.waitFor({ state: 'visible', timeout: timeoutMs });

  const nativeSelect = await firstVisibleLocator([
    root.locator('select'),
    root
  ], async (candidate) => (await candidate.evaluate((element) => element.tagName)) === 'SELECT');

  if (nativeSelect) {
    const selected = await nativeSelect.evaluate((select) => {
      const option = Array.from(select.options).find((candidate) =>
        !candidate.disabled && candidate.value !== '');
      return option?.value ?? null;
    });

    if (selected === null) {
      throw new Error(`No selectable native option was found for ${JSON.stringify(action.locator)}.`);
    }

    await nativeSelect.selectOption(selected);
    return;
  }

  const combobox = await resolveDropdownClickTarget(root, action.locator);

  const previousValue = await readControlValue(combobox);
  await combobox.scrollIntoViewIfNeeded().catch(() => {});
  await combobox.focus().catch(() => {});

  // Prefer keyboard selection for portalled dropdowns. Some KineX drawers render the
  // option list below the drawer's backdrop in the visual stacking order, which makes
  // a normal pointer click fail even though the option is visible and enabled.
  if (await tryKeyboardOptionSelection(page, combobox, previousValue, timeoutMs)) {
    return;
  }

  await combobox.click({ timeout: timeoutMs }).catch(() => {});

  const popupId =
    (await combobox.getAttribute('aria-controls')) ??
    (await combobox.getAttribute('aria-owns'));

  const optionCandidates = [];
  if (popupId) {
    optionCandidates.push(page.locator(`#${cssEscape(popupId)} [role="option"]:visible`));
    optionCandidates.push(page.locator(`#${cssEscape(popupId)} li.e-list-item:visible`));
  }

  // Prefer options associated with the current drawer before falling back to global
  // popup portals. This avoids selecting an unrelated autocomplete option elsewhere.
  optionCandidates.push(root.locator('[role="option"]:visible'));
  optionCandidates.push(root.locator('li.e-list-item:visible'));
  optionCandidates.push(page.locator('.e-popup-open [role="option"]:visible'));
  optionCandidates.push(page.locator('.e-popup-open .e-list-item:visible'));
  optionCandidates.push(page.locator('[role="option"]:visible'));
  optionCandidates.push(page.locator('li.e-list-item:visible'));

  const option = await waitForFirstEnabledOption(page, optionCandidates, timeoutMs);
  if (!option) {
    throw new Error(
      `No selectable dropdown options appeared for ${JSON.stringify(action.locator)} within ${timeoutMs}ms.`
    );
  }

  await option.scrollIntoViewIfNeeded().catch(() => {});
  try {
    await option.click({ timeout: Math.min(timeoutMs, 5000) });
  } catch (error) {
    // A drawer/backdrop may intercept pointer events even though the popup option is
    // the correct active option. A forced click is safe here because the action has
    // already restricted the target to a visible, enabled option.
    await option.click({ timeout: Math.min(timeoutMs, 5000), force: true });
  }

  await waitForControlChange(page, combobox, previousValue, dropdownFeedbackWaitMs(timeoutMs)).catch(() => {
    // The visible input can remain unchanged while the component updates its model.
    // Let the next form step determine readiness rather than blocking for 30 seconds.
  });
}

async function tryKeyboardOptionSelection(page, combobox, previousValue, timeoutMs) {
  const attemptTimeoutMs = Math.min(timeoutMs, 2000);

  try {
    await combobox.click({ timeout: attemptTimeoutMs }).catch(() => {});
    await combobox.press('ArrowDown', { timeout: attemptTimeoutMs });
    await page.waitForTimeout(100);
    await combobox.press('Enter', { timeout: attemptTimeoutMs });
    await waitForControlChange(page, combobox, previousValue, attemptTimeoutMs);
    return true;
  } catch {
    await combobox.press('Escape', { timeout: 1000 }).catch(() => {});
    return false;
  }
}

async function waitForEnabled(page, action, config) {
  const timeoutMs = Number(action.timeoutMs ?? config.defaultTimeoutMs ?? 30000);
  const locator = resolveActionLocator(page, action);
  const started = Date.now();

  await locator.waitFor({ state: 'visible', timeout: timeoutMs });

  while (Date.now() - started < timeoutMs) {
    if (await locator.isEnabled().catch(() => false)) {
      return;
    }

    await page.waitForTimeout(100);
  }

  const diagnostics = await locator.evaluate((element) => {
    const reasonHost = element.closest('[data-disabled-reason]');

    return {
      disabled: element.hasAttribute('disabled'),
      ariaDisabled: element.getAttribute('aria-disabled'),
      disabledReason: reasonHost?.getAttribute('data-disabled-reason') ?? null,
      text: element.textContent?.trim() ?? '',
      outerHTML: element.outerHTML.slice(0, 500)
    };
  }).catch(() => null);

  throw new Error(
    `Element did not become enabled within ${timeoutMs}ms for ${JSON.stringify(action.locator)}.` +
    (diagnostics ? ` Diagnostics: ${JSON.stringify(diagnostics)}` : '')
  );
}

async function firstVisibleLocator(candidates, predicate = null) {
  for (const candidate of candidates) {
    const count = await candidate.count().catch(() => 0);
    for (let index = 0; index < count; index++) {
      const item = candidate.nth(index);
      if (!(await item.isVisible().catch(() => false))) {
        continue;
      }

      if (predicate && !(await predicate(item).catch(() => false))) {
        continue;
      }

      return item;
    }
  }

  return null;
}

async function waitForFirstEnabledOption(page, candidates, timeoutMs) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    for (const candidate of candidates) {
      const count = await candidate.count().catch(() => 0);
      for (let index = 0; index < count; index++) {
        const option = candidate.nth(index);
        if (!(await option.isVisible().catch(() => false))) {
          continue;
        }

        const disabled = await option.evaluate((element) =>
          element.hasAttribute('disabled') ||
          element.getAttribute('aria-disabled') === 'true' ||
          element.classList.contains('e-disabled'));

        if (!disabled) {
          return option;
        }
      }
    }

    await page.waitForTimeout(100);
  }

  return null;
}

async function readControlValue(locator) {
  return locator.evaluate((element) => {
    if ('value' in element) {
      return String(element.value ?? '');
    }

    return element.textContent?.trim() ?? '';
  }).catch(() => '');
}

// Visual feedback is advisory for Syncfusion-style dropdowns, not a save checkpoint.
// Keep the form's normal waitForEnabled/save checks as the authoritative guard.
export function dropdownFeedbackWaitMs(actionTimeoutMs) {
  return Math.min(actionTimeoutMs, 1200);
}

async function waitForControlChange(page, locator, previousValue, timeoutMs) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const currentValue = await readControlValue(locator);
    if (currentValue && currentValue !== previousValue) {
      return;
    }

    await page.waitForTimeout(100);
  }

  throw new Error('The dropdown value did not change after selecting an option.');
}

function resolveTemplate(value, config, runtime) {
  if (typeof value !== 'string') {
    return value;
  }

  const values = {
    runId: runtime.runId ?? '',
    flowId: runtime.flowId ?? '',
    timestamp: runtime.timestamp ?? '',
    date: runtime.date ?? '',
    ...(config.guideData ?? {}),
    ...(runtime.variables ?? {})
  };

  return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key) => {
    if (key.startsWith('guideData.')) {
      return String(config.guideData?.[key.slice('guideData.'.length)] ?? '');
    }
    if (key.startsWith('mutations.')) {
      return String(config.mutations?.[key.slice('mutations.'.length)] ?? '');
    }
    if (key.startsWith('coverage.')) {
      return String(config.coverage?.[key.slice('coverage.'.length)] ?? '');
    }
    return String(values[key] ?? '');
  });
}

function cssEscape(value) {
  return value.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}
