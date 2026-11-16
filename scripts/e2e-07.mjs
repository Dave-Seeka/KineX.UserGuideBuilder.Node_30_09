#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { loadConfig } from '../src/lib/config.mjs';
import { listApiTargets, selectApiTarget, validateApiTarget } from '../src/lib/e2e07-api-target.mjs';
import { createE2e07Api, runE2e07 } from '../src/lib/e2e07-pick-runner.mjs';
import { createLocalInsecureHttpsFetch } from '../src/lib/e2e07-local-https.mjs';
import { createE2e07LookupApi, resolveE2e07Identity } from '../src/lib/e2e07-identity-lookup.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') { args.apply = true; continue; }
    if (arg === '--allow-existing-orchard') { args.allowExistingOrchard = true; continue; }
    if (arg === '-k' || arg === '--insecure-local-tls') { args.insecureLocalTls = true; continue; }
    if (arg === '--targets') { args.targets = true; continue; }
    if (!['--config','--stage','--state','--target','--guide-config'].includes(arg)
        || !argv[i + 1] || argv[i + 1].startsWith('--')) {
      throw new Error(`Unknown or incomplete argument '${arg}'. Use --targets or --config FILE [--guide-config FILE] [--target NAME] --stage probe|plan|resolve|preflight|select|split|reverse|verify|all [--state FILE] [--apply] [--allow-existing-orchard] [-k|--insecure-local-tls].`);
    }
    args[arg.slice(2)] = argv[++i];
  }
  return args;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const stage = options.stage ?? 'plan';
  if (!['probe', 'plan', 'resolve', 'preflight', 'select', 'split', 'reverse', 'verify', 'all'].includes(stage)) {
    throw new Error(`Unknown stage '${stage}'.`);
  }
  // Guide config owns the selectable API origins; scenario config owns test IDs.
  const guideConfig = options.targets || options.target
    ? await loadConfig(options['guide-config'] ?? './config.json')
    : null;
  if (options.targets) {
    console.log(JSON.stringify({ webBaseUrl: guideConfig.baseUrl, apiTargets: listApiTargets(guideConfig) }, null, 2));
  } else {
    if (!options.config) throw new Error('Supply --config scenarios/e2e07-picks.local.json.');
    const scenario = JSON.parse(await fs.readFile(path.resolve(options.config), 'utf8'));
    let config = options.target ? selectApiTarget(guideConfig, options.target, scenario) : scenario;
    const stateFile = path.resolve(options.state ?? `output/fixture-runs/e2e07-${config.testRunId}.json`);
    if (stage === 'probe') {
      // Probe the exact selected test API only. No scenario IDs, state or mutations.
      const target = validateApiTarget(config.apiBaseUrl);
      if (config.approvedTestHost?.toLowerCase() !== target.approvedTestHost) {
        throw new Error('API host approval does not match the selected API origin.');
      }
      const { pick } = createAuthenticatedApis(config.apiBaseUrl, options.insecureLocalTls);
      const response = await pick.probe();
      if (!response || !Array.isArray(response.items ?? response.Items)
          || !Number.isInteger(response.totalCount ?? response.TotalCount)) {
        throw new Error('API probe did not return a KineX paged Blocks result. Check the selected API URL and route.');
      }
      console.log(JSON.stringify({ target: options.target ?? 'scenario', apiBaseUrl: target.baseUrl, authenticated: true, canReadBlocks: true, noWrites: true }, null, 2));
    } else {
      // The resolver is read-only. For every non-plan stage it validates the
      // exact saved PIN/crop/season and pins Orchard/Season IDs before the
      // existing Pick runner validates IDs or accesses its operation journal.
      const clients = stage === 'plan' ? null : createAuthenticatedApis(config.apiBaseUrl, options.insecureLocalTls);
      let resolved = null;
      if (clients) {
        const target = validateApiTarget(config.apiBaseUrl);
        if (config.approvedTestHost?.toLowerCase() !== target.approvedTestHost) {
          throw new Error('API host approval does not match the selected API origin.');
        }
        const lookup = await resolveE2e07Identity(config, clients.lookup, { allowExistingOrchard: options.allowExistingOrchard });
        config = lookup.config;
        resolved = lookup.resolved;
      }
      if (stage === 'resolve') {
        // No Pick/MA/Block UUIDs or operation journal are required here.
        console.log(JSON.stringify({ stage, noApiWrites: true, resolved,
          next: 'Run --stage preflight with the same scenario; IDs resolve automatically.',
          apiTarget: options.target ?? 'scenario', apiBaseUrl: config.apiBaseUrl }, null, 2));
      } else {
        const result = await runE2e07({ config, stage, stateFile, api: clients?.pick, apply: options.apply, allowExistingOrchard: options.allowExistingOrchard });
        console.log(JSON.stringify({ ...result, ...(resolved ? { resolved } : {}),
          apiTarget: options.target ?? 'scenario', apiBaseUrl: config.apiBaseUrl }, null, 2));
      }
    }
  }
} catch (error) {
  console.error(`E2E-07 failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

function createAuthenticatedApis(baseUrl, insecureLocalTls = false) {
  const apiKey = process.env.KINEX_E2E07_API_KEY;
  const bearer = process.env.KINEX_E2E07_BEARER_TOKEN;
  if (Boolean(apiKey) === Boolean(bearer)) {
    throw new Error('Supply exactly one credential: KINEX_E2E07_API_KEY or KINEX_E2E07_BEARER_TOKEN. Do not put secrets in scenario JSON.');
  }
  const transport = insecureLocalTls ? createLocalInsecureHttpsFetch(baseUrl) : fetch;
  if (insecureLocalTls) {
    console.error('WARNING: -k disables TLS certificate verification for this loopback E2E-07 API connection only.');
  }
  const headers = apiKey
    ? { 'X-KineX-Api-Key': apiKey }
    : { Authorization: `Bearer ${bearer}` };
  return {
    pick: createE2e07Api(baseUrl, headers, transport),
    lookup: createE2e07LookupApi({ baseUrl, headers, insecureLoopback: insecureLocalTls })
  };
}
