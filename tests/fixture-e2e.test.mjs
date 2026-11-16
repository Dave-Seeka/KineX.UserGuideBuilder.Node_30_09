import test from 'node:test';
import assert from 'node:assert/strict';
import { detectGeometryTransition, matchesFixtureBatchTask, fixtureRunOffset, fixturePlacementOffset, placedFixtureRing } from '../src/lib/fixture-e2e.mjs';
import { buildFixturePin, awaitFixtureGeometryTransition } from '../src/lib/actions.mjs';

test('old geometry panel cannot satisfy next task even while still visible', () => {
  const old = {
    after:'choice-or-task', taskVisible:true, choiceVisible:false,
    currentText:'Draw Property Shape', previousText:'Draw Property Shape',
    currentLabel:'Draw Property Shape', previousLabel:'Draw Property Shape',
    nextDoneDisabled:true, expectedNextEntity:'Orchard'
  };
  assert.equal(detectGeometryTransition(old), 'pending');
  assert.equal(detectGeometryTransition({...old, currentText:'Publishing Property...'}), 'pending');
  assert.equal(detectGeometryTransition({...old, currentText:'Draw Orchard Shape', currentLabel:'Draw Orchard Shape'}), 'ready');
  assert.equal(detectGeometryTransition({...old, currentText:'Draw Orchard Shape', currentLabel:'Draw Orchard Shape', nextDoneDisabled:false}), 'pending');
});

test('geometry completion requires closed geometry task and no choice', () => {
  assert.equal(detectGeometryTransition({after:'complete', taskVisible:true, choiceVisible:false}), 'pending');
  assert.equal(detectGeometryTransition({after:'complete', taskVisible:false, choiceVisible:true}), 'pending');
  assert.equal(detectGeometryTransition({after:'complete', taskVisible:false, choiceVisible:false}), 'complete');
});

test('MultiBlock successor requires correct ordinal and a fresh capture, not disabled Done', () => {
  const prior = { after:'next-geometry', taskVisible:true, choiceVisible:false,
    previousText:'Drawing Block boundaries Block 1 of 4 Draw PIN1285-E2E-1',
    currentText:'Drawing Block boundaries Block 1 of 4 Draw PIN1285-E2E-1',
    nextDoneDisabled:false, expectedNextBlockNumber:2, batchSize:4,
    successorSessionReady:true };
  assert.equal(detectGeometryTransition(prior), 'pending');
  const successor = { ...prior, currentText:'Drawing Block boundaries\n  BLK-0002 · PIN1285-E2E-2 Block 2 of 4Draw the boundary' };
  assert.equal(detectGeometryTransition(successor), 'ready');
  assert.equal(detectGeometryTransition({...successor,successorSessionReady:false}), 'pending');
  assert.equal(detectGeometryTransition({...successor,expectedNextBlockNumber:3}), 'pending');
  assert.equal(detectGeometryTransition({...successor,choiceVisible:true,taskVisible:false}), 'pending');
  assert.equal(detectGeometryTransition({...successor,currentText:'Block 2 of 40Draw'}), 'pending');
});

test('batch ordinal matching recognises KineX panel concatenated status and excludes other Blocks', () => {
  assert.equal(matchesFixtureBatchTask('Block 2 of 4Draw the boundary', 2, 4), true);
  assert.equal(matchesFixtureBatchTask('Drawing Block boundaries Block 3 of 4', 2, 4), false);
  assert.equal(matchesFixtureBatchTask('Block 20 of 40', 2, 4), false);
  assert.equal(matchesFixtureBatchTask('Block 2 of 4', 0, 4), false);
});

test('next Block transition succeeds with a distinct live session even when Done is enabled', async () => {
  const panelText = 'Drawing Block boundaries BLK-0002 · PIN1285-E2E-2 Block 2 of 4Draw the boundary';
  const page = {
    locator(selector) {
      return {
        first() { return this; },
        async isVisible() { return selector.includes('geometry-task-panel'); },
        async textContent() { return panelText; },
        async getAttribute() { return 'Drawing Block boundaries'; },
        async isEnabled() { throw new Error('The Done button must not be queried for MultiBlock'); }
      };
    },
    async evaluate() { return { ready: true, editId: 'new-capture-id' }; },
    async waitForTimeout() { throw new Error('Successor should be accepted without polling'); }
  };
  await awaitFixtureGeometryTransition(page, {
    after: 'next-geometry', geometryPath:'e2e.blocks.0.geometry', timeoutMs:300,
    priorPanelText:'Drawing Block boundaries BLK-0001 · PIN1285-E2E-1 Block 1 of 4',
    priorPanelLabel:'Drawing Block boundaries', expectedNextBlockNumber:2, batchSize:4,
    completedEditId:'old-capture-id'
  });
});

test('next Block transition cannot accept the previous capture session', async () => {
  const panelText = 'Drawing Block boundaries BLK-0002 · PIN1285-E2E-2 Block 2 of 4Draw the boundary';
  const page = {
    locator(selector) {
      return {
        first() { return this; },
        async isVisible() { return selector.includes('geometry-task-panel'); },
        async textContent() { return panelText; },
        async getAttribute() { return 'Drawing Block boundaries'; },
        async isEnabled() { return true; }
      };
    },
    async evaluate() { return { ready: true, editId: 'old-capture-id' }; },
    async waitForTimeout() {}
  };
  await assert.rejects(awaitFixtureGeometryTransition(page, {
    after: 'next-geometry', geometryPath:'e2e.blocks.0.geometry', timeoutMs:5,
    priorPanelText:'Drawing Block boundaries BLK-0001 · PIN1285-E2E-1 Block 1 of 4',
    priorPanelLabel:'Drawing Block boundaries', expectedNextBlockNumber:2, batchSize:4,
    completedEditId:'old-capture-id'
  }), /waiting for distinct capture session/);
});

test('run-specific shape translation is deterministic across one run and varies across runs', () => {
  const a=fixtureRunOffset('20261029130501');
  assert.deepEqual(a, fixtureRunOffset('20261029130501'));
  assert.notDeepEqual(a, fixtureRunOffset('20261029130502'));
  assert.equal(a.x % 1300, 0);
  assert.equal(a.y % 1300, 0);
  assert.ok(Math.abs(a.x) <= 3900);
  assert.ok(Math.abs(a.y) <= 3900);
});

test('fixture Kiwifruit PIN candidates are 4-char and retry candidates differ', () => {
  const one=buildFixturePin('B','abcd1234efff',4);
  const two=buildFixturePin('B','aaaa1234efff',4);
  assert.match(one,/^B[A-Z0-9]{3}$/);
  assert.match(two,/^B[A-Z0-9]{3}$/);
  assert.notEqual(one,two);
});

import { parseDisplayedHectares } from '../src/lib/actions.mjs';

test('parse hectares from KineX field display', () => {
  assert.equal(parseDisplayedHectares('3.0000 ha'), 3);
  assert.equal(parseDisplayedHectares('2.6500'), 2.65);
  assert.equal(parseDisplayedHectares('—'), null);
});

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const fixture = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..',
  'fixtures/block-hectares-pin-1285.json'), 'utf8'));

function area(ring) {
  return Math.abs(ring.slice(1).reduce((total, point, index) =>
    total + ring[index][0] * point[1] - point[0] * ring[index][1], 0) / 2);
}

test('all six polygons land in the bounded Te Puke region with unchanged area', () => {
  const paths = ['e2e.property.geometry', 'e2e.orchard.geometry',
    ...fixture.e2e.blocks.map((_, index) => `e2e.blocks.${index}.geometry`)];
  const offset = fixturePlacementOffset(fixture, '20261029130501');
  assert.ok(offset.x > 190000 && offset.y < -290000, 'Northland to Te Puke displacement');
  for (const geometryPath of paths) {
    const source = geometryPath.split('.').reduce((p, part) => p[part], fixture);
    const placed = placedFixtureRing(fixture, geometryPath, '20261029130501');
    assert.equal(placed.length, source.length);
    assert.ok(Math.abs(area(source) - area(placed)) < 0.02, `${geometryPath}: preserved planar area`);
    for (let i = 0; i < placed.length; i++) {
      assert.ok(Math.abs((placed[i][0] - source[i][0]) - offset.x) < 0.00001);
      assert.ok(Math.abs((placed[i][1] - source[i][1]) - offset.y) < 0.00001);
    }
  }
});

test('fixture location guard prevents invalid overseas/off-region navigation', () => {
  const bad = structuredClone(fixture);
  bad.e2e.targetPlacement.x = 1600000;
  assert.throws(() => placedFixtureRing(bad, 'e2e.property.geometry', 'one'),
    /outside the permitted fixture extent/);
});
