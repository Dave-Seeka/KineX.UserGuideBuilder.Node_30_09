import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dropdownFeedbackWaitMs, runActions } from '../src/lib/actions.mjs';
import { shouldAutoWaitForMap } from '../src/lib/map-ready.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flow = JSON.parse(await fs.readFile(path.join(root, 'flows/295-block-hectares-e2e-fixture.json'), 'utf8'));

test('fixture uses one explicit map readiness check after navigation, with short settle', () => {
  const actions = flow.steps[0].actions;
  const goto = actions.find((a) => a.type === 'goto');
  const readyChecks = actions.filter((a) => a.type === 'waitForMapReady');
  assert.equal(goto.waitForMapReady, false);
  assert.equal(readyChecks.length, 2);
  assert.ok(readyChecks.every((a) => a.settleMs === 1500 && a.timeoutMs >= 120000));
  assert.equal(shouldAutoWaitForMap('https://kinex.test:7004/arcgis/orchard-workbench', { map: { autoWaitOnWorkbenchNavigation:true } }), true);
});

test('routine form deadlines are shorter, while backend transitions retain their existing budgets', () => {
  const formActions = [flow.steps[0], flow.steps[2]].flatMap((s) => s.actions);
  assert.ok(formActions.filter((a) => ['fill', 'selectOptionByAliases', 'selectOption', 'selectFirstOption'].includes(a.type)).length > 15);
  assert.ok(formActions.filter((a) => ['fill', 'selectOptionByAliases', 'selectOption', 'selectFirstOption'].includes(a.type))
    .every((a) => !a.timeoutMs || a.timeoutMs <= 12000));
  const injectionActions = [flow.steps[1], flow.steps[3]].flatMap((s) => s.actions).filter((a) => a.type === 'injectFixturePolygon');
  assert.ok(injectionActions.length === 6 && injectionActions.every((a) => a.timeoutMs === 120000));
  assert.ok(formActions.filter((a) => a.type === 'waitForEnabled').some((a) => a.timeoutMs === 30000));
});

test('advisory dropdown value feedback cannot consume the entire form timeout', () => {
  assert.equal(dropdownFeedbackWaitMs(30000), 1200);
  assert.equal(dropdownFeedbackWaitMs(20000), 1200);
  assert.equal(dropdownFeedbackWaitMs(800), 800);
});

test('fixture slow-action log never includes typed form content', async () => {
  const original = Date.now;
  let time = 0;
  Date.now = () => time;
  const warnings = [];
  const oldWarn = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    const input = {
      count: async () => 1,
      nth() { return this; },
      isVisible: async () => true,
      isEnabled: async () => true,
      fill: async () => { time += 2500; },
    };
    const page = { locator: () => input };
    await runActions(page, [{ type: 'fill', locator: { selector: "[data-guide='orchard-name'] input" }, value: 'SECRET-DO-NOT-LOG' }], { defaultTimeoutMs: 10000 }, { flowId: 'block-hectares-e2e-fixture' });
  } finally {
    console.warn = oldWarn;
    Date.now = original;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Slow fixture action 1: fill \[data-guide=orchard-name\] \(2500ms\)/);
  assert.doesNotMatch(warnings[0], /SECRET-DO-NOT-LOG/);
});
