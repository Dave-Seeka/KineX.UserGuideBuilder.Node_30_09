/** Contract assertions for OMD-1638 / OMD-1649. No direct GIS or business mutations. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const lower = value => String(value ?? '').toLowerCase();
export const field = (row, key) => row?.[key] ?? row?.[key[0].toUpperCase() + key.slice(1)];
export function assert(condition, message) { if (!condition) throw new Error(message); }
export function assertUuid(value, label) { assert(UUID.test(value ?? '') && value !== '00000000-0000-0000-0000-000000000000', `${label} must be a persisted UUID.`); }
// KineX permits nested splits: a child can be split again if it is an active leaf.
// The source's own ParentOrchardBlockId describes lineage, not eligibility.
export function isActiveLeafBlock(block, activeBlocks) {
  const id = lower(field(block, 'orchardBlockId'));
  return Boolean(id) && !activeBlocks.some(other =>
    lower(field(other, 'parentOrchardBlockId')) === id);
}
export function assertDate(value, label) {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(value ?? '') && !Number.isNaN(Date.parse(value + 'T00:00:00Z'))
    && new Date(value + 'T00:00:00Z').toISOString().slice(0,10) === value, `${label} must be a real YYYY-MM-DD date.`);
}
export function haUnits(value, label) {
  assert(value !== null && value !== undefined && /^\d+(?:\.\d{1,4})?$/.test(String(value)), `${label} must have 0-4 decimal places and be nonnegative.`);
  const [whole, fraction = ''] = String(value).split('.');
  return BigInt(whole) * 10000n + BigInt((fraction + '0000').slice(0,4));
}
export function formatHa(units) { return `${units / 10000n}.${(units % 10000n).toString().padStart(4,'0')}`; }
export function getBlockArea(block) { return field(block, 'blockArea'); }
export function assertReadback({ orchardId, parent, children, splitDate, expectedHectares, previewAreas, controlsBefore = [], controlsAfter = [] }) {
  assertUuid(orchardId, 'orchardId');
  assert(Array.isArray(children) && children.length === 2, `Expected exactly two child Blocks; got ${children?.length ?? 'none'}.`);
  assert(previewAreas.length === 2 && previewAreas.every(area => area > 0 && Number.isFinite(area)), 'Preview must contain two positive GIS areas.');
  const sourceId = field(parent,'orchardBlockId'); assertUuid(sourceId, 'parent Block ID');
  assert(lower(field(parent,'orchardId')) === lower(orchardId), 'Source parent Orchard mismatch.');
  const ids = new Set();
  let total = 0n;
  for (const child of children) {
    const id = field(child,'orchardBlockId'); assertUuid(id, 'child Block ID');
    assert(!ids.has(lower(id)) && lower(id) !== lower(sourceId), 'Split returned duplicate/parent child identity.');
    ids.add(lower(id));
    assert(lower(field(child,'orchardId')) === lower(orchardId), `Child ${id} belongs to wrong Orchard.`);
    assert(lower(field(child,'parentOrchardBlockId')) === lower(sourceId), `Child ${id} has incorrect parent Block.`);
    assert(String(field(child,'effectiveFromDate')).slice(0,10) === splitDate, `Child ${id} has unexpected effective-from date.`);
    total += haUnits(getBlockArea(child), `child ${id} business hectares`);
  }
  const expected = haUnits(expectedHectares, 'expected entered hectares');
  assert(total === expected, `OMD-1638 failed: child business hectares ${formatHa(total)} != entered parent ${formatHa(expected)}. GIS may differ.`);
  const parentBusiness = haUnits(getBlockArea(parent), 'parent business hectares');
  assert(parentBusiness === expected, `Parent business hectares ${formatHa(parentBusiness)} != entered ${formatHa(expected)}.`);
  // The first split part gets a 4dp rounded share; final child conserves the remainder.
  const gisTotal = previewAreas.reduce((sum, value) => sum + value, 0);
  const firstUnits = BigInt(Math.floor(Number(expected) * previewAreas[0] / gisTotal + 0.5));
  const secondUnits = expected - firstUnits;
  const savedByIndex = children.slice().sort((a,b) => String(field(a,'orchardBlockCode')).localeCompare(String(field(b,'orchardBlockCode'))));
  const expectedParts = [firstUnits, secondUnits];
  // Child indexing may differ from alphabetical Block order. Compare the unordered area allocations.
  const actualUnits = savedByIndex.map(c => haUnits(getBlockArea(c), 'saved child business hectares')).sort((a,b) => a < b ? -1 : a > b ? 1 : 0);
  const expectedSorted = expectedParts.sort((a,b) => a < b ? -1 : a > b ? 1 : 0);
  // The UI displays GIS preview values at four decimals, while the API may allocate
  // using higher-precision measured geometry. The exact business total remains strict;
  // permit at most two 0.0001 ha units of allocation rounding variation per part.
  assert(actualUnits.every((v,i) => (v > expectedSorted[i] ? v-expectedSorted[i] : expectedSorted[i]-v) <= 2n),
    `OMD-1638 failed: child hectares do not match GIS-proportion allocation within 0.0002 ha (saved ${actualUnits.map(formatHa).join('/')}, expected ${expectedSorted.map(formatHa).join('/')}).`);
  const controlMap = new Map(controlsBefore.map(block => [lower(field(block,'orchardBlockId')), getBlockArea(block)]));
  for (const c of controlsAfter) {
    const id = lower(field(c,'orchardBlockId'));
    if (!controlMap.has(id)) continue;
    const before = controlMap.get(id), after = getBlockArea(c);
    if (before == null || after == null) {
      assert(before == null && after == null,
        `Unmodified control Block ${id} changed from/to missing business hectares during split.`);
      continue;
    }
    assert(haUnits(after, 'control Block') === haUnits(before, 'baseline control Block'),
      `Unmodified control Block ${id} changed business hectares during split.`);
  }
  return { parentBusinessHa: formatHa(expected), childrenBusinessHa: children.map(c => formatHa(haUnits(getBlockArea(c), 'child'))), previewGisHectares: previewAreas, controlBlocksVerified: controlsAfter.length };
}

export function validateScenario(scenario) {
  assert(scenario?.orchardPin === '5255' && scenario.orchardName && /blackburn/i.test(scenario.orchardName), 'This regression flow is pinned to Blackburn, Orchard PIN 5255.');
  assert(scenario.countryCode === 'NZ' && scenario.cropCode === 'KIWIFRUIT' && scenario.season === '2027', 'Test scope must be NZ / KIWIFRUIT / season 2027.');
  assertDate(scenario.asOfDate,'asOfDate'); assertDate(scenario.manualEntryDate,'manualEntryDate'); assertDate(scenario.splitDate,'splitDate');
  assert(scenario.manualEntryDate <= scenario.splitDate && scenario.splitDate >= scenario.asOfDate, 'Manual entry must precede or equal the split, and split must not precede as-of.');
  assert(/^\d{4}$/.test(scenario.orchardPin), 'Orchard PIN must be four characters.');
  assert(scenario.sourceBlockCode === null || /^[A-Za-z0-9-]{2,30}$/.test(scenario.sourceBlockCode), 'Specify an exact persisted sourceBlockCode or null for read-only discovery.');
  if (scenario.enteredHectares !== null) {
    assert(haUnits(scenario.enteredHectares,'enteredHectares') > 0n, 'Use positive entered hectares.');
  }
  assert(typeof scenario.manualOverrideReason === 'string' && scenario.manualOverrideReason.length >= 10, 'An explicit reason is required when setting entered hectares through the UI.');
  assert(typeof scenario.testRunId === 'string' && /^BLACKBURN-5255-[A-Za-z0-9_-]{3,50}$/.test(scenario.testRunId), 'testRunId must identify this Blackburn test run.');
  const setup=scenario.maSetup;
  assert(setup?.mode==='create-or-reuse' && Array.isArray(setup.areas) && setup.areas.length===2,
    'maSetup must request exactly two test-owned MAs in create-or-reuse mode.');
  const maCodes=new Set();
  for (const ma of setup.areas) {
    assert(/^[A-Za-z0-9]{2,32}$/.test(ma.code??''), 'MA setup code must be 2-32 alphanumeric characters.');
    assert(!maCodes.has(ma.code.toLowerCase()), 'MA setup codes must be different.');
    maCodes.add(ma.code.toLowerCase());
    assert(ma.blockCode==null || /^[A-Za-z0-9-]{2,30}$/.test(ma.blockCode), 'MA setup blockCode must be a persisted Block code or null.');
  }
  for (const name of ['truckAccessId','growerSupplyEntityId']) {
    assert(setup[name]==null || UUID.test(setup[name]) || /^[A-Za-z0-9 ._-]{2,100}$/.test(setup[name]),
      `maSetup.${name} must be a reference UUID/label or null.`);
  }
  const pts = scenario.cutLine;
  assert(Array.isArray(pts) && pts.length === 2 && pts.every(p => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number' && n >= -0.5 && n <= 1.5)),
    'cutLine requires two normalized polygon-bounds coordinates [x,y] in -0.5..1.5.');
  const [a,b] = pts;
  assert(Math.abs(a[0]-b[0]) <= 0.03 || Math.abs(a[1]-b[1]) <= 0.03,
    'Cut line must be near vertical or horizontal, to cross the Block boundary.');
  return scenario;
}
