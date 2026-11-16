import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { runActions } from './actions.mjs';
import { captureScreenshot } from './capture.mjs';
import { writeGuide } from './output.mjs';
import { ensureDirectory } from './utils.mjs';
import { auditViewport, resolveViewport } from './viewport-audit.mjs';
import { saveFixtureFailureDiagnostics } from './fixture-publication.mjs';
import { absoluteUrl } from './utils.mjs';
import { waitForMapReady } from './map-ready.mjs';

export async function runFlow(context, config, flow, args = {}) {
  const outputDirectory = path.join(config.outputDir, flow.id);
  const stagingDirectory = path.join(
    config.outputDir,
    '.staging',
    `${flow.id}-${process.pid}-${Date.now()}`
  );
  const imageDirectory = path.join(stagingDirectory, 'images');

  // A failed or skipped run must never leave a previous successful guide in place.
  await fs.rm(outputDirectory, { recursive: true, force: true });
  await ensureDirectory(imageDirectory);

  const suppliedPage = args.page ?? null;
  const page = suppliedPage ?? await context.newPage();
  const ownsPage = suppliedPage === null;
  const viewport = resolveViewport(flow, config, args);
  await page.setViewportSize(viewport);
  await resetWorkbenchTransientUi(page, config, { allowNavigation: flow.mutation !== true });

  if (args.verifyOnly === true && flow.id !== 'block-hectares-e2e-fixture') {
    throw new Error('--verify-only is supported only by the Block hectares E2E fixture flow.');
  }
  const verifyOnly = args.verifyOnly === true;
  if (verifyOnly && (!args.orchardPin || !args.blockPrefix)) {
    throw new Error('--verify-only requires --orchard-pin <PIN> and --block-prefix <prefix> to identify EXISTING Blocks.');
  }
  const expectedHectares = verifyOnly && args.expectedHectares
    ? String(args.expectedHectares).split(',').map(Number) : null;
  if (expectedHectares && (expectedHectares.length !== 4
      || expectedHectares.some((v) => !Number.isFinite(v) || v <= 0))) {
    throw new Error('--expected-hectares requires four positive comma-separated numbers.');
  }
  const now = new Date();
  const runtime = {
    runId: args.runId ?? now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14),
    flowId: flow.id,
    captureScope: args.captureScope ?? null,
    timestamp: now.toISOString(),
    date: now.toISOString().slice(0, 10),
    variables: verifyOnly ? { orchardPin: String(args.orchardPin), blockPrefix: String(args.blockPrefix), expectedHectares } : {}
  };
  const completedSteps = [];
  let currentStep = null;
  let diagnosticArtifacts = null;
  let published = false;
  let failedMessage = null;
  const isFixture = flow.id === 'block-hectares-e2e-fixture' || flow.id.startsWith('ma-e2e-');
  const manifestFile = isFixture ? path.join(config.outputDir, 'fixture-runs', `${runtime.runId}.json`) : null;
  async function writeFixtureManifest(status) {
    if (!manifestFile) return;
    await ensureDirectory(path.dirname(manifestFile));
    await fs.writeFile(manifestFile, `${JSON.stringify({
      runId: runtime.runId, flowId: flow.id, status, startedAt: runtime.timestamp,
      updatedAt: new Date().toISOString(),
      selectedPin: runtime.variables?.orchardPin ?? null,
      translationOffsetMetres: runtime.variables?.fixtureOffset ?? null,
      expectedCountry: runtime.captureScope?.country ?? 'NZ', expectedCrop: runtime.captureScope?.crop ?? 'KIWIFRUIT',
      expectedSeason: runtime.captureScope?.season ?? '2026',
      completedSteps: completedSteps.map((step) => step.heading),
      currentStep, currentAction: runtime.currentAction ?? null,
      geometryCheckpoints: runtime.geometryCheckpoints ?? [],
      provisionedPrerequisites: runtime.provisionedPrerequisites ?? [],
      diagnosticArtifacts, failure: failedMessage,
      note: 'Records and ArcGIS geometry persist after failure. Review test environment before running again.'
    }, null, 2)}\n`, 'utf8');
  }
  await writeFixtureManifest('starting');

  try {
    // Verify only the persisted Blocks from a failed Step 5 run. Never replay
    // Property/Orchard/Block creation, geometry injection, or approval preflight.
    const selectedSteps = fixtureRunStepEntries(flow, verifyOnly);
    for (const [index, step] of selectedSteps) {
      currentStep = { number: index + 1, heading: step.heading };
      await writeFixtureManifest('running');
      console.log(`[${index + 1}/${flow.steps.length}] ${step.heading}`);
      const actionChecks = await runActions(page, step.actions, config, runtime);

      if (step.readyWhen) {
        const { resolveLocator } = await import('./locator.mjs');
        await resolveLocator(page, step.readyWhen).waitFor({
          state: step.readyState ?? 'visible',
          timeout: step.readyTimeoutMs
        });
      }

      const explicitChecks = await runActions(page, step.checks, config, runtime);
      const viewportChecks = await auditViewport(page, config, args);
      const screenshot = await captureScreenshot(page, step.capture, config, imageDirectory);
      completedSteps.push({
        number: index + 1,
        heading: step.heading,
        instruction: step.instruction,
        notes: step.notes ?? [],
        checks: [...actionChecks, ...explicitChecks, ...viewportChecks],
        image: screenshot.image,
        blankImage: screenshot.blankImage,
        legend: screenshot.legend
      });
      await writeFixtureManifest('running');
    }

    await writeGuide(flow, completedSteps, stagingDirectory, {
      skipPdf: Boolean(args.noPdf)
    });

    await ensureDirectory(path.dirname(outputDirectory));
    await fs.rename(stagingDirectory, outputDirectory);
    published = true;
    await writeFixtureManifest(verifyOnly ? 'verified-existing' : 'fixture-created');
  } catch (error) {
    failedMessage = error instanceof Error ? error.message : String(error);
    if (isFixture) {
      diagnosticArtifacts = await saveFixtureFailureDiagnostics(page, config.outputDir, runtime, currentStep, failedMessage)
        .catch((diagnosticError) => ({ diagnosticError: String(diagnosticError) }));
    }
    await writeFixtureManifest('failed').catch(() => {});
    throw error;
  } finally {
    if (!page.isClosed() && flow.cleanupActions?.length) {
      await runActions(page, flow.cleanupActions, config, runtime).catch((error) => {
        console.warn(`  Flow cleanup did not complete: ${error instanceof Error ? error.message : String(error)}`);
      });
    }

    if (ownsPage && !args.keepOpen && !page.isClosed()) {
      await page.close().catch(() => {});
    }

    if (!published) {
      await fs.rm(stagingDirectory, { recursive: true, force: true }).catch(() => {});
    }
  }

  return outputDirectory;
}

export async function resetWorkbenchTransientUi(page, config = {}, options = {}) {
  if (!page || page.isClosed?.()) {
    return;
  }

  const timeoutMs = Math.min(1200, Number(config.defaultTimeoutMs ?? 20000));
  const safeControls = [
    "[data-guide='geometry-task-cancel']",
    "[data-guide='geometry-cancel'] button",
    "[data-guide='business-edit-cancel'] button",
    "[data-guide='create-cancel-action'] button",
    "[data-guide='ma-allocation-drawer'] button[aria-label^='Close ']",
    "[data-guide='select-pick-reversal-drawer'] button[aria-label^='Close ']",
    "[data-guide='schedule-change-modal'] button:has-text('Cancel')"
  ];

  for (let pass = 0; pass < 3; pass++) {
    let changed = false;

    const blockingDialog = page.locator(".ui-dialog[role='presentation']:visible, [role='dialog']:visible").first();
    if (await blockingDialog.isVisible().catch(() => false)) {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(100).catch(() => {});
      changed = true;
    }

    for (const selector of safeControls) {
      const candidates = page.locator(selector);
      const count = await candidates.count().catch(() => 0);

      for (let index = 0; index < Math.min(count, 3); index++) {
        const candidate = candidates.nth(index);
        if (!await candidate.isVisible().catch(() => false)) {
          continue;
        }

        if (!await candidate.isEnabled().catch(() => true)) {
          continue;
        }

        await candidate.click({ timeout: timeoutMs }).catch(() => {});
        await page.waitForTimeout(100).catch(() => {});
        changed = true;
        break;
      }
    }

    const remaining = page.locator([
      "[data-guide='entity-create-drawer']",
      "[data-guide='schedule-change-modal']",
      "[data-guide='ma-allocation-drawer']",
      "[data-guide='select-pick-reversal-drawer']",
      "[data-guide='geometry-task-panel']",
      ".ui-dialog[role='presentation']"
    ].join(', '));

    const visibleRemaining = await countVisibleLocators(remaining);
    if (visibleRemaining === 0) {
      break;
    }

    if (!changed) {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(150).catch(() => {});
    }
  }
  // Don't let a stuck dialog poison the next 20 guide captures. Never remove
  // overlays in the DOM or click through them; a safe capture may reload this
  // SAME authenticated tab, preserving ArcGIS's tab-bound login session.
  const blockers = page.locator("[role='dialog']:visible, .ui-dialog[role='presentation']:visible, [data-guide='entity-create-drawer']:visible, [data-guide='schedule-change-modal']:visible");
  if (await countVisibleLocators(blockers) > 0) {
    if (!options.allowNavigation) {
      throw new Error('Workbench transient UI did not close; refusing to abandon an in-progress mutation.');
    }
    console.warn('Workbench transient dialog remained open. Reloading the same browser tab before the next safe guide.');
    await page.goto(absoluteUrl(config.baseUrl, config.map?.workbenchPath ?? '/arcgis/orchard-workbench'),
      { waitUntil: 'domcontentloaded' });
    await waitForMapReady(page, { timeoutMs: 60000, settleMs: 0 }, config);
    if (await countVisibleLocators(blockers) > 0) {
      throw new Error('Workbench transient UI did not close after safe tab reload.');
    }
  }
}

async function countVisibleLocators(locator) {
  const count = await locator.count().catch(() => 0);
  let visible = 0;

  for (let index = 0; index < count; index++) {
    if (await locator.nth(index).isVisible().catch(() => false)) {
      visible++;
    }
  }

  return visible;
}

export function fixtureRunStepEntries(flow, verifyOnly) {
  if (!Array.isArray(flow?.steps) || flow.steps.length === 0) {
    throw new Error('Fixture flow must contain steps.');
  }
  return verifyOnly ? [[flow.steps.length - 1, flow.steps.at(-1)]]
    : [...flow.steps.entries()];
}
