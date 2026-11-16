import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadFlow, validateFlow } from './flow-loader.mjs';

const s = (selector) => ({ selector });
const capture = (file, selector, label) => ({ file, fullPage: false, highlights: [{ locator: s(selector), label, number: 1 }] });
const wait = (selector, timeoutMs = 20000) => ({ type: 'waitFor', locator: s(selector), timeoutMs });
const click = (selector, timeoutMs = 15000) => ({ type: 'click', locator: s(selector), timeoutMs });
const enabled = (selector, timeoutMs = 20000) => ({ type: 'waitForEnabled', locator: s(selector), timeoutMs });
const requireValue = (name, value, allowPlaceholders = false) => {
  if (typeof value !== 'string' || !value.trim() || (!allowPlaceholders && value.startsWith('REPLACE_'))) {
    throw new Error(`E2E scenario needs an approved test value for ${name}; no records were created.`);
  }
  return value;
};

// The migration CSV supplies source identities/geometries, not approved GIS
// crosswalks, Grower Supplier identities, MA profiles, or business status enums.
// Keep those namespaces distinct so the fixture cannot silently drift.
const ringSha256 = (ring) => createHash('sha256').update(
  ring.map(point => point.map(value => Number(value).toFixed(4)).join(',')).join(';')
).digest('hex');

function requireMigrationSource(scenario) {
  const source = scenario?.migrationSource;
  if (!source || source.sourceCsv !== 'output/cab-2027-review/Orchards/business-gis-block-review.csv'
      || source.sourceOrchardKey !== 'ORCHARD:31404|CROP:KIWIFRUIT'
      || source.sourceOrchardId !== '31404' || source.sourcePin !== '3025'
      || source.countryCode !== 'NZ' || source.cropCode !== 'KIWIFRUIT'
      || source.season !== '2027' || source.sourceEffectiveDate !== '2026-07-01'
      || source.propertyGlobalId !== 'bf2f50b0-53ef-47f1-9eb9-2347417ea477'
      || !/^[a-f0-9]{64}$/.test(source.propertyRingSha256 ?? '')
      || source.spatialReferenceWkid !== 2193 || source.crosswalkStatus !== 'crosswalk_candidate'
      || source.approvalStatus !== 'not-recorded'
      || source.orchardGeometryOrigin !== 'derived-inset-not-source'
      || source.maturityAreaSourceStatus !== 'not-present-in-reviewed-csv') {
    throw new Error('PIN 3025 migration CSV source identity or unapproved provenance changed. Review before mutation.');
  }
  if (!Array.isArray(source.blocks) || source.blocks.length !== 4) {
    throw new Error('PIN 3025 migration CSV source requires four Block records.');
  }
  const physicalIds = new Set(), gisIds = new Set();
  for (const [index, block] of source.blocks.entries()) {
    const code = String(index + 1);
    if (block.name !== `PIN3025-E2E-${code}`
        || block.sourceKey !== `ORCHARD:31404|CROP:KIWIFRUIT|BLOCK:${code}`
        || block.sourceBlockCode !== code || !/^\d+$/.test(block.sourcePhysicalAreaId ?? '')
        || !/^[0-9a-f-]{36}$/i.test(block.candidateGisGlobalId ?? '')
        || !/^[a-f0-9]{64}$/i.test(block.sourceHash ?? '')
        || !/^[a-f0-9]{64}$/i.test(block.geometryRingSha256 ?? '')
        || !(Number.isFinite(block.sourceGisAreaHectares) && block.sourceGisAreaHectares > 0)
        || !/^\d+\.\d{2}$/.test(block.businessAreaHectares ?? '')
        || block.gisStatusCode !== '1' // source GIS code, NOT a KineX production-status mapping
        || block.propertyOverlapStatus !== 'inside'
        || block.propertyOverlapPercent !== 100) {
      throw new Error(`PIN 3025 source Block ${code} has inconsistent CSV identity, hectares or containment.`);
    }
    physicalIds.add(block.sourcePhysicalAreaId);
    gisIds.add(block.candidateGisGlobalId);
  }
  if (physicalIds.size !== 4 || gisIds.size !== 4) {
    throw new Error('PIN 3025 CSV Block identities must be unique.');
  }
  return source;
}

export function validateMigrationFixture(scenario, fixture) {
  const source = requireMigrationSource(scenario);
  if (fixture?.source?.sourceCsv !== source.sourceCsv
      || fixture?.source?.propertyGlobalId !== source.propertyGlobalId
      || fixture.source.orchardId !== source.sourceOrchardId
      || fixture.source.orchardPin !== source.sourcePin
      || fixture.source.cropCode !== source.cropCode
      || fixture.source.seasonEffectiveDate !== source.sourceEffectiveDate
      || fixture.e2e?.spatialReferenceWkid !== source.spatialReferenceWkid
      || fixture.e2e.placementMode !== 'fixed'
      || fixture.e2e.approvalStatus !== 'unapproved-candidate'
      || fixture.e2e.orchard?.authoritative !== false
      || !Array.isArray(fixture.e2e.blocks) || fixture.e2e.blocks.length !== 4) {
    throw new Error('PIN 3025 migration source does not match approval-gated spatial fixture.');
  }
  if (!Array.isArray(fixture.e2e.property.geometry)
      || ringSha256(fixture.e2e.property.geometry) !== source.propertyRingSha256) {
    throw new Error('PIN 3025 Property geometry no longer matches the source CSV ring.');
  }
  for (const [i, sourceBlock] of source.blocks.entries()) {
    const fixtureBlock = fixture.e2e.blocks[i];
    if (fixtureBlock.sourceBlockCode !== sourceBlock.sourceBlockCode
        || fixtureBlock.sourcePhysicalAreaId !== sourceBlock.sourcePhysicalAreaId
        || fixtureBlock.sourceGisGlobalId !== sourceBlock.candidateGisGlobalId
        || Math.abs(fixtureBlock.sourceGisAreaHectares - sourceBlock.sourceGisAreaHectares) > 0.000001
        || fixtureBlock.businessAreaHectares !== sourceBlock.businessAreaHectares
        || !Array.isArray(fixtureBlock.geometry) || fixtureBlock.geometry.length < 4
        || ringSha256(fixtureBlock.geometry) !== sourceBlock.geometryRingSha256) {
      throw new Error(`PIN 3025 migration CSV Block ${i + 1} differs from source polygon fixture.`);
    }
  }
  return true;
}

export function validateScenario(scenario, { allowPlaceholders = false } = {}) {
  if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) throw new Error('E2E scenario must be a JSON object.');
  if (typeof scenario.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,70}$/.test(scenario.id)) throw new Error('E2E scenario id must be a safe lowercase slug.');
  if (!/^KINEX-E2E(?:-[A-Z0-9]{1,20})?$/.test(scenario.testPrefix ?? '')) throw new Error('E2E scenario needs a dedicated KINEX-E2E testPrefix.');
  if (scenario.foundationFlow !== './flows/295-block-hectares-e2e-fixture.json' || scenario.geometryFixture !== './fixtures/block-hectares-pin-3025.json') {
    throw new Error('E2E scenario currently supports only the approval-gated PIN 3025 foundation flow.');
  }
  const source = requireMigrationSource(scenario);
  requireValue('growerSupplier.entityNameSearch', scenario.growerSupplier?.entityNameSearch, allowPlaceholders);
  requireValue('growerSupplier.entityCode', scenario.growerSupplier?.entityCode, allowPlaceholders);
  if (scenario.growerSupplier?.mode !== 'createOrReuseTestEntity'
      || scenario.growerSupplier.entityCode !== 'AUTO'
      || scenario.growerSupplier.entityNameSearch !== '{{mutations.testPrefix}} PIN3025 Supplier {{runId}}'
      || JSON.stringify(scenario.growerSupplier.entityTypeAliases) !== JSON.stringify(['Company', 'COMPANY'])
      || JSON.stringify(scenario.growerSupplier.countryAliases) !== JSON.stringify(['New Zealand', 'NZ'])) {
    throw new Error('E2E Grower Supplier must be a run-owned, generated-code test Entity in NZ; refusing arbitrary Entity reuse.');
  }
  const fifth = String(scenario.growerSupplier?.fifthCharacter ?? '');
  if (fifth && !/^[A-Z0-9]$/i.test(fifth)) throw new Error('Grower number fifthCharacter must be one alphanumeric character.');
  if (!Array.isArray(scenario.maturityAreas) || scenario.maturityAreas.length !== 2) {
    throw new Error('The test scenario must define exactly two Maturity Areas.');
  }
  const usedCodes = new Set();
  const usedBlocks = new Set();
  for (const [index, ma] of scenario.maturityAreas.entries()) {
    for (const key of ['initialCode', 'editedCode']) {
      const value = requireValue(`maturityAreas[${index}].${key}`, ma?.[key]);
      if (!/^[A-Za-z0-9]+(?:\{\{runId\}\})?$/.test(value)) {
        throw new Error(`maturityAreas[${index}].${key} needs an alphanumeric code, optionally ending in {{runId}}.`);
      }
      if (usedCodes.has(value)) throw new Error(`Duplicate MA code in scenario: '${value}'.`);
      usedCodes.add(value);
    }
    const expectedSourceIds = [source.blocks[index * 2].sourcePhysicalAreaId, source.blocks[index * 2 + 1].sourcePhysicalAreaId];
    if (ma.initialSourcePhysicalAreaId !== expectedSourceIds[0]
        || ma.additionalSourcePhysicalAreaId !== expectedSourceIds[1]
        || ma.dataOrigin !== 'test-created-ma-using-source-derived-block-relationships') {
      throw new Error(`MA ${index + 1} must reference its two distinct source CSV Block profiles; MA records are synthetic.`);
    }
    if (ma.initialBlockName !== source.blocks[index * 2].name
        || ma.additionalBlockName !== source.blocks[index * 2 + 1].name) {
      throw new Error(`MA ${index + 1} must assign the correct source CSV Blocks for its physical-area IDs.`);
    }
    for (const key of ['initialBlockName', 'additionalBlockName']) {
      const name = requireValue(`maturityAreas[${index}].${key}`, ma?.[key]);
      if (!/^PIN3025-E2E-[1-4]$/.test(name) || usedBlocks.has(name)) {
        throw new Error(`Each MA test Block must be a distinct, source-derived PIN3025-E2E-[1-4]: '${name}'.`);
      }
      usedBlocks.add(name);
    }
  }
  return scenario;
}

// CAB snapshot dates describe the legacy source; they are NOT the effective
// dates for newly created E2E business records. The E2E AppSelection uses a
// calendar-year season (e.g. 2027), so retain the source month/day but use
// the selected season's year, then verify each input's actual min/max in UI.
export function e2eCreationEffectiveDate(source) {
  const season = source?.season;
  const snapshot = source?.sourceEffectiveDate;
  if (!/^\d{4}$/.test(season ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot ?? '')) {
    throw new Error('E2E effective date requires a valid season and an ISO migration source date.');
  }
  const date = `${season}-${snapshot.slice(5)}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`Cannot derive a valid E2E effective date from ${snapshot} for season ${season}.`);
  }
  return date;
}

export function buildE2eFlow(scenario, base, ma, options = {}) {
  validateScenario(scenario, options);
  if (ma?.id !== 'mutation-create-maturity-area' || ma.steps.length < 4) throw new Error('MA create wizard changed. Review before running E2E mutations.');
  if (base.id !== 'block-hectares-e2e-fixture' || base.steps.length !== 5) throw new Error('PIN3025 foundation flow structure changed. Review before running E2E mutations.');
  if (options.fixture) validateMigrationFixture(scenario, options.fixture);
  const steps = structuredClone(base.steps);
  const source = scenario.migrationSource;
  const testEffectiveDate = e2eCreationEffectiveDate(source);
  // The foundation JSON is independently runnable with its original date.
  // Override ONLY its cloned E2E actions, never the source geometry fixture.
  const dateSelectors = [
    "[data-guide='property-effective-date'] input[type='date']",
    "[data-guide='orchard-effective-date'] input[type='date']"
  ];
  for (const selector of dateSelectors) {
    const candidates = steps[0].actions.filter(a => a.type === 'assertFixtureScope' && a.dateSelectors?.includes(selector));
    if (candidates.length !== 1 || candidates[0].dateSelectors.length !== 1) {
      throw new Error(`E2E foundation effective-date gate changed for ${selector}; refusing to create records.`);
    }
    candidates[0].effectiveDate = testEffectiveDate;
  }
  const setAliases = (step, selector, aliases) => {
    const match = step.actions.find(a => a.type === 'selectOptionByAliases' && a.locator?.selector === selector);
    if (!match) throw new Error(`Missing foundation source selection ${selector}.`);
    match.aliases = aliases;
  };
  const setFormField = (step, label, value) => {
    const match = step.actions.find(a => a.type === 'fill' && a.locator?.label === label);
    if (!match) throw new Error(`Missing foundation Block field ${label}.`);
    match.value = value;
  };
  setAliases(steps[0], "[data-guide='app-selection-country']", [source.countryCode]);
  setAliases(steps[0], "[data-guide='app-selection-crop']", [source.cropCode]);
  setAliases(steps[0], "[data-guide='app-selection-season']", [source.season]);
  setAliases(steps[0], "[data-guide='property-country']", source.countryCode === 'NZ'
    ? ['NZ', 'New Zealand'] : [source.countryCode]);
  for (const [i, block] of source.blocks.entries()) {
    setFormField(steps[2], `Block ${i + 1} area hectares`, block.businessAreaHectares);
  }
  const areaCheck = steps[4].actions.find(a => a.type === 'verifyBlockHectareFixture');
  if (!areaCheck || !Array.isArray(areaCheck.blocks) || areaCheck.blocks.length !== 4) {
    throw new Error('Foundation business hectare verification action changed.');
  }
  areaCheck.blocks = source.blocks.map(block => ({ name: block.name, businessHectares: Number(block.businessAreaHectares) }));

  // The form's Orchard Grower Supplier step was previously skipped. An MA cannot
  // be created unless an eligible Entity is staged during Orchard creation.
  const step = steps[0];
  const index = step.actions.findIndex((a) => a.type === 'waitFor' && a.locator?.selector === "[data-guide='orchard-grower-supply-step']");
  if (index < 0) throw new Error('Orchard Grower Supplier wizard step is missing.');
  step.actions.unshift({ type: 'assertE2eTestHost' });
  const preflightIndex = step.actions.findIndex(a => a.type === 'preflightFixturePlacement');
  if (preflightIndex < 0) throw new Error('E2E fixture approval preflight is missing.');
  step.actions.splice(preflightIndex + 1, 0, {
    type: 'provisionE2eGrowerSupplier',
    name: scenario.growerSupplier.entityNameSearch,
    countryAliases: scenario.growerSupplier.countryAliases,
    entityTypeAliases: scenario.growerSupplier.entityTypeAliases,
    timeoutMs: 25000
  });
  step.actions.splice(index + 2, 0, {
    type: 'stageFixtureGrowerSupplier', search: '{{e2eSupplierName}}',
    entityCode: '{{e2eSupplierCode}}', fifthCharacter: scenario.growerSupplier.fifthCharacter ?? '',
    timeoutMs: 18000
  });
  // The standalone hectare fixture does not require MA eligibility metadata.
  // This broader E2E mode does: Producing Blocks require Variety, Growing
  // Method and Management Type, in addition to the existing Cover Status.
  const blockStep = steps[2];
  const productionIndex = blockStep.actions.findIndex(a => a.type === 'selectOptionByAliases' && a.locator?.label === 'Production status *');
  if (productionIndex < 0) throw new Error('Foundation Block production status step changed.');
  blockStep.actions.splice(productionIndex + 1, 0, ...['Variety', 'Growing method', 'Management type'].map(label => ({
    type: 'selectFirstOption', locator: { label }, timeoutMs: 12000
  })));
  // Create each MA from the freshly created Orchard, never from a randomly
  // selected pre-existing Orchard or Maturity Area.
  for (const [maIndex, maConfig] of scenario.maturityAreas.entries()) {
  steps.push({
    heading: `Open Create MA ${maIndex + 1} for the newly created Orchard`,
    instruction: 'Resolve the Orchard by its newly generated PIN and confirm the guide-owned identity before any MA mutation.',
    actions: [
      { type: 'openFixtureOrchardForMa', expectedName: '{{mutations.testPrefix}} PIN3025 E2E {{runId}}', timeoutMs: 25000 },
      { type: 'assertMaMutationScope', expectedParentText: '{{mutations.testPrefix}} PIN3025 E2E {{runId}}' },
      click("[data-guide='context-create-ma']:not(:disabled)"),
      wait("[data-guide='entity-create-drawer'][data-guide-entity='maturityarea']")
    ],
    capture: capture(`${maIndex + 1}-06-ma-create-start.png`, "[data-guide='maturity-area-parent-context']", 'New test Orchard')
  });
  const maDetails = structuredClone(ma.steps[1]);
  maDetails.capture.file = `${maIndex + 1}-07-ma-details.png`;
  const maDateGate = maDetails.actions.findIndex(a => a.type === 'require'
    && a.locator?.selector === "[data-guide='maturity-area-effective-date'] input[type='date']:not(:disabled)");
  if (maDateGate < 0) throw new Error('MA effective-date input changed; refusing E2E mutation.');
  maDetails.actions.splice(maDateGate + 1, 0, {
    type: 'assertFixtureScope', effectiveDate: testEffectiveDate,
    dateSelectors: ["[data-guide='maturity-area-effective-date'] input[type='date']"],
    timeoutMs: 15000
  });
  const codeAction = maDetails.actions.find((a) => a.type === 'fill' && a.locator?.selector === "[data-guide='maturity-area-code'] input");
  if (!codeAction) throw new Error('MA details code action changed.');
  codeAction.value = maConfig.initialCode;
  steps.push(maDetails);
  const maBlocks = structuredClone(ma.steps[2]);
  maBlocks.heading = `Select the first test Block for MA ${maIndex + 1}`;
  maBlocks.capture.file = `${maIndex + 1}-08-ma-blocks-review.png`;
  const generic = maBlocks.actions.findIndex((a) => a.type === 'clickFirst' && a.locator?.selector?.includes('Assign Block '));
  if (generic < 0) throw new Error('MA Block selection flow changed.');
  maBlocks.actions.splice(generic, 1, { type: 'selectFixtureMaBlock', name: maConfig.initialBlockName, timeoutMs: 16000 });
  steps.push(maBlocks);
  const create = structuredClone(ma.steps[3]);
  create.capture.file = `${maIndex + 1}-09-ma-created.png`;
  create.actions.push({ type: 'verifyFixtureMaCode', expected: maConfig.initialCode, timeoutMs: 22000 });
  steps.push(create);
  steps.push({
    heading: `Edit and verify saved MA ${maIndex + 1} profile`,
    instruction: 'Change the newly created MA code through KineX’s effective-dated editor and verify the persisted result.',
    actions: [
      click("[data-guide='business-edit-action']:not(:disabled)"),
      wait("[data-guide='schedule-change-modal']"),
      { type: 'clickIfVisible', locator: { role: 'button', name: 'Use viewed state', exact: true }, timeoutMs: 1500 },
      { type: 'click', locator: { role: 'button', name: 'Continue', exact: true }, timeoutMs: 16000 },
      wait("[data-guide='business-form-shell'][data-guide-mode='edit']"),
      { type: 'fill', locator: s("[data-guide='ma-bf-code'] input"), value: maConfig.editedCode, timeoutMs: 10000 },
      enabled("[data-guide='business-edit-save'] button"), click("[data-guide='business-edit-save'] button"),
      wait("[data-guide='business-form-shell'][data-guide-entity='maturity area']:not([data-guide-mode='edit'])", 50000),
      { type: 'verifyFixtureMaCode', expected: maConfig.editedCode, timeoutMs: 25000 }
    ],
    capture: capture(`${maIndex + 1}-10-ma-profile-edited.png`, "[data-guide='ma-bf-code']", 'Saved MA code')
  });
  steps.push({
    heading: `Edit MA ${maIndex + 1} membership and verify two assigned Blocks`,
    instruction: 'Add a second compatible guide-owned Block via the effective-dated allocation editor, then verify the saved member count.',
    actions: [
      { type: 'click', locator: { role: 'tab', name: 'Allocation', exact: true } },
      wait("[data-guide='ma-blocks-tab']"),
      { type: 'click', locator: { role: 'button', name: 'Edit assignment', exact: true }, timeoutMs: 16000 },
      wait("[data-guide='schedule-change-modal']"),
      { type: 'clickIfVisible', locator: { role: 'button', name: 'Use viewed state', exact: true }, timeoutMs: 1500 },
      { type: 'click', locator: { role: 'button', name: 'Continue', exact: true }, timeoutMs: 16000 },
      wait(".workbench-ma-edit__groups", 25000),
      { type: 'selectFixtureMaBlock', name: maConfig.additionalBlockName, timeoutMs: 18000 },
      enabled("[data-guide='business-edit-save'] button"), click("[data-guide='business-edit-save'] button"),
      wait("[data-guide='business-form-shell'][data-guide-entity='maturity area']:not([data-guide-mode='edit'])", 60000),
      { type: 'verifyFixtureMaMembership', expected: [maConfig.initialBlockName, maConfig.additionalBlockName], timeoutMs: 25000 }
    ],
    capture: capture(`${maIndex + 1}-11-ma-membership-edited.png`, "[data-guide='ma-blocks-tab']", 'Updated MA membership')
  });
  }
  const flow = {
    ...structuredClone(base),
    id: 'ma-e2e-' + scenario.id,
    title: 'E2E Property / Orchard / Block / MA creation and edits',
    category: 'Standalone mutation E2E', order: 345, profiles: ['ma-e2e'],
    standalone: true, mutation: true,
    safety: 'Persistent Property, Orchard, Blocks and MA mutations. PIN3025 GIS approval required. Grower Supplier Entity is provisioned via KineX UI. No automated cleanup.',
    steps,
    cleanupActions: [
      { type: 'clickIfVisible', locator: s("[data-guide='business-edit-cancel'] button"), timeoutMs: 1500 },
      { type: 'clickIfVisible', locator: s("[data-guide='create-cancel-action'] button"), timeoutMs: 1500 }
    ]
  };
  validateFlow(flow, 'generated MA E2E flow');
  return flow;
}

export async function loadE2eScenario(scenarioPath, options = {}) {
  const scenario = validateScenario(JSON.parse(await fs.readFile(path.resolve(scenarioPath), 'utf8')), options);
  const fixture = JSON.parse(await fs.readFile(path.resolve(scenario.geometryFixture), 'utf8'));
  validateMigrationFixture(scenario, fixture);
  const { flow: base } = await loadFlow(path.resolve(scenario.foundationFlow));
  const { flow: ma } = await loadFlow(path.resolve('./flows/335-mutation-create-maturity-area.json'));
  return { scenario, flow: buildE2eFlow(scenario, base, ma, { ...options, fixture }) };
}
