import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createE2e07Api, runE2e07, strategyPayload, validateE2e07Config } from '../src/lib/e2e07-pick-runner.mjs';

const ids = {
  season: 'edc1adf0-155c-4b70-8dc3-fbf4bc5aa1d0',
  orchard: 'ca93e849-7487-42f4-9117-e0a5c3039d6c',
  mapped: '4b0612b8-197d-4ad4-8d9a-b260d7d3c9c1',
  unmapped: '977a3d3a-82a5-44ab-8c3e-edcd964960b3',
  pickSelect: '6ab827bb-d350-4871-bf66-5275b3ba72fd',
  pickSplit: '195723ec-5b7b-4b96-8b4b-5fef29b1bb12',
  ma1: 'e55b33bd-c952-4206-ac68-6d4b3e302ba6',
  ma2: '1a299170-fca2-4c7c-b19a-c0411f5152b9'
};
function config() { return {
  testRunId: 'KINEX-E2E-2027-test-01', apiBaseUrl: 'https://kinex.test:7001', approvedTestHost: 'kinex.test',
  testOwner: { name: 'KINEX-E2E PIN3025 Orchard', orchardPin: '3025', orchardId: ids.orchard },
  scope: { countryCode: 'NZ', cropCode: 'KIWIFRUIT', season: '2027', seasonId: ids.season, effectiveDate: '2027-07-01' },
  select: { orchardBlockId: ids.mapped, pickId: ids.pickSelect, lines: [
    { maturityAreaId: ids.ma1, estimatedYieldPercent: 50, sizingCode: 'B' },
    { maturityAreaId: ids.ma2, estimatedYieldPercent: 50, sizingCode: '3C' }] },
  split: { orchardBlockId: ids.unmapped, pickId: ids.pickSplit, unmappedGeometryConfirmed: true, lines: [
    { maturityAreaId: ids.ma1, percentOfBlock: 50 }, { maturityAreaId: ids.ma2, percentOfBlock: 50 }] },
  reversal: { effectiveDate: '2027-07-02', reason: 'E2E-07 verify append-only Select Pick reversal.' }
}; }
class FakeApi {
  async orchard(id) { return {orchardId: id, orchardName: 'KINEX-E2E PIN3025 Orchard', orchardPin: '3025'}; }
  async block(id) { return {orchardBlockId: id, orchardId: ids.orchard}; }
  async maturityArea(id) { return {maturityAreaId: id, orchardId: ids.orchard, isActive: true}; }
  constructor() { this.byID = new Map(); this.ops = new Map(); this.applies = []; this.reversals = []; this.failPostAfterCommit = false; }
  async byId(id) { return this.byID.get(id) ?? null; }
  async effective(blockId, seasonId, date) {
    const candidates = [...this.byID.values()].filter(x => x.orchardBlockId === blockId && x.seasonId === seasonId && x.effectiveDate <= date);
    return candidates.sort((a,b) => b.effectiveDate.localeCompare(a.effectiveDate))[0] ?? null;
  }
  async apply(kind, payload) {
    this.applies.push({ kind, payload });
    if (this.ops.has(payload.operationId)) return this.byID.get(this.ops.get(payload.operationId));
    const record = { ...payload, maturityAreaAllocationStrategyId: kind === 'select' ? ids.pickSelect : ids.pickSplit, isReversal: false, lines: payload.lines };
    this.byID.set(record.maturityAreaAllocationStrategyId, record);
    this.ops.set(payload.operationId, record.maturityAreaAllocationStrategyId);
    if (this.failPostAfterCommit) { this.failPostAfterCommit = false; throw new Error('Connection dropped after commit'); }
    return record;
  }
  async reverse(id, payload) {
    this.reversals.push({ id, payload });
    if (this.ops.has(payload.operationId)) return this.byID.get(this.ops.get(payload.operationId));
    const previous = this.byID.get(id);
    const record = { ...previous, ...payload, maturityAreaAllocationStrategyId: ids.ma1, isReversal: true,
      reversesMaturityAreaAllocationStrategyId: id, lines: [] };
    this.byID.set(record.maturityAreaAllocationStrategyId, record);
    this.ops.set(payload.operationId, record.maturityAreaAllocationStrategyId);
    return record;
  }
}
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'e2e07-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return { config: config(), stateFile: path.join(dir, 'state.json'), api: new FakeApi(), log: () => {} };
}

test('requires test-owned run, valid season, separate mapped and unmapped Blocks', () => {
  assert.equal(validateE2e07Config(config()).testRunId, config().testRunId);
  const wrongHost = config(); wrongHost.apiBaseUrl = 'https://kinex.seeka.co.nz'; wrongHost.approvedTestHost = 'kinex.seeka.co.nz';
  assert.throws(() => validateE2e07Config(wrongHost), /refuses non-test hosts/);
  const duplicate = config(); duplicate.split.orchardBlockId = duplicate.select.orchardBlockId;
  assert.throws(() => validateE2e07Config(duplicate), /distinct Blocks/);
  const mapped = config(); mapped.split.unmappedGeometryConfirmed = false;
  assert.throws(() => validateE2e07Config(mapped), /unmapped test Block/);
  const invalid = config(); invalid.select.lines[1].estimatedYieldPercent = 45;
  assert.throws(() => validateE2e07Config(invalid), /total 100/);
  const wrongSeason = config(); wrongSeason.scope.effectiveDate = '2026-07-01';
  assert.throws(() => validateE2e07Config(wrongSeason), /selected year/);
});

test('plan has no network and mutation requires --apply', async (t) => {
  const f = await fixture(t);
  const plan = await runE2e07({ ...f, stage: 'plan' });
  assert.equal(plan.noWrites, true);
  await assert.rejects(runE2e07({ ...f, stage: 'select' }), /--apply/);
});

test('select/split/reverse append and verify their own independent persisted records', async (t) => {
  const f = await fixture(t);
  await runE2e07({ ...f, stage: 'preflight' });
  await runE2e07({ ...f, stage: 'all', apply: true });
  const state = JSON.parse(await fs.readFile(f.stateFile, 'utf8'));
  assert.deepEqual(Object.keys(state.stages), ['select', 'split', 'reverse']);
  assert.ok(Object.values(state.stages).every(x => x.status === 'applied'));
  assert.equal(f.api.applies.length, 2);
  assert.equal(f.api.reversals.length, 1);
  assert.equal(f.api.reversals[0].id, state.stages.select.strategyId);
  assert.ok(state.stages.reverse.operationId);
  await runE2e07({ ...f, stage: 'verify' });
  await runE2e07({ ...f, stage: 'all', apply: true });
  assert.equal(f.api.applies.length, 2);
  assert.equal(f.api.reversals.length, 1);
});

test('read-back mismatch fails instead of recording an applied stage', async (t) => {
  const f = await fixture(t);
  f.api.apply = async (kind, payload) => ({ ...payload, maturityAreaAllocationStrategyId: ids.pickSelect, lines: [{...payload.lines[0], estimatedYieldPercent: 70}] });
  await assert.rejects(runE2e07({ ...f, stage: 'select', apply: true }), /persisted API strategy mismatch/);
  const state = JSON.parse(await fs.readFile(f.stateFile, 'utf8'));
  assert.equal(state.stages.select.status, 'pending');
});

test('retry after lost POST response reuses the exact operation ID without creating a second Pick', async (t) => {
  const f = await fixture(t); f.api.failPostAfterCommit = true;
  await assert.rejects(runE2e07({ ...f, stage: 'select', apply: true }), /Connection dropped/);
  await runE2e07({ ...f, stage: 'select', apply: true });
  assert.equal(f.api.applies.length, 2);
  assert.equal(f.api.applies[0].payload.operationId, f.api.applies[1].payload.operationId);
  assert.equal(f.api.byID.size, 1);
});

test('retry pending reversal after remote commit uses same operationId', async (t) => {
  const f = await fixture(t);
  await runE2e07({ ...f, stage: 'select', apply: true });
  const original = f.api.reverse.bind(f.api);
  let lost = true;
  f.api.reverse = async (...args) => { const result = await original(...args); if (lost) { lost = false; throw new Error('lost reversal response'); } return result; };
  await assert.rejects(runE2e07({ ...f, stage: 'reverse', apply: true }), /lost reversal response/);
  await runE2e07({ ...f, stage: 'reverse', apply: true });
  assert.equal(f.api.reversals.length, 2);
  assert.equal(f.api.reversals[0].payload.operationId, f.api.reversals[1].payload.operationId);
  assert.equal(f.api.byID.size, 2);
});

test('refuses to overwrite an unrelated existing effective Pick on the same block', async (t) => {
  const f = await fixture(t);
  f.api.byID.set(ids.pickSelect, { ...strategyPayload(f.config, 'select', ids.ma2), maturityAreaAllocationStrategyId: ids.pickSelect });
  await assert.rejects(runE2e07({ ...f, stage: 'preflight' }), /existing effective Pick/);
  await assert.rejects(runE2e07({ ...f, stage: 'select', apply: true }), /existing strategy found/);
  assert.equal(f.api.applies.length, 0);
});

test('same state cannot be reused with different IDs', async (t) => {
  const f = await fixture(t);
  await runE2e07({ ...f, stage: 'select', apply: true });
  const changed = structuredClone(f.config); changed.reversal.reason += ' changed';
  await assert.rejects(runE2e07({ ...f, config: changed, stage: 'verify' }), /configuration changed/);
});

test('HTTP API uses real KineX paths and treats only GET 404 as empty', async () => {
  const seen = [];
  const api = createE2e07Api('https://kinex.test:7001', { 'X-KineX-Api-Key': 'secret' }, async (url, options) => {
    seen.push({url: String(url), method: options.method, header: options.headers['X-KineX-Api-Key']});
    return { status: 404, ok: false, text: async () => '{}' };
  });
  assert.equal(await api.effective(ids.mapped, ids.season, '2027-07-01'), null);
  assert.match(seen[0].url, /v1\/orchard\/maturity-area-allocation-strategies\/effective\?/);
  assert.equal(seen[0].method, 'GET');
  await assert.rejects(api.apply('select', {}), /HTTP 404/);
});

test('fails preflight when Block or MA belongs to a different Orchard', async (t) => {
  const f = await fixture(t);
  f.api.block = async id => ({orchardBlockId: id, orchardId: ids.ma1});
  await assert.rejects(runE2e07({ ...f, stage: 'select', apply: true }), /does not belong to the test-owned Orchard/);
  assert.equal(f.api.applies.length, 0);
  f.api.block = async id => ({orchardBlockId: id, orchardId: ids.orchard});
  f.api.maturityArea = async id => ({maturityAreaId: id, orchardId: ids.ma2, isActive: true});
  await assert.rejects(runE2e07({ ...f, stage: 'split', apply: true }), /does not belong to the test-owned Orchard/);
  assert.equal(f.api.applies.length, 0);
});

test('plan can inspect the shipped placeholder template without credentials or writes', async () => {
  const template = JSON.parse(await fs.readFile(new URL('../scenarios/e2e07-picks.example.json', import.meta.url), 'utf8'));
  const result = await runE2e07({ config: template, stage: 'plan', stateFile: 'output/example.json' });
  assert.equal(result.ready, false);
  assert.match(result.blocker, /UUID/);
  assert.equal(result.noWrites, true);
});

test('preflight accepts genuine UG PIN3025 E2E fixture name, but rejects ordinary Orchard names', () => {
  const fixture = config();
  fixture.testOwner.name = 'UG PIN3025 E2E RUN7';
  assert.equal(validateE2e07Config(fixture).testOwner.name, fixture.testOwner.name);
  fixture.testOwner.name = 'Real Orchard';
  assert.throws(() => validateE2e07Config(fixture), /run-owned E2E Orchard/);
});

test('loopback disposable test data permits existing Orchard, but not without opt-in', async t => {
  const f = await fixture(t);
  f.config.apiBaseUrl = 'https://localhost:7002';
  f.config.approvedTestHost = 'localhost';
  f.config.testOwner.name = 'Vercoe No 3 Orchard';
  f.api.orchard = async id => ({ orchardId: id, orchardName: 'Vercoe No 3 Orchard', orchardPin: '3025' });
  assert.throws(() => validateE2e07Config(f.config), /run-owned E2E Orchard/);
  assert.equal(validateE2e07Config(f.config, { allowExistingOrchard: true }).testOwner.name, 'Vercoe No 3 Orchard');
  await assert.rejects(runE2e07({ ...f, stage: 'preflight' }), /run-owned E2E Orchard/);
  await runE2e07({ ...f, stage: 'preflight', allowExistingOrchard: true });
  assert.equal(f.api.applies.length, 0);
  await assert.rejects(runE2e07({ ...f, stage: 'select', allowExistingOrchard: true }), /--apply/);
  f.api.block = async id => ({ orchardBlockId: id, orchardId: ids.ma1 });
  await assert.rejects(runE2e07({ ...f, stage: 'select', allowExistingOrchard: true, apply: true }), /does not belong to the test-owned Orchard/);
  assert.equal(f.api.applies.length, 0);
});

test('existing Orchard override is rejected on non-loopback API targets', () => {
  const c = config();
  c.testOwner.name = 'Vercoe No 3 Orchard';
  assert.throws(() => validateE2e07Config(c, { allowExistingOrchard: true }), /permitted only for a loopback/);
});
