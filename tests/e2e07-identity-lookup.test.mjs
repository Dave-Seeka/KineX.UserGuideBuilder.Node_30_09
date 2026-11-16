import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveE2e07Identity, createE2e07LookupApi } from '../src/lib/e2e07-identity-lookup.mjs';

const ids = {
  orchard: '0199aabb-cccc-7ddd-8eee-000000000001',
  property: '0199aabb-cccc-7ddd-8eee-000000000002',
  crop: '0199aabb-cccc-7ddd-8eee-000000000003',
  season: '0199aabb-cccc-7ddd-8eee-000000000004',
  country: '0199aabb-cccc-7ddd-8eee-000000000005'
};
const original = {
  testRunId: 'e2e07-2027-run',
  testOwner: { orchardPin: '4382' },
  scope: { season: '2027', effectiveDate: '2027-07-01', countryCode: 'NZ', cropCode: 'KIWIFRUIT' },
  reversal: { effectiveDate: '2027-07-02' },
  select: { orchardBlockId: 'PLACEHOLDER' }
};
const page = items => ({ Items: items, TotalCount: items.length, Page: 1, PageSize: 100 });
const makeApi = () => ({
  crops: async () => page([{ CropId: ids.crop, CropCode: 'KIWIFRUIT' }]),
  seasons: async () => page([{ SeasonId: ids.season, SeasonCode: '2027' }]),
  seasonDefinitions: async () => page([{ SeasonId: ids.season, CropId: ids.crop, CountryId: ids.country, CountryCode: 'NZ', StartDate: '2027-01-01', EndDate: '2027-12-31' }]),
  orchards: async () => page([{ OrchardId: ids.orchard, OrchardPropertyId: ids.property, OrchardPin: '4382', CropId: ids.crop }]),
  property: async () => ({ OrchardPropertyId: ids.property, CountryId: ids.country }),
  orchard: async () => ({ OrchardId: ids.orchard, OrchardPin: '4382', CropId: ids.crop, OrchardName: 'UG PIN3025 E2E RUN7' })
});

test('resolves by saved PIN/crop/season/country and keeps source config untouched', async () => {
  const input = structuredClone(original);
  const { config, resolved } = await resolveE2e07Identity(input, makeApi());
  assert.equal(resolved.orchardId, ids.orchard);
  assert.equal(config.testOwner.orchardId, ids.orchard);
  assert.equal(config.scope.seasonId, ids.season);
  assert.equal(config.select.orchardBlockId, 'PLACEHOLDER');
  assert.equal(input.testOwner.orchardId, undefined);
});
test('rejects a wrong explicit orchardId', async () => {
  await assert.rejects(resolveE2e07Identity({ ...original, testOwner: { ...original.testOwner, orchardId: ids.property } }, makeApi()), /conflicts with lookup/);
});
test('rejects a wrong seasonId assertion', async () => {
  await assert.rejects(resolveE2e07Identity({ ...original, scope: { ...original.scope, seasonId: ids.property } }, makeApi()), /seasonId conflicts/);
});
test('rejects zero matches', async () => {
  const api = makeApi(); api.orchards = async () => page([]);
  await assert.rejects(resolveE2e07Identity(original, api), /found 0 matches/);
});
test('rejects ambiguous matches, even with different Orchard IDs', async () => {
  const api = makeApi(); api.orchards = async () => page([
    { OrchardId: ids.orchard, OrchardPropertyId: ids.property, OrchardPin: '4382', CropId: ids.crop },
    { OrchardId: ids.country, OrchardPropertyId: ids.property, OrchardPin: '4382', CropId: ids.crop }
  ]);
  await assert.rejects(resolveE2e07Identity(original, api), /found 2 matches/);
});
test('rejects incorrect country in parent Property', async () => {
  const api = makeApi(); api.property = async () => ({ CountryId: ids.crop });
  await assert.rejects(resolveE2e07Identity(original, api), /found 0 matches/);
});
test('rejects real Orchard without test ownership marker', async () => {
  const api = makeApi(); api.orchard = async () => ({ OrchardId: ids.orchard, OrchardPin: '4382', CropId: ids.crop, OrchardName: 'Regular Orchard' });
  await assert.rejects(resolveE2e07Identity(original, api), /not proven to be test-owned/);
});
test('rejects inconsistent effective date rather than inferring from year', async () => {
  await assert.rejects(resolveE2e07Identity({ ...original, scope: { ...original.scope, effectiveDate: '2026-07-01' } }, makeApi()), /within season definition/);
});
test('rejects incomplete paging', async () => {
  const api = makeApi(); api.orchards = async () => ({ Items: [], TotalCount: 2 });
  await assert.rejects(resolveE2e07Identity(original, api), /incomplete or inconsistent/);
});
test('rejects non-test endpoints and non-loopback TLS bypass', () => {
  assert.throws(() => createE2e07LookupApi({ baseUrl: 'https://example.com', headers: {} }), /Refusing lookup/);
  assert.throws(() => createE2e07LookupApi({ baseUrl: 'https://kinex.test', headers: {}, insecureLoopback: true }), /-k may only/);
  assert.doesNotThrow(() => createE2e07LookupApi({ baseUrl: 'https://localhost:7002', headers: {}, insecureLoopback: true }));
});

test('lookup API uses authenticated GET only and preserves expected page parameters', async () => {
  const { createServer } = await import('node:http');
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, key: req.headers['x-kinex-api-key'] });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ items: [{ cropId: ids.crop, cropCode: 'KIWIFRUIT' }], totalCount: 1 }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const api = createE2e07LookupApi({ baseUrl: `http://127.0.0.1:${port}`, headers: { 'X-KineX-Api-Key': 'test-key' } });
    const response = await api.crops(1, 100);
    assert.equal(response.totalCount, 1);
    assert.deepEqual(requests, [{ method: 'GET', url: '/v1/masterdata/crops?page=1&pageSize=100', key: 'test-key' }]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('refuses to overwrite an already resolved config', async () => {
  const { saveResolvedConfig } = await import('../src/lib/e2e07-identity-lookup.mjs');
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'e2e07-lookup-test-'));
  try {
    const output = join(root, 'resolved.json');
    await saveResolvedConfig(output, { testOwner: { orchardId: ids.orchard } });
    await assert.rejects(saveResolvedConfig(output, { testOwner: { orchardId: ids.property } }), { code: 'EEXIST' });
    const contents = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(contents.testOwner.orchardId, ids.orchard);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('treats zero UUID placeholders as missing when resolving IDs', async () => {
  const config = structuredClone(original);
  config.testOwner.orchardId = '00000000-0000-0000-0000-000000000000';
  config.scope.seasonId = '00000000-0000-0000-0000-000000000000';
  const found = await resolveE2e07Identity(config, makeApi());
  assert.equal(found.config.testOwner.orchardId, ids.orchard);
  assert.equal(found.config.scope.seasonId, ids.season);
});

test('recognizes shipped placeholder owner and season fields but not arbitrary mismatched assertions', async () => {
  const config = structuredClone(original);
  config.testOwner.orchardId = 'REPLACE_WITH_TEST_ORCHARD_UUID';
  config.testOwner.name = 'KINEX-E2E PIN3025 Orchard';
  config.scope.seasonId = 'REPLACE_WITH_SEASON_UUID';
  const result = await resolveE2e07Identity(config, makeApi());
  assert.equal(result.config.testOwner.name, 'UG PIN3025 E2E RUN7');
  assert.equal(result.config.testOwner.orchardId, ids.orchard);
  assert.equal(result.config.scope.seasonId, ids.season);
  config.testOwner.name = 'KINEX-E2E Other Orchard';
  await assert.rejects(resolveE2e07Identity(config, makeApi()), /name conflicts/);
  config.testOwner.name = 'KINEX-E2E PIN3025 Orchard';
  config.testOwner.orchardId = 'NOT_A_UUID';
  await assert.rejects(resolveE2e07Identity(config, makeApi()), /orchardId conflicts/);
});

test('accepts a normal existing Orchard only with explicit loopback test-data opt-in', async () => {
  const cfg = { ...original, apiBaseUrl: 'https://localhost:7002' };
  const api = makeApi();
  api.orchard = async () => ({ OrchardId: ids.orchard, OrchardPin: '4382', CropId: ids.crop, OrchardName: 'Vercoe No 3 Orchard' });
  await assert.rejects(resolveE2e07Identity(cfg, api), /not proven to be test-owned/);
  const result = await resolveE2e07Identity(cfg, api, { allowExistingOrchard: true });
  assert.equal(result.config.testOwner.orchardId, ids.orchard);
  assert.equal(result.config.testOwner.name, 'Vercoe No 3 Orchard');
  assert.equal(result.config.scope.seasonId, ids.season);
  assert.equal(cfg.testOwner.name, undefined);
});

test('existing Orchard opt-in refuses non-loopback test API even though it is a test host', async () => {
  const cfg = { ...original, apiBaseUrl: 'https://kinex.test:7001' };
  await assert.rejects(resolveE2e07Identity(cfg, makeApi(), { allowExistingOrchard: true }), /permitted only for a loopback/);
});

test('existing Orchard opt-in still rejects conflicting ID and ambiguous PIN matches', async () => {
  const cfg = { ...original, apiBaseUrl: 'https://localhost:7002', testOwner: { orchardPin: '4382', orchardId: ids.property } };
  await assert.rejects(resolveE2e07Identity(cfg, makeApi(), { allowExistingOrchard: true }), /conflicts with lookup/);
  const api = makeApi();
  api.orchards = async () => page([
    { OrchardId: ids.orchard, OrchardPropertyId: ids.property, OrchardPin: '4382', CropId: ids.crop },
    { OrchardId: ids.country, OrchardPropertyId: ids.property, OrchardPin: '4382', CropId: ids.crop }
  ]);
  await assert.rejects(resolveE2e07Identity({ ...original, apiBaseUrl: 'https://localhost:7002' }, api, { allowExistingOrchard: true }), /found 2 matches/);
});
