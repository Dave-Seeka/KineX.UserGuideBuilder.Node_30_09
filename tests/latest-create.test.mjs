import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFlow } from '../src/lib/flow-loader.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flowRoot = path.join(root, 'flows', 'latest-create');

async function load(file) {
  return JSON.parse(await fs.readFile(path.join(flowRoot, file), 'utf8'));
}

test('latest create regression flows are valid and non-destructive', async () => {
  for (const file of [
    '010-create-drawer-lifecycle.json',
    '020-property-temporal-policy.json',
    '030-orchard-dual-temporal-policy.json'
  ]) {
    const flow = await load(file);
    assert.doesNotThrow(() => validateFlow(flow, file));
    assert.equal(flow.mutation, false, file);
    assert.equal(JSON.stringify(flow).includes('create-submit-action'), false, file);
  }
});

test('drawer lifecycle regression verifies cancel, hidden state and clean reopen', async () => {
  const flow = await load('010-create-drawer-lifecycle.json');
  const serialized = JSON.stringify(flow);

  assert.match(serialized, /create-back-action/);
  assert.match(serialized, /entity-create-drawer/);
  assert.match(serialized, /property-selected/);
  assert.match(serialized, /Reopened at step one/);
});

test('Property regression captures and compares temporal attributes without crop UI', async () => {
  const flow = await load('020-property-temporal-policy.json');
  const actions = flow.steps.flatMap((step) => step.actions ?? []);
  const checks = flow.steps.flatMap((step) => step.checks ?? []);

  assert.equal(actions.filter((action) => action.type === 'rememberAttribute').length, 2);
  assert.equal(checks.some((check) =>
    check.type === 'assertCount' && check.label === 'Property flow has no crop selector'), true);
  assert.equal(checks.some((check) =>
    check.type === 'assertAttribute' && check.exact === '{{propertyMin}}'), true);
});

test('Orchard regression keeps Property and Orchard temporal contexts separate', async () => {
  const flow = await load('030-orchard-dual-temporal-policy.json');
  const serialized = JSON.stringify(flow);

  assert.match(serialized, /newPropertyMin/);
  assert.match(serialized, /orchardMin/);
  assert.match(serialized, /Property date was not replaced by Orchard date/);
  assert.match(serialized, /Crop remains an Orchard requirement/);
});
