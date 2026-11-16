import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import fs from 'node:fs/promises';
import path from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ZERO = '00000000-0000-0000-0000-000000000000';
const field = (o, n) => o?.[n] ?? o?.[n[0].toUpperCase() + n.slice(1)];
const low = v => String(v ?? '').toLowerCase();
// Only known shipped example values are placeholders; reject arbitrary values.
const isTemplateId = (value, kind) => value === `REPLACE_WITH_${kind}_UUID`;
const isTemplateName = name => name === 'KINEX-E2E PIN3025 Orchard';

function mustUuid(v, label) {
  if (!UUID.test(String(v ?? '')) || low(v) === ZERO) throw new Error(`${label} must be a nonzero UUID.`);
}
function mustDate(s, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s ?? '') || !Number.isFinite(Date.parse(`${s}T00:00:00Z`)) || new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) !== s) {
    throw new Error(`${label} must be an actual YYYY-MM-DD date.`);
  }
}
function unique(rows, label) {
  if (rows.length !== 1) throw new Error(`${label}: found ${rows.length} matches, expected exactly one. No changes made.`);
  return rows[0];
}
async function pages(fetchPage, label) {
  const rows = [];
  let expected;
  for (let page = 1; page <= 400; page++) {
    const result = await fetchPage(page, 100);
    const items = field(result, 'items');
    const total = Number(field(result, 'totalCount'));
    if (!Array.isArray(items) || !Number.isSafeInteger(total) || total < 0 || total < items.length) {
      throw new Error(`${label}: paged result is malformed.`);
    }
    if (expected !== undefined && total !== expected) throw new Error(`${label}: total count changed while paging; retry safely.`);
    expected = total;
    rows.push(...items);
    if (rows.length === expected) return rows;
    if (rows.length > expected || items.length === 0) throw new Error(`${label}: incomplete or inconsistent paged response.`);
  }
  throw new Error(`${label}: exceeded page safety limit.`);
}
export function assertLocalExistingOrchardOptIn(config, allowExistingOrchard = false) {
  if (!allowExistingOrchard) return;
  const host = new URL(config?.apiBaseUrl ?? 'https://invalid.example').hostname.toLowerCase();
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error('--allow-existing-orchard is permitted only for a loopback KineX API (localhost or 127.0.0.1).');
  }
}

export function isFixtureOrchard(name) {
  return /^(?:[A-Za-z0-9_-]{1,20} PIN3025 E2E [A-Za-z0-9_-]+|KINEX-E2E(?:[ _-]|$))/i.test(name);
}

export async function resolveE2e07Identity(config, api, { allowExistingOrchard = false } = {}) {
  assertLocalExistingOrchardOptIn(config, allowExistingOrchard);
  const pin = config?.testOwner?.orchardPin;
  const scope = config?.scope;
  if (!/^[A-Za-z0-9]{4}$/.test(pin ?? '')) throw new Error('testOwner.orchardPin must be the saved four-character Orchard PIN, not a source PIN placeholder.');
  if (scope?.countryCode !== 'NZ' || scope?.cropCode !== 'KIWIFRUIT' || !/^20\d{2}$/.test(String(scope?.season ?? ''))) {
    throw new Error('This E2E-07 resolver currently supports NZ / KIWIFRUIT with a four-digit season code.');
  }
  mustDate(scope.effectiveDate, 'scope.effectiveDate');
  if (config.reversal?.effectiveDate) mustDate(config.reversal.effectiveDate, 'reversal.effectiveDate');
  const crop = unique((await pages(api.crops, 'Crops')).filter(v => low(field(v, 'cropCode')) === low(scope.cropCode)), `Crop ${scope.cropCode}`);
  const cropId = field(crop, 'cropId'); mustUuid(cropId, 'Resolved cropId');
  const season = unique((await pages(api.seasons, 'Seasons')).filter(v => String(field(v, 'seasonCode')) === String(scope.season)), `Season ${scope.season}`);
  const seasonId = field(season, 'seasonId'); mustUuid(seasonId, 'Resolved seasonId');
  const def = unique((await pages((page, size) => api.seasonDefinitions(seasonId, page, size), 'Season definitions'))
    .filter(v => low(field(v, 'cropId')) === low(cropId) && low(field(v, 'countryCode')) === low(scope.countryCode)
      && low(field(v, 'seasonId')) === low(seasonId)), `Season definition ${scope.season}/NZ/KIWIFRUIT`);
  const countryId = field(def, 'countryId'); mustUuid(countryId, 'Resolved countryId');
  const start = field(def, 'startDate'); const end = field(def, 'endDate');
  if (scope.effectiveDate < start || scope.effectiveDate > end || (config.reversal?.effectiveDate && (config.reversal.effectiveDate < start || config.reversal.effectiveDate > end))) {
    throw new Error(`Effective dates must be within season definition ${start} to ${end}.`);
  }
  const orchards = await pages((page, size) => api.orchards(scope.effectiveDate, page, size), 'Orchards');
  const matches = orchards.filter(v => String(field(v, 'orchardPin')).toUpperCase() === pin.toUpperCase() && low(field(v, 'cropId')) === low(cropId));
  const verified = [];
  for (const v of matches) {
    const propertyId = field(v, 'orchardPropertyId'); mustUuid(propertyId, 'Candidate Orchard property ID');
    const property = await api.property(propertyId, scope.effectiveDate);
    if (!property) throw new Error(`Orchard parent Property ${propertyId} unavailable; cannot establish country.`);
    if (low(field(property, 'countryId')) === low(countryId)) verified.push(v);
  }
  const orchard = unique(verified, `Orchard PIN ${pin}, ${scope.cropCode}, ${scope.season}, NZ`);
  const orchardId = field(orchard, 'orchardId'); mustUuid(orchardId, 'Resolved orchardId');
  const detail = await api.orchard(orchardId, scope.effectiveDate);
  if (!detail || low(field(detail, 'orchardId')) !== low(orchardId) || low(field(detail, 'cropId')) !== low(cropId)
      || low(field(detail, 'orchardPin')) !== low(pin)) throw new Error('Orchard detail does not match resolved identity.');
  const name = field(detail, 'orchardName');
  if (typeof name !== 'string' || name.trim().length === 0 || (!isFixtureOrchard(name) && !allowExistingOrchard)) {
    throw new Error(`Orchard '${String(name)}' is not proven to be test-owned. Use --allow-existing-orchard only for a disposable loopback KineX dataset. No changes made.`);
  }
  if (config.testOwner.orchardId && low(config.testOwner.orchardId) !== ZERO && !isTemplateId(config.testOwner.orchardId, 'TEST_ORCHARD') && low(config.testOwner.orchardId) !== low(orchardId)) throw new Error('Configured orchardId conflicts with lookup.');
  if (config.testOwner.name && !isTemplateName(config.testOwner.name) && config.testOwner.name !== name) throw new Error('Configured test Orchard name conflicts with lookup.');
  if (scope.seasonId && low(scope.seasonId) !== ZERO && !isTemplateId(scope.seasonId, 'SEASON') && low(scope.seasonId) !== low(seasonId)) throw new Error('Configured seasonId conflicts with season code.');
  return {
    resolved: { orchardId, orchardName: name, orchardPin: pin, cropId, seasonId, season: scope.season, countryId, countryCode: scope.countryCode },
    config: { ...config, testOwner: { ...config.testOwner, orchardId, name }, scope: { ...scope, seasonId } }
  };
}

export function createE2e07LookupApi({ baseUrl, headers, insecureLoopback = false }) {
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new Error('API URL must be an absolute origin without path, credentials or query.');
  }
  const host = base.hostname.toLowerCase();
  const loopback = host === 'localhost' || host === '127.0.0.1';
  if (!loopback && !host.endsWith('.test')) throw new Error('Refusing lookup outside localhost, 127.0.0.1 or *.test.');
  if (!loopback && base.protocol !== 'https:') throw new Error('Non-loopback lookup requires HTTPS.');
  if (insecureLoopback && (!loopback || base.protocol !== 'https:')) throw new Error('-k may only bypass HTTPS certificate validation for a loopback address.');
  const allowed = /^\/v1\/(?:masterdata\/(?:crops|seasons|season-definitions)|orchard\/(?:orchards|properties))(?:\/|$)/;
  const get = (endpoint) => new Promise((resolve, reject) => {
    const url = new URL(endpoint, base);
    if (url.origin !== base.origin || !allowed.test(url.pathname)) return reject(new Error('Lookup endpoint escaped allowed GET routes.'));
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: 'GET', headers: { Accept: 'application/json', ...headers }, timeout: 30000,
      ...(insecureLoopback ? { rejectUnauthorized: false } : {})
    }, response => {
      const chunks = []; let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 2_000_000) { response.destroy(new Error('Lookup response exceeded 2 MB.')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const content = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode === 404) return resolve(null);
        if (response.statusCode !== 200) return reject(new Error(`KineX GET ${url.pathname}: HTTP ${response.statusCode} ${content.slice(0, 200)}`));
        try { resolve(JSON.parse(content)); } catch { reject(new Error(`KineX GET ${url.pathname} returned invalid JSON.`)); }
      });
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('Lookup request timed out.')));
    request.on('error', reject);
    request.end();
  });
  const query = params => new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  return {
    crops: (page, pageSize) => get(`/v1/masterdata/crops?${query({ page, pageSize })}`),
    seasons: (page, pageSize) => get(`/v1/masterdata/seasons?${query({ page, pageSize })}`),
    seasonDefinitions: (seasonId, page, pageSize) => get(`/v1/masterdata/season-definitions?${query({ seasonId, page, pageSize })}`),
    orchards: (date, page, pageSize) => get(`/v1/orchard/orchards?${query({ asOfDate: date, page, pageSize })}`),
    property: (id, date) => get(`/v1/orchard/properties/${id}?${query({ asOfDate: date })}`),
    orchard: (id, date) => get(`/v1/orchard/orchards/${id}?${query({ asOfDate: date })}`)
  };
}

export async function saveResolvedConfig(output, resolvedConfig) {
  await fs.mkdir(path.dirname(output), { recursive: true });
  // Exclusive creation: never overwrite a prior resume configuration.
  const handle = await fs.open(output, 'wx', 0o600);
  try { await handle.writeFile(`${JSON.stringify(resolvedConfig, null, 2)}\n`); }
  finally { await handle.close(); }
}
