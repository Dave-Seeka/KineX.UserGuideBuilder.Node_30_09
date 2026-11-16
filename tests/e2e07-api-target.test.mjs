import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig } from '../src/lib/config.mjs';
import { listApiTargets, selectApiTarget, validateApiTarget } from '../src/lib/e2e07-api-target.mjs';
import { createE2e07Api, fingerprint, validateE2e07Config } from '../src/lib/e2e07-pick-runner.mjs';

const valid = {
  apiTargets: {
    'local-api': { baseUrl: 'https://localhost:7002' },
    'kinex-test-api': { baseUrl: 'https://kinex.test:7001' }
  }
};
const sample = JSON.parse(await fs.readFile(new URL('../scenarios/e2e07-picks.example.json', import.meta.url), 'utf8'));

test('select API target without altering WEB base or scenario on disk', () => {
  const gui = { baseUrl: 'https://kinex.test:7004', ...valid };
  assert.deepEqual(listApiTargets(gui).map(x => x.name), ['local-api', 'kinex-test-api']);
  const scenario = structuredClone(sample);
  const target = selectApiTarget(gui, 'local-api', scenario);
  assert.equal(target.apiBaseUrl, 'https://localhost:7002');
  assert.equal(target.approvedTestHost, 'localhost');
  assert.equal(gui.baseUrl, 'https://kinex.test:7004');
  assert.equal(scenario.apiBaseUrl, sample.apiBaseUrl);
  assert.notEqual(target, scenario);
  assert.notEqual(fingerprint(target), fingerprint(selectApiTarget(gui, 'kinex-test-api', scenario)),
    'Switching selected API target must invalidate the persisted run-state fingerprint.');
});

test('unknown and unsafe targets fail closed', () => {
  assert.throws(() => selectApiTarget(valid, 'production', sample), /Unknown API target/);
  for (const origin of [
    'https://kinex.seeka.co.nz', 'https://127.0.0.2:7002',
    'http://kinex.test:7001', 'https://user:password@localhost:7002',
    'https://localhost:7002/v1/orchard', 'https://localhost:7002/?token=secret',
    'file:///etc/passwd'
  ]) {
    assert.throws(() => validateApiTarget(origin), /API target|nonlocal|Nonlocal/i, origin);
  }
  assert.deepEqual(validateApiTarget('http://127.0.0.1:5288'), {
    baseUrl: 'http://127.0.0.1:5288', approvedTestHost: '127.0.0.1'
  });
});

test('Guide config merges explicitly configured API targets with local default', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'api-target-config-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const configPath = path.join(dir, 'config.json');
  await fs.writeFile(configPath, JSON.stringify({ baseUrl: 'https://kinex.test:7004', apiTargets: {
    'local-api': { baseUrl: 'http://localhost:5288' }, 'custom-api': { baseUrl: 'https://custom.test:7002' }
  }}));
  const config = await loadConfig(configPath);
  assert.equal(config.apiTargets['local-api'].baseUrl, 'http://localhost:5288');
  assert.equal(config.apiTargets['kinex-test-api'].baseUrl, 'https://kinex.test:7001');
  assert.equal(config.apiTargets['custom-api'].baseUrl, 'https://custom.test:7002');
  assert.equal(config.baseUrl, 'https://kinex.test:7004');
});

test('selected target participates in E2E-07 approval checks', () => {
  const chosen = selectApiTarget(valid, 'local-api', sample);
  const mismatched = { ...chosen, approvedTestHost: 'kinex.test' };
  assert.throws(() => validateE2e07Config(mismatched), /refuses non-test hosts/);
  assert.match(validateApiTarget(chosen.apiBaseUrl).baseUrl, /^https:\/\/localhost:/);
});

test('read-only probe uses Blocks API, preserves API key header and rejects redirects', async () => {
  const calls = [];
  const api = createE2e07Api('https://localhost:7002', { 'X-KineX-Api-Key': 'test-value' }, async (url, options) => {
    calls.push({ url: String(url), ...options });
    return { status: 200, ok: true, text: async () => JSON.stringify({ items: [], totalCount: 0 }) };
  });
  const result = await api.probe();
  assert.deepEqual(result.items, []);
  assert.match(calls[0].url, /\/v1\/orchard\/blocks\?page=1&pageSize=1$/);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].headers['X-KineX-Api-Key'], 'test-value');
  assert.equal(calls[0].redirect, 'error');
  assert.equal(calls.length, 1);
});

test('--targets and --target probe option are available without mutation or secrets', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'api-target-cli-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const guidePath = path.join(dir, 'guide.json');
  await fs.writeFile(guidePath, JSON.stringify({ baseUrl: 'https://kinex.test:7004', apiTargets: valid.apiTargets }));
  const cli = path.resolve('scripts/e2e-07.mjs');
  const result = spawnSync(process.execPath, [cli, '--targets', '--guide-config', guidePath], {
    encoding: 'utf8', env: { ...process.env, KINEX_E2E07_API_KEY: '' }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).webBaseUrl, 'https://kinex.test:7004');
  assert.equal(JSON.parse(result.stdout).apiTargets[0].name, 'local-api');
  const malformed = spawnSync(process.execPath, [cli, '--config', path.resolve('scenarios/e2e07-picks.example.json'),
    '--target', 'local-api', '--guide-config', guidePath, '--stage', 'probe'],
    { encoding: 'utf8', env: { ...process.env, KINEX_E2E07_API_KEY: '', KINEX_E2E07_BEARER_TOKEN: '' } });
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /Supply exactly one credential/);
  const missing = spawnSync(process.execPath, [cli, '--config', path.resolve('scenarios/e2e07-picks.example.json'),
    '--target', 'unknown', '--guide-config', guidePath, '--stage', 'probe'], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Unknown API target/);
});

test('CLI probes chosen API over the wire and rejects missing routes without issuing writes', async t => {
  const http = await import('node:http');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const requests = [];
  let status = 200;
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, key: req.headers['x-kinex-api-key'] });
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(status === 200 ? JSON.stringify({ items: [], totalCount: 0, page: 1, pageSize: 1 }) : JSON.stringify({ error: 'not found' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'api-target-probe-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const guidePath = path.join(dir, 'config.json');
  await fs.writeFile(guidePath, JSON.stringify({ apiTargets: { 'local-api': { baseUrl: `http://127.0.0.1:${port}` } } }));
  const cli = path.resolve('scripts/e2e-07.mjs');
  const args = [cli, '--config', path.resolve('scenarios/e2e07-picks.example.json'), '--guide-config', guidePath, '--target', 'local-api', '--stage', 'probe'];
  const env = { ...process.env, KINEX_E2E07_API_KEY: 'private-test-key', KINEX_E2E07_BEARER_TOKEN: '' };
  const ok = await run(process.execPath, args, { encoding: 'utf8', env });
  assert.equal(JSON.parse(ok.stdout).authenticated, true);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], { method: 'GET', url: '/v1/orchard/blocks?page=1&pageSize=1', key: 'private-test-key' });
  assert.doesNotMatch(ok.stdout, /private-test-key/);
  status = 404;
  await assert.rejects(run(process.execPath, args, { encoding: 'utf8', env }), error => {
    assert.match(error.stderr, /did not return a KineX paged Blocks result/);
    assert.doesNotMatch(error.stderr, /private-test-key/);
    return true;
  });
  assert.equal(requests.length, 2);
  assert.ok(requests.every(req => req.method === 'GET'));
});
