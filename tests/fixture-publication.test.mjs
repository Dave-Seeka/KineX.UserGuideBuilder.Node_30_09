import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFixturePublication, linkedSpatialStatus } from '../src/lib/fixture-publication.mjs';
const linked = {
  classes: 'workbench-business-form__spatial workbench-business-form__spatial--linked',
  label: 'Map: this record is linked to an ArcGIS feature.'
};
test('pending Property panel or pre-creation parent prerequisite cannot count as publication', () => {
  const base={entity:'property',nextEntity:'orchard',taskLabel:'Draw Property Shape'};
  assert.equal(classifyFixturePublication(base).ok, false);
  assert.equal(classifyFixturePublication({...base, taskLabel:'Draw Orchard Shape',parentPrerequisite:'Parent boundary required first'}).ok,false);
  assert.equal(classifyFixturePublication({...base,choiceLabel:'Add boundary for Orchard', parentBlocked:true}).ok,false);
});
test('only a server-advanced Orchard task or verified linked-parent choice proves Property stage', () => {
  assert.equal(classifyFixturePublication({entity:'property', nextEntity:'orchard',taskLabel:'Draw Orchard Shape'}).ok,true);
  assert.equal(classifyFixturePublication({entity:'property', nextEntity:'orchard',choiceLabel:'Add boundary for Orchard'}).ok,false);
  assert.equal(classifyFixturePublication({entity:'property', nextEntity:'orchard',choiceLabel:'Add boundary for Orchard',parentReady:true}).ok,true);
});
test('Orchard and Block require a linked status on the correct selected entity', () => {
  assert.equal(linkedSpatialStatus(linked),true);
  assert.equal(linkedSpatialStatus({ ...linked, classes:'workbench-business-form__spatial--pending' }),false);
  assert.equal(classifyFixturePublication({entity:'orchard',formEntity:'property',spatialClasses:linked.classes,spatialLabel:linked.label}).ok,false);
  assert.equal(classifyFixturePublication({entity:'orchard',formEntity:'orchard',spatialClasses:linked.classes,spatialLabel:linked.label}).ok,true);
  assert.equal(classifyFixturePublication({entity:'block',formEntity:'block',spatialClasses:'workbench-business-form__spatial--pending'}).ok,false);
});
test('persistent header linked indicator also proves linkage outside Overview tab', () => {
  assert.equal(classifyFixturePublication({entity:'orchard',formEntity:'orchard',headerLinked:true}).ok,true);
});
test('map errors must stop publication checkpoint even when selection is linked', () => {
  const state={entity:'orchard',formEntity:'orchard',spatialClasses:linked.classes,spatialLabel:linked.label,error:'Geometry save failed'};
  assert.deepEqual(classifyFixturePublication(state).fatal,true);
});

import { assertFixtureGeometryPublished } from '../src/lib/actions.mjs';

test('Property publish action waits for the correct successor, then records checkpoint', async () => {
  const samples = [
    { taskLabel:'Draw Property Shape' },
    { taskLabel:'Draw Orchard Shape', parentPrerequisite:'' }
  ];
  const runtime = {};
  const page = {
    evaluate: async () => samples.shift() ?? {taskLabel:'Draw Orchard Shape'},
    waitForTimeout: async () => {}
  };
  await assertFixtureGeometryPublished(page, {entity:'property', nextEntity:'orchard', timeoutMs:500}, runtime);
  assert.equal(runtime.geometryCheckpoints.length, 1);
  assert.equal(runtime.geometryCheckpoints[0].entity, 'property');
});

test('Orchard publish action rejects a Property business form and a map error', async () => {
  const page = {
    evaluate: async () => ({formEntity:'property',error:'Publish failed'}),
    waitForTimeout: async () => {}
  };
  await assert.rejects(() => assertFixtureGeometryPublished(page, {entity:'orchard'}, {}), /Publish failed/);
});
