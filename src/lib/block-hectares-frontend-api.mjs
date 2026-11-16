import { createLocalInsecureHttpsFetch } from './e2e07-local-https.mjs';
import { assert, assertDate, assertUuid, field, haUnits, isActiveLeafBlock } from './block-hectares-frontend-assertions.mjs';

function normalizeUrl(raw, insecure) {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  assert(url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password,
    'KineX API base URL must be an origin.');
  assert(['localhost','127.0.0.1'].includes(host) || host.endsWith('.test'), 'Only approved test API hosts are supported.');
  assert(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(host)),
    'Test API must use HTTPS unless it is loopback.');
  if (insecure) assert(url.protocol === 'https:' && ['localhost','127.0.0.1'].includes(host),
    '-k is permitted only for a loopback HTTPS API.');
  return url;
}
export function createHectareReadApi(baseUrl, { apiKey, bearer, insecureLoopback = false, transport = null } = {}) {
  const origin = normalizeUrl(baseUrl, insecureLoopback);
  assert(Boolean(apiKey) !== Boolean(bearer), 'Set exactly one of KINEX_E2E07_API_KEY or KINEX_E2E07_BEARER_TOKEN.');
  const request = transport ?? (insecureLoopback ? createLocalInsecureHttpsFetch(origin.origin + '/') : fetch);
  const headers = { Accept: 'application/json', ...(apiKey ? { 'X-KineX-Api-Key': apiKey } : { Authorization: `Bearer ${bearer}` }) };
  async function get(path, params = {}) {
    assert(/^\/v1\/(?:masterdata\/(?:crops|seasons|season-definitions)|orchard\/(?:orchards|properties|blocks|maturity-areas))(?:\/|\?|$)/.test(path),
      'Read API refused an unrecognised route.');
    const url = new URL(path, origin);
    for (const [k,v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    assert(url.origin === origin.origin, 'API read escaped its origin.');
    const result = await request(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!result.ok) throw new Error(`GET ${url.pathname} failed HTTP ${result.status}; no writes attempted.`);
    const body = await result.text();
    assert(body.length < 4_000_000, 'API GET response exceeded 4 MB.');
    return JSON.parse(body);
  }
  async function pages(path, params = {}) {
    const rows = []; let total = null;
    for (let page = 1; page <= 400; page++) {
      const response = await get(path, { ...params, page, pageSize: 100 });
      const items = field(response, 'items'); const count = field(response, 'totalCount');
      assert(Array.isArray(items) && Number.isSafeInteger(count) && count >= 0, `Invalid paging response for ${path}.`);
      if (total !== null) assert(total === count, `Paging changed during ${path} request.`);
      total = count;
      rows.push(...items);
      if (rows.length === total) return rows;
      assert(items.length && rows.length < total, `Incomplete paging for ${path}.`);
    }
    throw new Error(`Too many pages reading ${path}.`);
  }
  return {
    get, pages,
    block: (id, date) => { assertUuid(id,'block'); assertDate(date,'effective date'); return get(`/v1/orchard/blocks/${id}`, { asOfDate: date }); },
    area: (type,id,date) => { assert(['blocks','maturity-areas'].includes(type),'Invalid area type'); assertUuid(id,'area id'); assertDate(date,'effective date'); return get(`/v1/orchard/${type}/${id}/area`, { effectiveDate: date }); },
    blocks: (id,date) => pages('/v1/orchard/blocks',{orchardId:id,asOfDate:date}),
    maturityAreas: (id,date) => pages('/v1/orchard/maturity-areas',{orchardId:id,asOfDate:date})
  };
}
const one = (rows, description) => {assert(rows.length === 1, `Expected one ${description}, found ${rows.length}.`); return rows[0];};
const eq = (a,b) => String(a??'').toLowerCase() === String(b??'').toLowerCase();
export async function discoverBlackburn(api, scenario) {
  const date = scenario.asOfDate;
  const crop = one((await api.pages('/v1/masterdata/crops')).filter(x => eq(field(x,'cropCode'),scenario.cropCode)), 'crop');
  const season = one((await api.pages('/v1/masterdata/seasons')).filter(x => String(field(x,'seasonCode')) === scenario.season), 'season');
  const cropId=field(crop,'cropId'),seasonId=field(season,'seasonId');
  assertUuid(cropId,'cropId'); assertUuid(seasonId,'seasonId');
  const def = one((await api.pages('/v1/masterdata/season-definitions',{seasonId}))
    .filter(x => eq(field(x,'cropId'),cropId) && eq(field(x,'countryCode'),scenario.countryCode)), 'season definition');
  const start=String(field(def,'startDate')).slice(0,10), end=String(field(def,'endDate')).slice(0,10);
  assert(date>=start && scenario.splitDate<=end, `Dates ${date}..${scenario.splitDate} must be within season ${start}..${end}.`);
  const countryId=field(def,'countryId'); assertUuid(countryId,'countryId');
  const candidates=(await api.pages('/v1/orchard/orchards',{asOfDate:date})).filter(x=>eq(field(x,'cropId'),cropId)
    && eq(field(x,'orchardPin'),scenario.orchardPin));
  const verified=[];
  for(const x of candidates){const propertyId=field(x,'orchardPropertyId'); assertUuid(propertyId,'parent property ID');
    const property=await api.get(`/v1/orchard/properties/${propertyId}`,{asOfDate:date});
    if(eq(field(property,'countryId'),countryId))verified.push(x);
  }
  const orchard=one(verified,`Blackburn PIN ${scenario.orchardPin}`);
  const orchardId=field(orchard,'orchardId'); assertUuid(orchardId,'orchardId');
  assert(String(field(orchard,'orchardName')??'').toLowerCase().includes(scenario.orchardName.toLowerCase()),
    `PIN ${scenario.orchardPin} is not named ${scenario.orchardName}.`);
  const blocks=await api.blocks(orchardId,date), mas=await api.maturityAreas(orchardId,date);
  const activeMas=mas.filter(x=>field(x,'isActive')===true && eq(field(x,'orchardId'),orchardId));
  const possible=[];
  for (const block of blocks) {
    const blockId=field(block,'orchardBlockId');
    assertUuid(blockId,'Block in Orchard');
    assert(eq(field(block,'orchardId'),orchardId),'Found cross-Orchard Block during discovery.');
    if (scenario.sourceBlockCode && !eq(field(block,'orchardBlockCode'), scenario.sourceBlockCode)) continue;
    if (!isActiveLeafBlock(block, blocks)) continue;
    const ids=[field(block,'assignedMaturityAreaId'),...((field(block,'maturityAreaAssignments')??[]).map(x=>field(x,'maturityAreaId')))];
    for (const ma of activeMas) if(ids.some(id=>eq(id,field(ma,'maturityAreaId'))))
      possible.push({block,ma});
  }
  possible.sort((a,b)=>String(field(a.block,'orchardBlockCode')).localeCompare(String(field(b.block,'orchardBlockCode'))));
  return {allMas:mas,orchardId,orchardName:field(orchard,'orchardName'),pin:scenario.orchardPin,seasonId,countryId,cropId,blocks,activeMas,possible,
    candidates:possible.map(x=>({blockId:field(x.block,'orchardBlockId'),code:field(x.block,'orchardBlockCode'),
      name:field(x.block,'orchardBlockName'),maId:field(x.ma,'maturityAreaId'),maCode:field(x.ma,'maturityAreaCode'),businessHa:field(x.block,'blockArea')}))};
}
export function resolveEnteredArea(block, areaState, override) {
  const entered = override ?? field(block,'blockArea');
  const units = haUnits(entered,'persisted or explicitly configured entered hectares');
  assert(units > 0n,'Source Block requires positive entered hectares.');
  return units;
}
