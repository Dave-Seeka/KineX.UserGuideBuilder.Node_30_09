import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { assertLocalExistingOrchardOptIn, isFixtureOrchard } from './e2e07-identity-lookup.mjs';

const PREFIX = '/v1/orchard/maturity-area-allocation-strategies';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMPTY_ID = '00000000-0000-0000-0000-000000000000';
const stages = new Set(['plan', 'preflight', 'select', 'split', 'reverse', 'verify', 'all']);
const field = (obj, name) => obj?.[name] ?? obj?.[name.charAt(0).toUpperCase() + name.slice(1)];
const lower = value => String(value ?? '').toLowerCase();

function requireUuid(value, label) {
  if (!UUID.test(value ?? '') || lower(value) === EMPTY_ID) throw new Error(`${label} must be a nonzero UUID.`);
}
function isoDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '') || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${label} must be an ISO date (YYYY-MM-DD).`);
  }
  if (new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error(`${label} is not a valid calendar date.`);
}
function assertPercentLines(lines, kind) {
  if (!Array.isArray(lines) || lines.length !== 2) throw new Error(`${kind}.lines needs exactly two allocations.`);
  const ids = new Set();
  let total = 0;
  for (const [i, line] of lines.entries()) {
    requireUuid(line.maturityAreaId, `${kind}.lines[${i}].maturityAreaId`);
    if (ids.has(lower(line.maturityAreaId))) throw new Error(`${kind} cannot allocate twice to one MA.`);
    ids.add(lower(line.maturityAreaId));
    const percent = kind === 'select' ? line.estimatedYieldPercent : line.percentOfBlock;
    if (typeof percent !== 'number' || percent <= 0 || percent > 100) throw new Error(`${kind}.lines[${i}] needs a percentage from 0 to 100.`);
    if (kind === 'select' && !/^[A-Za-z0-9]{1,12}$/.test(line.sizingCode ?? '')) {
      throw new Error('Select Pick requires an explicit sizing code for each allocation.');
    }
    if (kind === 'split' && (line.sizingCode != null || line.estimatedYieldPercent != null)) {
      throw new Error('Split Pick must not specify sizing or estimated-yield percentages.');
    }
    if (kind === 'select' && line.percentOfBlock != null) throw new Error('Select Pick must not specify spatial Block percentages.');
    total += percent;
  }
  if (Math.abs(total - 100) > 0.0001) throw new Error(`${kind} percentages must total 100%; got ${total}.`);
  return ids;
}

export function validateE2e07Config(config, { allowExistingOrchard = false } = {}) {
  if (!config || typeof config !== 'object') throw new Error('E2E-07 needs a configuration object.');
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{3,60}$/.test(config.testRunId ?? '')) throw new Error('Specify a stable, nonblank testRunId (reuse it when resuming).');
  const base = new URL(config.apiBaseUrl ?? 'https://invalid.example');
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new Error('apiBaseUrl must be an absolute API origin without credentials, path or query.');
  }
  const host = base.hostname.toLowerCase();
  if (lower(config.approvedTestHost) !== host || !(host === 'localhost' || host === '127.0.0.1' || host.endsWith('.test'))) {
    throw new Error('E2E-07 refuses non-test hosts. approvedTestHost must exactly match a localhost or *.test API hostname.');
  }
  if (base.protocol !== 'https:' && host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error('Nonlocal test APIs require HTTPS.');
  }
  assertLocalExistingOrchardOptIn(config, allowExistingOrchard);
  const owner = config.testOwner;
  requireUuid(owner?.orchardId, 'testOwner.orchardId');
  const namedOrchard = typeof owner?.name === 'string' && owner.name.trim().length > 0 && owner.name.length <= 200;
  if ((!allowExistingOrchard && !isFixtureOrchard(owner?.name)) || !namedOrchard
      || !/^[A-Za-z0-9]{4}$/.test(owner?.orchardPin ?? '')) {
    throw new Error('testOwner must identify a run-owned E2E Orchard with a four-character PIN (or use --allow-existing-orchard for a disposable loopback dataset).');
  }
  const { scope, select, split, reversal } = config;
  if (scope?.countryCode !== 'NZ' || scope?.cropCode !== 'KIWIFRUIT') throw new Error('E2E-07 is currently scoped to NZ/KIWIFRUIT test data.');
  requireUuid(scope?.seasonId, 'scope.seasonId');
  isoDate(scope?.effectiveDate, 'scope.effectiveDate');
  if (typeof scope?.season !== 'string' || !/^20\d{2}$/.test(scope.season) || !scope.effectiveDate.startsWith(scope.season)) {
    throw new Error('E2E-07 effectiveDate must fall in the selected year/season.');
  }
  for (const kind of ['select', 'split']) {
    const item = config[kind];
    requireUuid(item?.orchardBlockId, `${kind}.orchardBlockId`);
    requireUuid(item?.pickId, `${kind}.pickId`);
    assertPercentLines(item?.lines, kind);
  }
  if (lower(select.orchardBlockId) === lower(split.orchardBlockId)) throw new Error('Split and Select Pick must use distinct Blocks.');
  if (lower(select.pickId) === lower(split.pickId)) throw new Error('Use distinct run-owned Pick IDs for independent stages.');
  if (split.unmappedGeometryConfirmed !== true) throw new Error('Split Pick requires an explicitly confirmed unmapped test Block. Never reuse a PIN 3025 mapped Block.');
  const maIds = [...select.lines, ...split.lines].map(l => lower(l.maturityAreaId));
  if (new Set(maIds).size !== 2) throw new Error('Both stages must target the same two test-owned eligible MAs.');
  isoDate(reversal?.effectiveDate, 'reversal.effectiveDate');
  if (reversal.effectiveDate < scope.effectiveDate || !reversal.effectiveDate.startsWith(scope.season)) {
    throw new Error('Reversal must be on/after Select Pick, within the chosen season.');
  }
  if (typeof reversal.reason !== 'string' || reversal.reason.trim().length < 10 || reversal.reason.length > 2000) {
    throw new Error('Provide an explicit 10–2000 character Select Pick reversal reason.');
  }
  return config;
}

export function fingerprint(config) {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex');
}
export function strategyPayload(config, kind, operationId) {
  const item = config[kind];
  return {
    orchardBlockId: item.orchardBlockId,
    operationId,
    seasonId: config.scope.seasonId,
    pickId: item.pickId,
    effectiveDate: config.scope.effectiveDate,
    strategyType: kind === 'select' ? 2 : 1, // KineX API enum: Split=1, Select=2
    comments: `KINEX-E2E07 ${config.testRunId} ${kind}`,
    lines: item.lines.map(l => kind === 'select'
      ? { maturityAreaId: l.maturityAreaId, estimatedYieldPercent: l.estimatedYieldPercent, sizingCode: l.sizingCode }
      : { maturityAreaId: l.maturityAreaId, percentOfBlock: l.percentOfBlock })
  };
}
function validateStrategyRead(dto, config, kind, expectedId = null) {
  if (!dto || typeof dto !== 'object') throw new Error(`${kind}: API returned no strategy.`);
  const item = config[kind];
  const id = field(dto, 'maturityAreaAllocationStrategyId');
  requireUuid(id, `${kind}.strategyId`);
  const mismatches = [];
  if (expectedId && lower(id) !== lower(expectedId)) mismatches.push('strategyId');
  if (lower(field(dto, 'orchardBlockId')) !== lower(item.orchardBlockId)) mismatches.push('orchardBlockId');
  if (lower(field(dto, 'seasonId')) !== lower(config.scope.seasonId)) mismatches.push('seasonId');
  if (lower(field(dto, 'pickId')) !== lower(item.pickId)) mismatches.push('pickId');
  if (String(field(dto, 'effectiveDate')) !== config.scope.effectiveDate) mismatches.push('effectiveDate');
  const type = field(dto, 'strategyType');
  if (![kind === 'select' ? 2 : 1, kind === 'select' ? 'Select' : 'Split'].some(t => String(t).toLowerCase() === String(type).toLowerCase())) mismatches.push('strategyType');
  if (field(dto, 'isReversal') === true) mismatches.push('isReversal');
  const byMa = new Map((field(dto, 'lines') ?? []).map(l => [lower(field(l, 'maturityAreaId')), l]));
  if (byMa.size !== 2) mismatches.push('lines.count');
  for (const line of item.lines) {
    const actual = byMa.get(lower(line.maturityAreaId));
    const key = kind === 'select' ? 'estimatedYieldPercent' : 'percentOfBlock';
    if (!actual || Math.abs(Number(field(actual, key)) - Number(line[key])) > 0.0001) mismatches.push(`${line.maturityAreaId}.${key}`);
    if (kind === 'select' && lower(field(actual, 'sizingCode')) !== lower(line.sizingCode)) mismatches.push(`${line.maturityAreaId}.sizingCode`);
  }
  if (mismatches.length) throw new Error(`${kind}: persisted API strategy mismatch: ${mismatches.join(', ')}`);
  return id;
}
function validateReversalRead(dto, config, selectId, reversalId = null) {
  const id = field(dto, 'maturityAreaAllocationStrategyId');
  requireUuid(id, 'reversal.strategyId');
  if (reversalId && lower(id) !== lower(reversalId)) throw new Error('Reversal read-back ID mismatch.');
  if (field(dto, 'isReversal') !== true || lower(field(dto, 'reversesMaturityAreaAllocationStrategyId')) !== lower(selectId)) {
    throw new Error('Effective revision is not a reversal of this run-owned Select Pick.');
  }
  if (lower(field(dto, 'orchardBlockId')) !== lower(config.select.orchardBlockId)
      || lower(field(dto, 'seasonId')) !== lower(config.scope.seasonId)
      || lower(field(dto, 'pickId')) !== lower(config.select.pickId)
      || field(dto, 'effectiveDate') !== config.reversal.effectiveDate
      || (field(dto, 'lines') ?? []).length !== 0) {
    throw new Error('Reversal persisted identity, date or empty-lines invariant failed.');
  }
  return id;
}

async function writeState(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
}
async function loadState(file, config) {
  let state;
  try { state = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (state && (state.version !== 1 || state.testRunId !== config.testRunId || state.fingerprint !== fingerprint(config))) {
    throw new Error('Existing state belongs to another test run or the configuration changed. Never reuse it for different records.');
  }
  return state ?? { version: 1, testRunId: config.testRunId, fingerprint: fingerprint(config), stages: {} };
}

export function createE2e07Api(base, headers, fetchImpl = fetch) {
  const origin = new URL(base);
  const request = async (method, endpoint, payload) => {
    const url = new URL(endpoint, origin);
    if (url.origin !== origin.origin || !/^\/v1\/orchard\/(maturity-area-allocation-strategies|orchards|blocks|maturity-areas)(\/|$)/.test(url.pathname)) throw new Error('E2E-07 API request escaped the configured Orchard endpoints.');
    let response;
    try {
      response = await fetchImpl(url, { method, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Accept: 'application/json', ...headers, ...(payload ? { 'Content-Type': 'application/json' } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
    } catch (error) {
      // Node fetch normally reports only 'fetch failed'. Include the actual
      // transport cause without logging credentials, request headers or query.
      const cause = error?.cause?.errors?.[0] ?? error?.cause ?? error;
      const code = typeof cause?.code === 'string' ? cause.code : cause?.name ?? 'NETWORK_ERROR';
      const detail = typeof cause?.message === 'string' ? cause.message : 'Connection could not be established.';
      throw new Error(`KineX API ${method} ${url.origin}${url.pathname} connection failed (${code}): ${detail}. Check the selected host/port and TLS trust; for a local HTTPS test certificate, use -k.`, { cause: error });
    }
    if (response.status === 404 && method === 'GET') return null;
    const body = await response.text();
    if (!response.ok) throw new Error(`KineX API ${method} ${url.pathname} HTTP ${response.status}: ${body.slice(0, 400)}`);
    try { return JSON.parse(body); } catch { throw new Error('KineX Pick API response was not JSON.'); }
  };
  return {
    probe: () => request('GET', '/v1/orchard/blocks?page=1&pageSize=1'),
    byId: (id) => request('GET', `${PREFIX}/${id}`),
    orchard: (id, date) => request('GET', `/v1/orchard/orchards/${id}?asOfDate=${date}`),
    block: (id, date) => request('GET', `/v1/orchard/blocks/${id}?asOfDate=${date}`),
    maturityArea: (id, date) => request('GET', `/v1/orchard/maturity-areas/${id}?asOfDate=${date}`),
    effective: (blockId, seasonId, date) => request('GET', `${PREFIX}/effective?${new URLSearchParams({ orchardBlockId: blockId, seasonId, effectiveAsOf: date })}`),
    apply: (kind, payload) => request('POST', `${PREFIX}/apply/${kind}-pick`, payload),
    reverse: (id, payload) => request('POST', `${PREFIX}/${id}/reverse/select-pick`, payload)
  };
}

export async function runE2e07({ config, stateFile, stage = 'plan', apply = false, api = null, log = console.log, allowExistingOrchard = false }) {
  if (!stages.has(stage)) throw new Error(`Unknown stage '${stage}'. Valid: ${[...stages].join(', ')}`);
  if (stage === 'plan') {
    // The shipped example deliberately contains placeholder IDs. Showing the
    // requirements must not demand real test data or network access.
    let ready = true;
    let blocker = null;
    try { validateE2e07Config(config, { allowExistingOrchard }); } catch (error) { ready = false; blocker = error.message; }
    return { planned: ['preflight', 'select', 'split', 'reverse', 'verify'],
      testRunId: config?.testRunId ?? null, apiHost: config?.approvedTestHost ?? null,
      stateFile, noWrites: true, ready, blocker };
  }
  validateE2e07Config(config, { allowExistingOrchard });
  if (['select','split','reverse','all'].includes(stage) && !apply) throw new Error('Mutating stages require explicit --apply.');
  if (!api) throw new Error('Authenticated KineX API access is required for this stage.');
  if (!stateFile) throw new Error('A durable --state file path is required.');
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  let lock;
  try { lock = await fs.open(`${stateFile}.lock`, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error(`E2E-07 state is locked: ${stateFile}. Resolve any active run before removing a stale lock.`); throw error; }
  try {
    const state = await loadState(stateFile, config);
    // Never trust a local label alone. Confirm all referenced Blocks and MAs
    // really belong to the recorded test Orchard before any mutation.
    const orchard = await api.orchard(config.testOwner.orchardId, config.scope.effectiveDate);
    if (!orchard || lower(field(orchard, 'orchardId')) !== lower(config.testOwner.orchardId)
        || String(field(orchard, 'orchardPin')) !== config.testOwner.orchardPin
        || String(field(orchard, 'orchardName')) !== config.testOwner.name) {
      throw new Error('E2E-07 Orchard ownership mismatch. Refusing to mutate records outside the exact test-owned Orchard.');
    }
    for (const kind of ['select', 'split']) {
      const block = await api.block(config[kind].orchardBlockId, config.scope.effectiveDate);
      if (!block || lower(field(block, 'orchardBlockId')) !== lower(config[kind].orchardBlockId)
          || lower(field(block, 'orchardId')) !== lower(config.testOwner.orchardId)) {
        throw new Error(`${kind}: Block is missing or does not belong to the test-owned Orchard.`);
      }
    }
    for (const id of new Set(config.select.lines.map(l => l.maturityAreaId))) {
      const ma = await api.maturityArea(id, config.scope.effectiveDate);
      if (!ma || lower(field(ma, 'maturityAreaId')) !== lower(id)
          || lower(field(ma, 'orchardId')) !== lower(config.testOwner.orchardId)
          || field(ma, 'isActive') !== true) {
        throw new Error(`MA ${id} is missing, inactive or does not belong to the test-owned Orchard.`);
      }
    }
    const save = async () => writeState(stateFile, state);
    const effective = async (kind, date = config.scope.effectiveDate) => api.effective(config[kind].orchardBlockId, config.scope.seasonId, date);
    const verifyApplied = async (kind) => {
      const record = state.stages[kind];
      if (!record || record.status !== 'applied') throw new Error(`${kind} has not been applied in this run.`);
      const persisted = await api.byId(record.strategyId);
      validateStrategyRead(persisted, config, kind, record.strategyId);
      const latest = await effective(kind, kind === 'select' && state.stages.reverse?.status === 'applied' ? config.reversal.effectiveDate : config.scope.effectiveDate);
      if (kind === 'select' && state.stages.reverse?.status === 'applied') validateReversalRead(latest, config, record.strategyId, state.stages.reverse.strategyId);
      else if (kind === 'select' && state.stages.reverse?.status === 'pending' && field(latest, 'isReversal') === true) {
        throw new Error('A pending reversal may have committed. Resume --stage reverse --apply with the saved operation ID before verifying.');
      } else validateStrategyRead(latest, config, kind, record.strategyId);
      return record.strategyId;
    };
    const verifyReverse = async () => {
      const record = state.stages.reverse;
      if (!record || record.status !== 'applied') throw new Error('Select Pick reversal has not been applied.');
      await verifyApplied('select');
      const persisted = await api.byId(record.strategyId);
      validateReversalRead(persisted, config, state.stages.select.strategyId, record.strategyId);
      return record.strategyId;
    };
    const preflight = async () => {
      for (const kind of ['select', 'split']) {
        const saved = state.stages[kind];
        if (saved?.status === 'applied') { await verifyApplied(kind); continue; }
        const existing = await effective(kind);
        if (existing && saved?.status !== 'pending') throw new Error(`${kind}: an existing effective Pick is present on this Block. Refusing to overwrite an untracked strategy.`);
        // Pending operation IDs are retained; KineX itself validates equivalent retry.
      }
      return true;
    };
    const applyPick = async (kind) => {
      if (state.stages[kind]?.status === 'applied') return verifyApplied(kind);
      if (!state.stages[kind]) {
        if (await effective(kind)) throw new Error(`${kind}: existing strategy found. Refusing to replace it.`);
        state.stages[kind] = { status: 'pending', operationId: randomUUID() };
        await save(); // Durable BEFORE the network request; safe idempotent replay.
      }
      const entry = state.stages[kind];
      const payload = strategyPayload(config, kind, entry.operationId);
      const result = await api.apply(kind, payload);
      const id = validateStrategyRead(result, config, kind);
      const persisted = await api.byId(id);
      validateStrategyRead(persisted, config, kind, id);
      const nowEffective = await effective(kind);
      validateStrategyRead(nowEffective, config, kind, id);
      entry.status = 'applied'; entry.strategyId = id;
      await save();
      log(`E2E-07 ${kind} Pick verified: ${id}`);
      return id;
    };
    const reverse = async () => {
      if (state.stages.select?.status !== 'applied') throw new Error('Apply Select Pick before attempting a reversal.');
      // A previous reversal POST may have committed while its HTTP response was lost.
      // Always verify original by ID, not as today's effective revision, before
      // replaying the identical stored OperationId.
      validateStrategyRead(await api.byId(state.stages.select.strategyId), config, 'select', state.stages.select.strategyId);
      if (state.stages.reverse?.status === 'applied') return verifyReverse();
      if (!state.stages.reverse) {
        const existing = await effective('select', config.reversal.effectiveDate);
        validateStrategyRead(existing, config, 'select', state.stages.select.strategyId);
        state.stages.reverse = { status: 'pending', operationId: randomUUID() };
        await save();
      }
      const entry = state.stages.reverse;
      const result = await api.reverse(state.stages.select.strategyId, {
        operationId: entry.operationId,
        effectiveDate: config.reversal.effectiveDate,
        reason: config.reversal.reason.trim()
      });
      const id = validateReversalRead(result, config, state.stages.select.strategyId);
      const persisted = await api.byId(id);
      validateReversalRead(persisted, config, state.stages.select.strategyId, id);
      const latest = await effective('select', config.reversal.effectiveDate);
      validateReversalRead(latest, config, state.stages.select.strategyId, id);
      entry.status = 'applied'; entry.strategyId = id;
      await save();
      log(`E2E-07 Select Pick reversed and verified: ${id}`);
      return id;
    };
    if (stage === 'preflight') await preflight();
    if (stage === 'select') await applyPick('select');
    if (stage === 'split') await applyPick('split');
    if (stage === 'reverse') await reverse();
    if (stage === 'all') { await preflight(); await applyPick('select'); await applyPick('split'); await reverse(); }
    if (stage === 'verify') {
      if (!Object.values(state.stages).some(s => s.status === 'applied')) throw new Error('There are no completed Pick stages in this run.');
      for (const kind of ['select', 'split']) if (state.stages[kind]?.status === 'applied') await verifyApplied(kind);
      if (state.stages.reverse?.status === 'applied') await verifyReverse();
    }
    return { stage, testRunId: config.testRunId, stages: structuredClone(state.stages), stateFile };
  } finally { await lock.close(); await fs.unlink(`${stateFile}.lock`).catch(() => {}); }
}
