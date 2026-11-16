#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../src/lib/config.mjs';
import { selectApiTarget, validateApiTarget } from '../src/lib/e2e07-api-target.mjs';
import { createLocalInsecureHttpsFetch } from '../src/lib/e2e07-local-https.mjs';
import { createE2e07LookupApi, resolveE2e07Identity } from '../src/lib/e2e07-identity-lookup.mjs';
import { collectOrchardCandidates, createCandidateApi } from '../src/lib/e2e07-candidate-inventory.mjs';

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-k') { options.insecure = true; continue; }
    if (arg === '--allow-existing-orchard') { options.allowExistingOrchard = true; continue; }
    if (!['--config', '--target', '--guide-config'].includes(arg) || !argv[i + 1] || argv[i + 1].startsWith('-')) {
      throw new Error(`Unknown or incomplete option ${arg}. Use --config FILE [--target local-api] [--allow-existing-orchard] [-k].`);
    }
    options[arg.slice(2)] = argv[++i];
  }
  if (!options.config) throw new Error('--config is required.');
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const configText = await fs.readFile(path.resolve(options.config), 'utf8');
  const scenario = JSON.parse(configText.replace(/^\uFEFF/, ''));
  const guideConfig = options.target ? await loadConfig(options['guide-config'] ?? './config.json') : null;
  const config = options.target ? selectApiTarget(guideConfig, options.target, scenario) : scenario;
  const target = validateApiTarget(config.apiBaseUrl);
  if (config.approvedTestHost?.toLowerCase() !== target.approvedTestHost) throw new Error('API host approval mismatch.');
  if (options.allowExistingOrchard && !['localhost', '127.0.0.1'].includes(target.approvedTestHost)) {
    throw new Error('--allow-existing-orchard requires loopback API target.');
  }
  const key = process.env.KINEX_E2E07_API_KEY;
  const bearer = process.env.KINEX_E2E07_BEARER_TOKEN;
  if (Boolean(key) === Boolean(bearer)) throw new Error('Supply exactly one of KINEX_E2E07_API_KEY or KINEX_E2E07_BEARER_TOKEN.');
  const headers = key ? { 'X-KineX-Api-Key': key } : { Authorization: `Bearer ${bearer}` };
  const transport = options.insecure ? createLocalInsecureHttpsFetch(config.apiBaseUrl) : fetch;
  const lookupApi = createE2e07LookupApi({ baseUrl: config.apiBaseUrl, headers, insecureLoopback: options.insecure });
  const { resolved } = await resolveE2e07Identity(config, lookupApi, { allowExistingOrchard: options.allowExistingOrchard });
  const api = createCandidateApi({ baseUrl: config.apiBaseUrl, headers, fetchImpl: transport });
  const inventory = await collectOrchardCandidates({ api, orchardId: resolved.orchardId, effectiveDate: config.scope.effectiveDate });
  console.log(JSON.stringify({ orchard: { name: resolved.orchardName, pin: resolved.orchardPin, season: resolved.season }, ...inventory }, null, 2));
} catch (error) {
  console.error(`E2E-07 candidate discovery failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
