import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildE2eFlow, e2eCreationEffectiveDate } from '../src/lib/e2e-scenario.mjs';

const fixture = async (name) => JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), 'utf8'));
const dates = flow => flow.steps.flatMap(step => step.actions ?? []).filter(action => action.type === 'assertFixtureScope');

test('historical 2026 migration snapshot is kept distinct from 2027 E2E effective date', () => {
  assert.equal(e2eCreationEffectiveDate({ season: '2027', sourceEffectiveDate: '2026-07-01' }), '2027-07-01');
  assert.equal(e2eCreationEffectiveDate({ season: '2026', sourceEffectiveDate: '2026-07-01' }), '2026-07-01');
});

test('invalid season or date cannot silently flow into business records', () => {
  for (const source of [
    { season: '2027', sourceEffectiveDate: '2026-02-29' },
    { season: '2027', sourceEffectiveDate: '2026-13-01' },
    { season: '2027', sourceEffectiveDate: '2026/07/01' },
    { season: 'not-a-season', sourceEffectiveDate: '2026-07-01' }
  ]) {
    assert.throws(() => e2eCreationEffectiveDate(source), /E2E effective date|Cannot derive/);
  }
});

test('E2E clones both Property/Orchard dates and each MA effective date without changing source fixture', async () => {
  const scenario = await fixture('scenarios/pin3025-property-orchard-block-ma-e2e.json');
  const base = await fixture('flows/295-block-hectares-e2e-fixture.json');
  const ma = await fixture('flows/335-mutation-create-maturity-area.json');
  const originalDates = base.steps[0].actions.filter(a => a.type === 'assertFixtureScope').map(a => a.effectiveDate);
  const flow = buildE2eFlow(scenario, base, ma, { allowPlaceholders: true });
  const generatedDate = e2eCreationEffectiveDate(scenario.migrationSource);
  const dateActions = dates(flow);
  assert.equal(dateActions.length, 4);
  assert.deepEqual(dateActions.map(a => a.effectiveDate), Array(4).fill(generatedDate));
  assert.deepEqual(dateActions.map(a => a.dateSelectors[0]), [
    "[data-guide='property-effective-date'] input[type='date']",
    "[data-guide='orchard-effective-date'] input[type='date']",
    "[data-guide='maturity-area-effective-date'] input[type='date']",
    "[data-guide='maturity-area-effective-date'] input[type='date']"
  ]);
  assert.deepEqual(base.steps[0].actions.filter(a => a.type === 'assertFixtureScope').map(a => a.effectiveDate), originalDates);
  assert.equal(scenario.migrationSource.sourceEffectiveDate, '2026-07-01');
  for (const [stepIndex, step] of flow.steps.entries()) {
    if (!step.heading.startsWith('Complete required MA details')) continue;
    const actions = step.actions;
    const requireIndex = actions.findIndex(a => a.type === 'require' && a.locator?.selector?.includes('maturity-area-effective-date'));
    assert.ok(requireIndex > -1, `step ${stepIndex} must assert the MA date input`);
    assert.equal(actions[requireIndex + 1].type, 'assertFixtureScope', `step ${stepIndex} must set MA date before continuing`);
  }
});

test('missing E2E Property date gate fails closed rather than creating backdated records', async () => {
  const scenario = await fixture('scenarios/pin3025-property-orchard-block-ma-e2e.json');
  const base = await fixture('flows/295-block-hectares-e2e-fixture.json');
  const ma = await fixture('flows/335-mutation-create-maturity-area.json');
  base.steps[0].actions = base.steps[0].actions.filter(a =>
    !(a.type === 'assertFixtureScope' && a.dateSelectors?.some(x => x.includes('property-effective-date'))));
  assert.throws(() => buildE2eFlow(scenario, base, ma, { allowPlaceholders: true }), /foundation effective-date gate changed/);
});

test('runtime uses in-season E2E effective date and rejects out-of-season date', async () => {
  const { runActions } = await import('../src/lib/actions.mjs');
  const selected = { value: '', writes: 0 };
  const input = {
    first() { return this; },
    waitFor: async () => {},
    evaluate: async () => ({ min: '2027-01-01', max: '2027-12-31', value: selected.value }),
    fill: async (date) => { selected.value = date; selected.writes++; },
    inputValue: async () => selected.value
  };
  const page = { locator: () => input };
  const gate = effectiveDate => [{ type: 'assertFixtureScope',
    effectiveDate, dateSelectors: ["[data-guide='property-effective-date'] input[type='date']"], timeoutMs: 2000 }];
  await runActions(page, gate('2027-07-01'), {}, {});
  assert.equal(selected.value, '2027-07-01');
  assert.equal(selected.writes, 1);
  await assert.rejects(runActions(page, gate('2026-07-01'), {}, {}), /outside .* allowed range 2027-01-01/);
  assert.equal(selected.writes, 1, 'out-of-range date must not be written');
});
