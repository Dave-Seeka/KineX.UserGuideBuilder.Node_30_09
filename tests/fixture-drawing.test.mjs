import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drawFixturePolygon } from '../src/lib/actions.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fakeDrawingPage({ loseVertex = null, blockClick = null, sketchMissing = false,
  delayEarlyCaptureCount = false, loseEveryVertex = false } = {}) {
  let committed = 0;
  let doneClicked = false;
  const pointerSequence = [];
  let pointerPosition = null;
  const locators = {
    "[data-guide='geometry-task-panel']": {
      waitFor: async () => {}, textContent: async () => 'Draw Property Shape',
      getAttribute: async () => 'Draw Property Shape'
    },
    "[data-guide='geometry-done'] button": {
      waitFor: async () => {}, isEnabled: async () => committed >= 3,
      click: async () => { doneClicked = true; }
    }
  };
  const page = {
    locator(selector) {
      if (selector === "[data-guide='workbench-map']") {
        return { first: () => ({ scrollIntoViewIfNeeded: async () => {} }) };
      }
      assert.ok(locators[selector], `Unexpected locator ${selector}`);
      return { first: () => locators[selector] };
    },
    evaluate: async (callback, argument) => {
      switch (callback.name) {
        case 'prepareFixtureSketch':
          return sketchMissing
            ? { ready: false, retryable: false, reason: 'no visible map canvas' }
            : { ready: true, editId: 'draw-1', vertexCount: 0,
              points: [{x:100,y:100},{x:180,y:100},{x:180,y:180}] };
        case 'fixturePointerHitTest':
          return blockClick === argument.x ? { valid:false, reason:'map toolbar overlays the vertex' }
            : { valid: true };
        case 'startFixturePointerProbe':
        case 'stopFixturePointerProbe':
          return undefined;
        case 'fixtureCaptureProgress':
          assert.equal(argument, 'draw-1');
          return { active:true, count:delayEarlyCaptureCount && committed < 3 ? 0 : committed,
            activeTool:'polygon', sketchState:'active', minimumVertices:3,
            geometryVertices:committed };
        default:
          throw new Error(`Unexpected evaluate callback ${callback.name}`);
      }
    },
    mouse: {
      move: async (x, y, options) => {
        assert.ok(options.steps > 1, 'Map pointer should move through intermediate positions');
        pointerPosition = { x, y };
        pointerSequence.push('move');
      },
      down: async ({ button }) => {
        assert.equal(button, 'left');
        assert.ok(pointerPosition, 'Pointer must move to the vertex before down');
        pointerSequence.push('down');
      },
      up: async ({ button }) => {
        assert.equal(button, 'left');
        pointerSequence.push('up');
        if (!loseEveryVertex && loseVertex !== pointerPosition.x) committed++;
      }
    },
    waitForTimeout: async () => {}
  };
  return { page, pointerSequence, get committed() { return committed; }, get doneClicked() { return doneClicked; } };
}

const action = {
  fixture: path.join(root, 'fixtures/block-hectares-pin-1285.json'),
  geometryPath: 'e2e.property.geometry',
  after: 'settled', settleMs: 0, vertexDelayMs: 0, vertexTimeoutMs: 30
};

const runtime = { runId: '20261029-drawing-test' };

test('fixture drawing commits vertices through clicks before using Done', async () => {
  const fake = fakeDrawingPage();
  await drawFixturePolygon(fake.page, action, {}, { ...runtime });
  assert.equal(fake.committed, 3);
  assert.equal(fake.doneClicked, true);
  assert.deepEqual(fake.pointerSequence, ['move', 'down', 'up', 'move', 'down', 'up', 'move', 'down', 'up']);
});

test('fixture drawing fails immediately when a vertex is under a toolbar', async () => {
  const fake = fakeDrawingPage({ blockClick: 180 });
  await assert.rejects(drawFixturePolygon(fake.page, action, {}, { ...runtime }),
    /Cannot click vertex 2\/3.*map toolbar overlays/);
  assert.equal(fake.committed, 1);
  assert.equal(fake.doneClicked, false);
});

test('fixture drawing fails when ArcGIS does not register a committed vertex', async () => {
  const fake = fakeDrawingPage({ loseVertex: 180 });
  await assert.rejects(drawFixturePolygon(fake.page, action, {}, { ...runtime }),
    /ArcGIS confirmed only 1\/3 vertices.*e2e\.property\.geometry/);
  assert.equal(fake.doneClicked, false);
});

test('fixture drawing refuses missing SketchViewModel instead of clicking the map', async () => {
  const fake = fakeDrawingPage({ sketchMissing: true });
  await assert.rejects(drawFixturePolygon(fake.page, action, {}, { ...runtime }),
    /Cannot draw.*no visible map canvas/);
  assert.equal(fake.committed, 0);
});


test('first two sketch clicks may report zero until polygon geometry becomes available', async () => {
  const fake = fakeDrawingPage({ delayEarlyCaptureCount: true });
  await drawFixturePolygon(fake.page, action, {}, { ...runtime });
  assert.equal(fake.committed, 3);
  assert.equal(fake.doneClicked, true);
});

test('zero captured vertices after three clicks still stops before Done with sketch diagnostics', async () => {
  const fake = fakeDrawingPage({ loseEveryVertex: true });
  await assert.rejects(drawFixturePolygon(fake.page, action, {}, { ...runtime }),
    /confirmed only 0\/3 vertices.*sketch state=active, tool=polygon, minimum=3/);
  assert.equal(fake.doneClicked, false);
});


test('drawing refuses to accept missed clicks and does not retry ambiguous vertices', async () => {
  const fake = fakeDrawingPage({ loseEveryVertex: true });
  await assert.rejects(drawFixturePolygon(fake.page, action, {}, { ...runtime }),
    /confirmed only 0\/3 vertices.*pointer down\/up=/);
  assert.equal(fake.pointerSequence.filter(event => event === 'down').length, 3);
  assert.equal(fake.doneClicked, false);
});
