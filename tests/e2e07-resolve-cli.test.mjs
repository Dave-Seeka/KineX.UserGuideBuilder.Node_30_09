import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ids = {
  orchard: '0199aabb-cccc-7ddd-8eee-000000000001',
  property: '0199aabb-cccc-7ddd-8eee-000000000002',
  crop: '0199aabb-cccc-7ddd-8eee-000000000003',
  season: '0199aabb-cccc-7ddd-8eee-000000000004',
  country: '0199aabb-cccc-7ddd-8eee-000000000005'
};
const page = items => ({ items, totalCount: items.length, page: 1, pageSize: 100 });

function invoke(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/e2e-07.mjs', ...args], { cwd: root, env });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}
async function serverFixture(t) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, path: new URL(req.url, 'http://localhost').pathname });
    let body;
    const pathname = requests.at(-1).path;
    if (pathname === '/v1/masterdata/crops') body = page([{ cropId: ids.crop, cropCode: 'KIWIFRUIT' }]);
    else if (pathname === '/v1/masterdata/seasons') body = page([{ seasonId: ids.season, seasonCode: '2027' }]);
    else if (pathname === '/v1/masterdata/season-definitions') body = page([{
      seasonId: ids.season, cropId: ids.crop, countryId: ids.country,
      countryCode: 'NZ', startDate: '2027-01-01', endDate: '2027-12-31'
    }]);
    else if (pathname === '/v1/orchard/orchards') body = page([{
      orchardId: ids.orchard, orchardPropertyId: ids.property,
      orchardPin: '4382', cropId: ids.crop
    }]);
    else if (pathname === `/v1/orchard/properties/${ids.property}`) body = { orchardPropertyId: ids.property, countryId: ids.country };
    else if (pathname === `/v1/orchard/orchards/${ids.orchard}`) body = {
      orchardId: ids.orchard, orchardPin: '4382', cropId: ids.crop,
      orchardName: 'UG PIN3025 E2E RUN7'
    };
    else { res.writeHead(404); res.end('not found'); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'e2e07-resolve-cli-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const config = {
    testRunId: 'KINEX-E2E-2027-0001',
    apiBaseUrl: `http://127.0.0.1:${server.address().port}`,
    approvedTestHost: '127.0.0.1',
    testOwner: { orchardPin: '4382', name: 'KINEX-E2E PIN3025 Orchard', orchardId: 'REPLACE_WITH_TEST_ORCHARD_UUID' },
    scope: { season: '2027', seasonId: 'REPLACE_WITH_SEASON_UUID', countryCode: 'NZ', cropCode: 'KIWIFRUIT', effectiveDate: '2027-07-01' },
    reversal: { effectiveDate: '2027-07-02' },
    select: { orchardBlockId: 'REPLACE_WITH_MAPPED_TEST_BLOCK_UUID' }
  };
  const configFile = path.join(dir, 'scenario.json');
  const stateFile = path.join(dir, 'state.json');
  await fs.writeFile(configFile, JSON.stringify(config));
  const env = { ...process.env, KINEX_E2E07_API_KEY: 'fake-local-test-key' };
  delete env.KINEX_E2E07_BEARER_TOKEN;
  return { dir, config, configFile, stateFile, env, requests };
}

test('CLI resolve looks up Orchard and Season from saved PIN/crop/year with placeholders, without Pick IDs or writes', async t => {
  const f = await serverFixture(t);
  const result = await invoke(['--config', f.configFile, '--stage', 'resolve', '--state', f.stateFile], f.env);
  assert.equal(result.code, 0, result.stderr);
  const out = JSON.parse(result.stdout);
  assert.equal(out.stage, 'resolve');
  assert.equal(out.noApiWrites, true);
  assert.equal(out.resolved.orchardId, ids.orchard);
  assert.equal(out.resolved.seasonId, ids.season);
  assert.ok(f.requests.length >= 6);
  assert.ok(f.requests.every(request => request.method === 'GET'));
  await assert.rejects(fs.stat(f.stateFile), { code: 'ENOENT' });
  assert.deepEqual(JSON.parse(await fs.readFile(f.configFile, 'utf8')), f.config);
});

test('CLI preflight resolves identity first then reports missing Block/Pick IDs without creating a journal', async t => {
  const f = await serverFixture(t);
  const result = await invoke(['--config', f.configFile, '--stage', 'preflight', '--state', f.stateFile], f.env);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /select\.orchardBlockId must be a nonzero UUID/);
  assert.doesNotMatch(result.stderr, /testOwner\.orchardId must be a nonzero UUID/);
  assert.ok(f.requests.length >= 6);
  assert.ok(f.requests.every(request => request.method === 'GET'));
  await assert.rejects(fs.stat(f.stateFile), { code: 'ENOENT' });
});
