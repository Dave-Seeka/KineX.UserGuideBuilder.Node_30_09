import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPages, collectOrchardCandidates, createCandidateApi } from '../src/lib/e2e07-candidate-inventory.mjs';

const orchard = '01900000-0000-7000-8000-000000000001';
const block = '01900000-0000-7000-8000-000000000002';
const ma = '01900000-0000-7000-8000-000000000003';
const fixture = { api: {
  blocks: async () => ({ items: [{ orchardId: orchard, orchardBlockId: block, orchardBlockCode: 'B01', assignedMaturityAreaCode: 'MA01' }], totalCount: 1 }),
  maturityAreas: async () => ({ items: [{ orchardId: orchard, maturityAreaId: ma, maturityAreaCode: 'MA01', maturityAreaName: 'Test', isActive: true }], totalCount: 1 })
}, orchardId: orchard, effectiveDate: '2027-06-01' };

test('read-only inventory lists persisted IDs without claiming GIS mapping', async () => {
  const result = await collectOrchardCandidates(fixture);
  assert.equal(result.noWrites, true);
  assert.equal(result.blocks[0].orchardBlockId, block);
  assert.match(result.blocks[0].geometryMapping, /not exposed/);
  assert.equal(result.maturityAreas[0].maturityAreaId, ma);
});

test('candidate API only makes scoped GET requests with auth and no writes', async () => {
  const calls = [];
  const api = createCandidateApi({ baseUrl: 'https://localhost:7002', headers: { 'X-KineX-Api-Key': 'placeholder' }, fetchImpl: async (url, opts) => {
    calls.push({ url: String(url), opts });
    return { ok: true, text: async () => JSON.stringify({ items: [], totalCount: 0 }) };
  } });
  await api.blocks(orchard, '2027-06-01', 1, 100);
  await api.maturityAreas(orchard, '2027-06-01', 1, 100);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(c => c.opts.method === 'GET' && c.opts.redirect === 'error'));
  assert.ok(calls.every(c => c.url.includes(`orchardId=${orchard}`)));
});

test('rejects candidate rows returned for another Orchard', async () => {
  await assert.rejects(collectOrchardCandidates({ ...fixture, api: { ...fixture.api, blocks: async () => ({ items: [{ orchardId: ma, orchardBlockId: block }], totalCount: 1 }) } }), /another Orchard/);
});

test('pagination refuses inconsistent counts', async () => {
  await assert.rejects(collectPages(async page => ({ items: [{ id: page }], totalCount: page === 1 ? 2 : 3 }), 'Blocks'), /changed while paging/);
});

test('pagination handles empty results', async () => {
  assert.deepEqual(await collectPages(async () => ({ items: [], totalCount: 0 }), 'MAs'), []);
});

test('duplicate block identity is rejected', async () => {
  await assert.rejects(collectOrchardCandidates({ ...fixture, api: { ...fixture.api, blocks: async () => ({ items: [{ orchardId: orchard, orchardBlockId: block }, { orchardId: orchard, orchardBlockId: block }], totalCount: 2 }) } }), /Duplicate Block/);
});
