import fs from 'node:fs/promises';
import path from 'node:path';
import { launchAuthenticatedBrowser } from '../lib/browser.mjs';
import { listFlowFiles, loadFlow } from '../lib/flow-loader.mjs';
import { runFlow } from '../lib/runner.mjs';
import { writeCoverageReport, writeGuideIndex } from '../lib/output.mjs';
import { ensureDirectory } from '../lib/utils.mjs';
import { FlowSkippedError } from '../lib/errors.mjs';
import { joinCollections } from '../lib/join.mjs';
import { isRateLimitSkip } from '../lib/rate-limit.mjs';
import { resolveGuideScope } from '../lib/guide-scope.mjs';
import { assertMutationPermission, flowExclusionReason, normalizeProfile, mayRetryGuideAfterFailure } from '../lib/profiles.mjs';

export async function captureFlow(config, flowPath, args = {}) {
  const { flow } = await loadFlow(flowPath);
  return captureLoadedFlow(config, flow, args);
}

export async function captureE2eScenario(config, scenarioPath, args = {}) {
  const { loadE2eScenario } = await import('../lib/e2e-scenario.mjs');
  const { scenario, flow } = await loadE2eScenario(scenarioPath, { allowPlaceholders: args.dryRun === true });
  if (args.dryRun === true) {
    console.log(JSON.stringify({ scenario: scenario.id, flow: flow.id, steps: flow.steps.map(s => s.heading), mutation: true, requiresGISApproval: true }, null, 2));
    return;
  }
  // All generated names in the foundation flow resolve mutations.testPrefix.
  // A missing prefix would make persisted test records indistinguishable from
  // ordinary orchard data. Bind it from the validated E2E JSON scenario.
  const e2eConfig = {
    ...config,
    mutations: { ...config.mutations, testPrefix: scenario.testPrefix }
  };
  return captureLoadedFlow(e2eConfig, flow, args);
}

async function captureLoadedFlow(config, flow, args = {}) {
  if (flow.mutation === true) {
    assertMutationPermission(config, 'mutation');
  }
  const captureScope = args.season || args.country || args.crop ? resolveGuideScope(args, config) : null;
  let session = await launchAuthenticatedBrowser(config, args);

  try {
    try {
      const output = await runFlow(session.context, config, flow, { ...args, captureScope, page: session.page });
      console.log(`Guide generated: ${output}`);
    } catch (error) {
      if (error instanceof FlowSkippedError) {
        console.warn(`Guide skipped: ${flow.title} — ${cleanErrorMessage(error)}`);
        return;
      }

      if (mayRetryGuideAfterFailure(flow, isRecoverableSessionError(error))) {
        console.warn(`Browser session became unhealthy while running '${flow.title}'. Relaunching once...`);
        await closeSession(session);
        session = await launchAuthenticatedBrowser(config, args);
        const output = await runFlow(session.context, config, flow, { ...args, captureScope, page: session.page });
        console.log(`Guide generated: ${output}`);
        return;
      }

      throw error;
    }
  } finally {
    if (!args.keepOpen) {
      await closeSession(session);
    }
  }
}

export async function captureAll(config, flowsDirectory, args = {}) {
  const files = await listFlowFiles(flowsDirectory);
  if (files.length === 0) {
    throw new Error(`No JSON flows found in ${flowsDirectory}.`);
  }

  const profile = normalizeProfile(args.profile ?? config.coverage?.profile ?? 'full');
  assertMutationPermission(config, profile);
  const captureScope = resolveGuideScope(args, config);
  if (captureScope) console.log(`Guide capture scope: ${captureScope.country} / ${captureScope.crop} / season ${captureScope.season}`);

  // capture:all is a complete publication run. Start from a clean directory so old
  // guides and removed legacy flows can never be mistaken for current results.
  const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const entries = [];
  let session = await launchAuthenticatedBrowser(config, args);

  try {
    // Authentication must succeed BEFORE clearing the last good guides.
    await fs.rm(config.outputDir, { recursive: true, force: true });
    await ensureDirectory(config.outputDir);
    for (const file of files) {
      const { flow } = await loadFlow(file);
      const exclusion = flowExclusionReason(flow, profile, config);
      if (exclusion) {
        entries.push({
          id: flow.id,
          title: flow.title,
          description: flow.description,
          category: flow.category,
          order: flow.order,
          profiles: flow.profiles ?? ['full'],
          mutation: flow.mutation === true,
          status: 'excluded',
          reason: exclusion
        });
        continue;
      }

      let retriedSession = false;

      while (true) {
        try {
          const output = await runFlow(session.context, config, flow, { ...args, captureScope, runId, page: session.page });
          console.log(`Guide generated: ${output}`);
          entries.push({
            id: flow.id,
            title: flow.title,
            description: flow.description,
            category: flow.category,
            order: flow.order,
            profiles: flow.profiles ?? ['full'],
            mutation: flow.mutation === true,
            status: 'generated'
          });
          break;
        } catch (error) {
          if (error instanceof FlowSkippedError) {
            const message = cleanErrorMessage(error);
            console.warn(`Guide skipped: ${flow.title} — ${message}`);
            entries.push({
              id: flow.id,
              title: flow.title,
              description: flow.description,
              category: flow.category,
              order: flow.order,
              status: 'skipped',
              reason: message
            });

            if (isRateLimitSkip(message)) {
              const cooldownMs = Math.max(0, Number(config.rateLimitCooldownMs ?? 30000));
              console.warn(
                `Create-flow throttling detected. Restarting the authenticated browser ` +
                `context before the next guide${cooldownMs > 0 ? ` after a ${cooldownMs}ms cooldown` : ''}.`
              );
              await closeSession(session);
              if (cooldownMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, cooldownMs));
              }
              session = await launchAuthenticatedBrowser(config, args);
            }
            break;
          }

          if (!retriedSession && mayRetryGuideAfterFailure(flow, isRecoverableSessionError(error))) {
            retriedSession = true;
            console.warn(
              `Browser session became unhealthy while running '${flow.title}'. ` +
              `Relaunching and retrying this guide once...`
            );
            await closeSession(session);
            session = await launchAuthenticatedBrowser(config, args);
            continue;
          }

          if (config.continueOnFlowError !== false) {
            const message = cleanErrorMessage(error);
            console.error(`Guide failed: ${flow.title} — ${message}`);
            entries.push({
              id: flow.id,
              title: flow.title,
              description: flow.description,
              category: flow.category,
              order: flow.order,
              status: 'failed',
              reason: message
            });

            // Preserve the live Workbench tab when the browser itself is still healthy. ArcGIS
            // authentication is deliberately tab-scoped now, so recreating the context after an
            // ordinary guide failure would force another GIS Portal login. runFlow clears safe
            // transient drawers/dialogs before the next guide starts.
            if (!session.page || session.page.isClosed()) {
              await closeSession(session);
              session = await launchAuthenticatedBrowser(config, args);
            }
            break;
          }

          throw error;
        }
      }
    }

    // Publish the per-guide summary first so collection coverage notes retain
    // the exact skipped/failed reasons from this capture run.
    if (config.coverage?.writeReport !== false) {
      await writeCoverageReport(entries, config.outputDir, { profile, captureScope });
    }
    await writeGuideIndex(entries, config.outputDir, { profile });
    const manuals = await joinCollections(
      config,
      path.resolve(args.collections ?? config.collectionsDir),
      { noPdf: Boolean(args.noPdf), profile }
    );
    await writeGuideIndex(entries, config.outputDir, { manuals, profile });
    for (const manual of manuals) {
      console.log(`Combined guide generated: ${path.join(config.outputDir, manual.path)}`);
    }
    console.log(`Guide index generated: ${path.join(config.outputDir, 'index.html')}`);
  } finally {
    if (!args.keepOpen) {
      await closeSession(session);
    }
  }
}



function isRecoverableSessionError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('locator.waitFor: Timeout') && message.includes('orchard-workbench')) {
    return true;
  }

  return [
    'Target page, context or browser has been closed',
    'browser has been closed',
    'context or browser has been closed',
    'browserContext.newPage',
    'Target.createTarget',
    'Protocol error',
    'page.goto: Timeout',
    "waiting for locator('[data-guide=\\'orchard-workbench\\']') to be visible",
    'net::ERR_CONNECTION',
    'Navigation failed because page was closed'
  ].some((fragment) => message.includes(fragment));
}

function cleanErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  // Playwright decorates terminal logs with ANSI sequences. They make generated
  // Markdown/HTML indexes unreadable, so store plain text in publication output.
  return message.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '').trim();
}

async function closeSession(session) {
  if (!session) {
    return;
  }

  await session.context?.close().catch(() => {});
  await session.browser?.close().catch(() => {});
}
