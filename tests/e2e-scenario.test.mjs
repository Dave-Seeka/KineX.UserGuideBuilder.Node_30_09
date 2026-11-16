import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { buildE2eFlow, validateScenario, validateMigrationFixture, loadE2eScenario } from '../src/lib/e2e-scenario.mjs';
import { validateFlow } from '../src/lib/flow-loader.mjs';
import { flowExclusionReason } from '../src/lib/profiles.mjs';

const read = async (p) => JSON.parse(await fs.readFile(new URL(p, import.meta.url), 'utf8'));
async function inputs() {
  const scenario = await read('../scenarios/pin3025-property-orchard-block-ma-e2e.json');
  const foundation = await read('../flows/295-block-hectares-e2e-fixture.json');
  const ma = await read('../flows/335-mutation-create-maturity-area.json');
  return { scenario, foundation, ma };
}
function configured(scenario) {
  return structuredClone(scenario);
}
const actions = (flow) => flow.steps.flatMap((x) => x.actions || []);

test('scenario provisions a run-owned Entity with a KineX-generated code', async () => {
  const { scenario, foundation, ma } = await inputs();
  assert.equal(scenario.growerSupplier.entityNameSearch, '{{mutations.testPrefix}} PIN3025 Supplier {{runId}}');
  assert.equal(scenario.growerSupplier.entityCode, 'AUTO');
  assert.equal(scenario.testPrefix, 'KINEX-E2E');
  const staged = buildE2eFlow(scenario, foundation, ma);
  const supplier = staged.steps[0].actions.find(a => a.type === 'stageFixtureGrowerSupplier');
  assert.equal(supplier.search, '{{e2eSupplierName}}');
  assert.equal(supplier.entityCode, '{{e2eSupplierCode}}');
  const setup = staged.steps[0].actions.find(a => a.type === 'provisionE2eGrowerSupplier');
  assert.equal(setup.name, scenario.growerSupplier.entityNameSearch);
  const unconfigured = structuredClone(scenario);
  unconfigured.growerSupplier.entityNameSearch = 'Commercial Grower';
  assert.throws(() => validateScenario(unconfigured), /run-owned, generated-code test Entity/);
  assert.throws(() => buildE2eFlow(unconfigured, foundation, ma), /run-owned, generated-code test Entity/);
  const preview = buildE2eFlow(scenario, foundation, ma, { allowPlaceholders: true });
  assert.equal(preview.steps.length, 17);
});

test('JSON scenario validates two separate source-derived MAs and rejects duplicate assignments', async () => {
  const {scenario} = await inputs();
  const valid = configured(scenario);
  assert.equal(validateScenario(valid), valid);
  const bad = structuredClone(valid);
  bad.maturityAreas[1].additionalBlockName = bad.maturityAreas[0].initialBlockName;
  assert.throws(() => validateScenario(bad), /distinct.*source-derived|correct source CSV Blocks/);
  const sameCodes = structuredClone(valid);
  sameCodes.maturityAreas[1].editedCode = sameCodes.maturityAreas[0].initialCode;
  assert.throws(() => validateScenario(sameCodes), /Duplicate MA code/);
  const wrongFixture = structuredClone(valid);
  wrongFixture.geometryFixture = './fixtures/block-hectares-pin-1285.json';
  assert.throws(() => validateScenario(wrongFixture), /approval-gated PIN 3025/);
});

test('E2E composites native form and EsriJSON stages with two MA profile and membership saves', async () => {
  const { scenario, foundation, ma } = await inputs();
  const flow = buildE2eFlow(configured(scenario), foundation, ma);
  validateFlow(flow, 'generated MA E2E');
  assert.equal(flow.steps.length, 17);
  assert.equal(flow.mutation, true);
  assert.equal(flow.standalone, true);
  assert.equal(flowExclusionReason(flow, 'all', {mutations:{enabled:true,confirmation:'ALLOW KINEX GUIDE MUTATIONS'}}).includes('Standalone'), true);
  const all = actions(flow);
  assert.equal(all[0].type, 'assertE2eTestHost');
  assert.equal(all[1].type, 'preflightFixturePlacement');
  assert.equal(all[2].type, 'provisionE2eGrowerSupplier');
  for (const label of ['Variety','Growing method','Management type']) assert.ok(flow.steps[2].actions.some(a => a.type === 'selectFirstOption' && a.locator?.label === label));
  const growerIdx = flow.steps[0].actions.findIndex(x => x.type === 'stageFixtureGrowerSupplier');
  assert.ok(growerIdx > 0);
  assert.ok(flow.steps[0].actions.slice(growerIdx+1).some(x => x.locator?.selector === "[data-guide='create-submit-action'] button"));
  assert.equal(all.filter(a => a.type === 'injectFixturePolygon').length, 6);
  assert.equal(all.filter(a => a.type === 'selectFixtureMaBlock').length, 4);
  assert.equal(all.filter(a => a.type === 'verifyFixtureMaMembership').length, 2);
  assert.equal(all.filter(a => a.type === 'verifyFixtureMaCode').length, 4);
  assert.equal(all.filter(a => a.type === 'openFixtureOrchardForMa').length, 2);
  assert.equal(all.filter(a => a.type === 'assertMaMutationScope').length, 2);
  const saves = all.filter(a => a.type === 'click' && a.locator?.selector === "[data-guide='business-edit-save'] button");
  assert.equal(saves.length, 4);
  const assigned = all.filter(a => a.type === 'selectFixtureMaBlock').map(a=>a.name);
  assert.deepEqual(assigned,['PIN3025-E2E-1','PIN3025-E2E-2','PIN3025-E2E-3','PIN3025-E2E-4']);
  assert.equal(all.some(a => a.type === 'evaluate'),false);
  assert.equal(all.some(a => a.type === 'drawFixturePolygon'),false);
  assert.equal(new Set(flow.steps.map(x => x.capture.file)).size,flow.steps.length);
});

test('E2E fails closed if underlying MA create contract changes', async () => {
  const {scenario,foundation,ma} = await inputs();
  ma.steps[2].actions = ma.steps[2].actions.filter(x=>x.type !== 'clickFirst');
  assert.throws(()=>buildE2eFlow(configured(scenario),foundation,ma), /MA Block selection flow changed/);
});


test('PIN 3025 migration CSV values populate real E2E form inputs and post-save checks', async () => {
  const { scenario, foundation, ma } = await inputs();
  const fixture = await read('../fixtures/block-hectares-pin-3025.json');
  const valid = configured(scenario);
  assert.equal(valid.migrationSource.sourceOrchardId, '31404');
  assert.equal(valid.migrationSource.season, '2027');
  assert.equal(valid.migrationSource.sourceCsv, 'output/cab-2027-review/Orchards/business-gis-block-review.csv');
  assert.equal(valid.migrationSource.propertyGlobalId, 'bf2f50b0-53ef-47f1-9eb9-2347417ea477');
  assert.equal(valid.migrationSource.sourceEffectiveDate, '2026-07-01');
  assert.equal(valid.migrationSource.crosswalkStatus, 'crosswalk_candidate');
  assert.equal(valid.migrationSource.approvalStatus, 'not-recorded');
  assert.deepEqual(valid.migrationSource.blocks.map(b => b.sourcePhysicalAreaId), ['297807','297808','297809','297810']);
  assert.deepEqual(valid.migrationSource.blocks.map(b => b.businessAreaHectares), ['0.29','0.61','1.50','0.70']);
  assert.equal(validateMigrationFixture(valid,fixture), true);
  const flow = buildE2eFlow(valid, foundation, ma, { fixture });
  const first = flow.steps[0].actions;
  const selected = (selector) => first.find(a => a.type === 'selectOptionByAliases' && a.locator?.selector === selector)?.aliases;
  assert.deepEqual(selected("[data-guide='app-selection-country']"), ['NZ']);
  assert.deepEqual(selected("[data-guide='app-selection-crop']"), ['KIWIFRUIT']);
  assert.deepEqual(selected("[data-guide='app-selection-season']"), ['2027']);
  const blockFills = flow.steps[2].actions.filter(a => a.type === 'fill' && /^Block [1-4] area hectares$/.test(a.locator?.label ?? ''));
  assert.deepEqual(blockFills.map(a => a.value), ['0.29','0.61','1.50','0.70']);
  const check = flow.steps[4].actions.find(a => a.type === 'verifyBlockHectareFixture');
  assert.deepEqual(check.blocks.map(a=>a.businessHectares), [0.29,0.61,1.5,0.7]);
  assert.deepEqual(valid.maturityAreas.map(a=>[a.initialSourcePhysicalAreaId,a.additionalSourcePhysicalAreaId]), [['297807','297808'],['297809','297810']]);
  assert.equal(flow.steps.length,17);
});

test('migration provenance mismatches fail closed before mutating test data', async () => {
  const {scenario,foundation,ma} = await inputs();
  const fixture = await read('../fixtures/block-hectares-pin-3025.json');
  const valid = configured(scenario);
  for (const mutate of [
    bad => { bad.migrationSource.blocks[0].sourcePhysicalAreaId = '999999'; },
    bad => { bad.migrationSource.propertyGlobalId = '00000000-0000-0000-0000-000000000000'; },
    bad => { bad.migrationSource.approvalStatus = 'approved'; },
    bad => { bad.migrationSource.season = '2026'; },
    bad => { bad.maturityAreas[0].initialSourcePhysicalAreaId = '999999'; },
    bad => { bad.maturityAreas[0].initialBlockName = 'PIN3025-E2E-3'; }
  ]) {
    const bad = structuredClone(valid); mutate(bad);
    assert.throws(() => buildE2eFlow(bad,foundation,ma,{fixture}),/PIN 3025|MA 1/);
  }
  for (const mutate of [
    bad => { bad.e2e.blocks[2].businessAreaHectares = '1.56'; },
    bad => { bad.source.sourceCsv = 'output/cab-2026-review/Orchards/business-gis-block-review.csv'; },
    bad => { bad.e2e.blocks[0].geometry[0][0] += 3; },
    bad => { bad.e2e.property.geometry[0][0] += 3; },
    bad => { bad.e2e.blocks[1].sourceGisGlobalId = '00000000-0000-0000-0000-000000000000'; }
  ]) {
    const bad = structuredClone(fixture); mutate(bad);
    assert.throws(()=>validateMigrationFixture(valid,bad),/PIN 3025/);
  }
});

test('scenario loader verifies fixture source identities even for dry run', async () => {
  const loaded = await loadE2eScenario('./scenarios/pin3025-property-orchard-block-ma-e2e.json',{allowPlaceholders:true});
  assert.equal(loaded.flow.steps.length,17);
  assert.equal(loaded.scenario.migrationSource.blocks.length,4);
  assert.equal(loaded.scenario.growerSupplier.entityCode, 'AUTO');
});


test('E2E prerequisite provisioning rejects arbitrary supplier identity and changed approval preflight', async () => {
  const { scenario, foundation, ma } = await inputs();
  for (const [field, value] of [
    ['entityCode','TEST-0001'], ['mode','existing'], ['entityNameSearch','Existing Grower'],
    ['countryAliases',['Australia']], ['entityTypeAliases',['Unapproved type']]
  ]) {
    const broken = structuredClone(scenario);
    broken.growerSupplier[field] = value;
    assert.throws(() => buildE2eFlow(broken, foundation, ma), /run-owned, generated-code test Entity/);
  }
  const unowned = structuredClone(scenario);
  unowned.testPrefix = 'RealCompany';
  assert.throws(() => validateScenario(unowned), /dedicated KINEX-E2E testPrefix/);
  const foundationWithoutApproval = structuredClone(foundation);
  foundationWithoutApproval.steps[0].actions = foundationWithoutApproval.steps[0].actions.filter(a=>a.type!=='preflightFixturePlacement');
  assert.throws(() => buildE2eFlow(scenario, foundationWithoutApproval, ma), /approval preflight is missing/);
  const flow = buildE2eFlow(scenario, foundation, ma);
  const first = flow.steps[0].actions;
  assert.ok(first.findIndex(a=>a.type === 'preflightFixturePlacement') < first.findIndex(a=>a.type === 'provisionE2eGrowerSupplier'));
  assert.ok(first.findIndex(a=>a.type === 'provisionE2eGrowerSupplier') < first.findIndex(a=>a.type === 'goto'));
  assert.ok(first.findIndex(a=>a.type === 'provisionE2eGrowerSupplier') < first.findIndex(a=>a.type === 'stageFixtureGrowerSupplier'));
});
