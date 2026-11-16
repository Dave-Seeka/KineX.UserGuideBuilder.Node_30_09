import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMaTestHost } from '../src/lib/actions.mjs';
import { validateFlow } from '../src/lib/flow-loader.mjs';
import { mutationsAllowed, flowExclusionReason } from '../src/lib/profiles.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readFlow = async (filename) => JSON.parse(await fs.readFile(path.join(root, 'flows', filename), 'utf8'));
const allActions = (flow) => flow.steps.flatMap((step) => step.actions ?? []);

const code = "[data-guide='maturity-area-code'] input";
const truck = "[data-guide='maturity-area-truck-access']";
const grower = "[data-guide='maturity-area-grower-supply']";
const date = "[data-guide='maturity-area-effective-date'] input[type='date']:not(:disabled)";

test('MA test-host restriction excludes production and includes the KineX test deployment', () => {
  for (const host of ['localhost', '127.0.0.1', 'kinextest.seeka.co.nz', 'kinex.test']) assert.equal(isMaTestHost(host), true, host);
  for (const host of ['kinex.seeka.co.nz','seeka.co.nz','example.com','mytest.seeka.co.nz','']) assert.equal(isMaTestHost(host), false, host);
});

test('MA review and validation flows never submit and cancel their create drawer', async () => {
  for (const file of ['124-create-maturity-area.json', '125-create-maturity-area-required-fields.json']) {
    const flow = await readFlow(file);
    validateFlow(flow, file);
    assert.equal(flow.mutation, false);
    assert.equal(allActions(flow).some((action) => action.locator?.selector === "[data-guide='create-submit-action'] button" && action.type === 'click'), false);
    assert.ok(flow.cleanupActions.some((action) => action.locator?.selector === "[data-guide='create-cancel-action'] button"));
  }
});

test('MA creation review covers both required references and a temporal date guard before Blocks', async () => {
  const flow = await readFlow('124-create-maturity-area.json');
  const actions = allActions(flow);
  const codeAction = actions.find((a) => a.type === 'fill' && a.locator?.selector === code);
  assert.equal(codeAction.value, 'UG{{runId}}');
  assert.ok(actions.some((a) => a.type === 'selectFirstOption' && a.locator?.selector === truck));
  assert.ok(actions.some((a) => a.type === 'selectFirstOption' && a.locator?.selector === grower));
  assert.ok(actions.some((a) => a.type === 'require' && a.locator?.selector === date));
  assert.ok(actions.some((a) => a.locator?.selector === "[data-guide='ma-review-step']"));
});

test('real MA create flow is isolated, checked, and ordered after guide Block creation', async () => {
  const flow = await readFlow('335-mutation-create-maturity-area.json');
  validateFlow(flow, 'MA mutation');
  assert.equal(flow.mutation, true);
  assert.deepEqual(flow.profiles, ['ma-create']);
  assert.equal(flow.standalone, true);
  assert.match(flowExclusionReason(flow, 'mutation', {mutations:{enabled:true,confirmation:'ALLOW KINEX GUIDE MUTATIONS'}}), /Standalone mutation/);
  assert.match(flowExclusionReason(flow, 'all', {mutations:{enabled:true,confirmation:'ALLOW KINEX GUIDE MUTATIONS'}}), /Standalone mutation/);
  assert.ok(!mutationsAllowed({mutations:{enabled:false}}));
  const actions = allActions(flow);
  const scope = actions.filter((a) => a.type === 'assertMaMutationScope');
  assert.equal(scope.length, 1);
  assert.equal(scope[0].expectedParentText, '{{mutations.testPrefix}} Orchard');
  const submissionIndex = actions.findIndex((a) => a.type === 'click' && a.locator?.selector === "[data-guide='create-submit-action'] button");
  assert.ok(submissionIndex > 0);
  assert.ok(actions.slice(0,submissionIndex).some((a) => a.locator?.selector === truck));
  assert.ok(actions.slice(0,submissionIndex).some((a) => a.locator?.selector === grower));
  assert.ok(actions.slice(0,submissionIndex).some((a) => a.locator?.selector === date));
  assert.ok(actions.slice(0,submissionIndex).some((a) => a.locator?.selector?.includes('Assign Block ')));
  assert.ok(actions.slice(0,submissionIndex).some((a) => a.locator?.selector === "[data-guide='ma-review-step']"));
  assert.ok(actions.slice(submissionIndex+1).some((a) => a.locator?.selector?.includes("data-guide-entity='maturity area'")));
});
