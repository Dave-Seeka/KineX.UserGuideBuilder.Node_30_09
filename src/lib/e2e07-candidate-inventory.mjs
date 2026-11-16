/** Read-only E2E-07 Block/MA candidate inventory. This module never selects mutation targets. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ZERO = '00000000-0000-0000-0000-000000000000';
const field = (row, key) => row?.[key] ?? row?.[`${key[0].toUpperCase()}${key.slice(1)}`];
const lower = value => String(value ?? '').toLowerCase();

function requireId(id, label) {
  if (!UUID.test(id ?? '') || lower(id) === ZERO) throw new Error(`${label} must be a nonzero UUID.`);
}

export async function collectPages(fetchPage, label) {
  let expected = null;
  const rows = [];
  for (let page = 1; page <= 400; page++) {
    const response = await fetchPage(page, 100);
    const items = field(response, 'items');
    const total = field(response, 'totalCount');
    if (!Array.isArray(items) || !Number.isSafeInteger(total) || total < 0 || total < items.length) {
      throw new Error(`${label} returned an invalid paged response.`);
    }
    if (expected !== null && total !== expected) throw new Error(`${label} changed while paging. Retry read-only discovery.`);
    expected = total;
    rows.push(...items);
    if (rows.length === expected) return rows;
    if (rows.length > expected || items.length === 0) throw new Error(`${label} returned inconsistent paging.`);
  }
  throw new Error(`${label} exceeded the 400-page safety limit.`);
}

export async function collectOrchardCandidates({ api, orchardId, effectiveDate }) {
  requireId(orchardId, 'Resolved orchardId');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate ?? '') || Number.isNaN(Date.parse(`${effectiveDate}T00:00:00Z`))) {
    throw new Error('scope.effectiveDate must be an ISO date.');
  }
  const blocks = await collectPages((page, pageSize) => api.blocks(orchardId, effectiveDate, page, pageSize), 'Blocks');
  const maturityAreas = await collectPages((page, pageSize) => api.maturityAreas(orchardId, effectiveDate, page, pageSize), 'Maturity Areas');
  for (const [rows, idKey, label] of [[blocks, 'orchardBlockId', 'Block'], [maturityAreas, 'maturityAreaId', 'MA']]) {
    const ids = new Set();
    for (const row of rows) {
      const id = field(row, idKey);
      requireId(id, `${label} ID`);
      if (lower(field(row, 'orchardId')) !== lower(orchardId)) throw new Error(`${label} ${id} belongs to another Orchard. Refusing inventory.`);
      if (ids.has(lower(id))) throw new Error(`Duplicate ${label} ${id} in paged result.`);
      ids.add(lower(id));
    }
  }
  return {
    noWrites: true,
    orchardId,
    asOfDate: effectiveDate,
    blocks: blocks.map(row => ({
      orchardBlockId: field(row, 'orchardBlockId'),
      blockCode: field(row, 'orchardBlockCode'),
      blockName: field(row, 'orchardBlockName'),
      productionStatusCode: field(row, 'productionStatusCode') ?? null,
      assignedMaturityAreaCode: field(row, 'assignedMaturityAreaCode') ?? null,
      geometryMapping: 'not exposed by Block list; confirm from KineX ArcGIS'
    })),
    maturityAreas: maturityAreas.map(row => ({
      maturityAreaId: field(row, 'maturityAreaId'),
      code: field(row, 'maturityAreaCode'),
      name: field(row, 'maturityAreaName'),
      isActive: field(row, 'isActive')
    })),
    next: 'Select a Block after verifying eligibility; Split Pick needs a different Block with verified unmapped geometry. Do not use an MA assignment as proof of ArcGIS geometry.'
  };
}

export function createCandidateApi({ baseUrl, headers, fetchImpl = fetch }) {
  const base = new URL(baseUrl);
  if (!['localhost','127.0.0.1'].includes(base.hostname) && !base.hostname.endsWith('.test')) throw new Error('Candidate discovery only supports test API targets.');
  if (base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('API URL must be an origin without credentials or path.');
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost','127.0.0.1'].includes(base.hostname))) throw new Error('Nonlocal candidate discovery requires HTTPS.');
  const get = async (segment, orchardId, date, page, pageSize) => {
    requireId(orchardId, 'Resolved orchardId');
    const query = new URLSearchParams({ orchardId, asOfDate: date, page: String(page), pageSize: String(pageSize) });
    const url = new URL(`/v1/orchard/${segment}?${query}`, base);
    const response = await fetchImpl(url, {
      method: 'GET', headers: { Accept: 'application/json', ...headers },
      redirect: 'error', signal: AbortSignal.timeout(30000)
    });
    const content = await response.text();
    if (!response.ok) throw new Error(`KineX GET /v1/orchard/${segment}: HTTP ${response.status}; check read permissions.`);
    try { return JSON.parse(content); }
    catch { throw new Error(`KineX GET /v1/orchard/${segment} returned invalid JSON.`); }
  };
  return {
    blocks: (id, date, page, size) => get('blocks', id, date, page, size),
    maturityAreas: (id, date, page, size) => get('maturity-areas', id, date, page, size)
  };
}
