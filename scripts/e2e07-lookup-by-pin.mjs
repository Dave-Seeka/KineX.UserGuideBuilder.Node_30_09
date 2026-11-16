#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createE2e07LookupApi, resolveE2e07Identity, saveResolvedConfig } from '../src/lib/e2e07-identity-lookup.mjs';

function parse(argv) {
  const out = { insecureLoopback: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '-k') { out.insecureLoopback = true; continue; }
    if (!['--config', '--output', '--target', '--api-base-url'].includes(key) || !argv[i + 1]) {
      throw new Error(`Unknown or incomplete argument '${key}'. Use --config FILE [--target local-api] [--api-base-url URL] [-k] [--output FILE].`);
    }
    out[key.slice(2)] = argv[++i];
  }
  if (!out.config) throw new Error('--config is required.');
  if (out.target && out.target !== 'local-api') throw new Error('Only --target local-api is supported by this standalone lookup.');
  return out;
}
try {
  const args = parse(process.argv.slice(2));
  const source = JSON.parse(await fs.readFile(path.resolve(args.config), 'utf8'));
  const baseUrl = args['api-base-url'] || (args.target === 'local-api' ? 'https://localhost:7002' : source.apiBaseUrl);
  const origin = new URL(baseUrl);
  if (args.insecureLoopback) console.error('WARNING: -k disables TLS verification for loopback lookup requests only.');
  const key = process.env.KINEX_E2E07_API_KEY;
  const token = process.env.KINEX_E2E07_BEARER_TOKEN;
  if (Boolean(key) === Boolean(token)) throw new Error('Set exactly one of KINEX_E2E07_API_KEY or KINEX_E2E07_BEARER_TOKEN.');
  const headers = key ? { 'X-KineX-Api-Key': key } : { Authorization: `Bearer ${token}` };
  const api = createE2e07LookupApi({ baseUrl, headers, insecureLoopback: args.insecureLoopback });
  const result = await resolveE2e07Identity(source, api);
  const config = {
    ...result.config,
    apiBaseUrl: origin.origin + '/',
    approvedTestHost: origin.hostname.toLowerCase()
  };
  const safeRun = String(source.testRunId ?? 'run').replace(/[^a-zA-Z0-9_-]/g, '_');
  const output = path.resolve(args.output ?? `output/fixture-runs/e2e07-resolved-${safeRun}.json`);
  if (output === path.resolve(args.config)) throw new Error('Refusing to overwrite the source config.');
  await saveResolvedConfig(output, config);
  console.log(JSON.stringify({ stage: 'lookup', noApiWrites: true, resolved: result.resolved, configFile: output }, null, 2));
  console.log('Next: run the existing E2E-07 preflight with --config set to configFile.');
} catch (error) {
  console.error(`E2E-07 lookup failed: ${error.message}`);
  process.exitCode = 1;
}
