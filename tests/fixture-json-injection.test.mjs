import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { fixtureEsriPolygon } from '../src/lib/fixture-e2e.mjs';
import { injectFixturePolygon } from '../src/lib/actions.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/block-hectares-pin-1285.json'), 'utf8'));
const actionSource = fs.readFileSync(path.join(root, 'src/lib/actions.mjs'), 'utf8').replace(/\r\n/g, '\n');

function realBrowserCompletion(state) {
  const match = actionSource.match(/async function resolveFixtureCaptureWithJson\([\s\S]+?\n}\n\nexport async function drawFixturePolygon/);
  assert.ok(match, 'the real injection callback must exist');
  const source = match[0].replace(/\n\nexport async function drawFixturePolygon$/, '')
    .replace("await import('/js/arcgis-map-state.js')", 'await stateLoader()');
  return vm.runInNewContext(`(${source})`, {
    stateLoader: async () => state,
    Map, Set, JSON, Array, String
  });
}

function makeState() {
  let payload;
  let disposed = 0;
  let completeWait;
  const completionPromise = new Promise(resolve => { completeWait = resolve; });
  const edit = {
    editId: 'capture-A', mode: 'capture', mapViewId: 'view-A', terminalIntent: null, captureVertexCount: 0,
    sketchViewModel: { activeTool: 'polygon' },
    completion: { isSettled: false, promise: completionPromise, resolve(value) { payload = value; this.isSettled = true; completeWait(value); } }
  };
  const state = {
    activeGeometryEdits: new Map([[edit.editId, edit]]),
    activeMapViews: new Map([['view-A', { view: { container: { isConnected: true } } }]])
  };
  const complete = realBrowserCompletion(state);
  const disposeByKineX = (id) => {
    assert.equal(id, 'capture-A'); disposed++; state.activeGeometryEdits.delete(id);
  };
  return {state, edit, complete, disposeByKineX, get payload() { return payload; }, get disposed() { return disposed; }};
}

test('fixture EsriJSON geometry closes each NZTM polygon without changing its location', () => {
  const paths = ['e2e.property.geometry', 'e2e.orchard.geometry',
    ...fixture.e2e.blocks.map((_, i) => `e2e.blocks.${i}.geometry`)];
  for (const geometryPath of paths) {
    const polygon = fixtureEsriPolygon(fixture, geometryPath, '20261029-fixture-test');
    assert.equal(polygon.spatialReference.wkid, 2193);
    assert.equal(polygon.rings.length, 1);
    const ring = polygon.rings[0];
    assert.deepEqual(ring[0], ring.at(-1));
    assert.ok(new Set(ring.map((p) => String(p))).size >= 3);
    assert.ok(ring.every(([x, y]) => x > 1887000 && x < 1897000 && y > 5803900 && y < 5814100));
  }
});

test('injection resolves current KineX capture session and leaves persistence to Workbench', async () => {
  const browser = makeState();
  const polygon = fixtureEsriPolygon(fixture, 'e2e.property.geometry', '20261029-fixture-test');
  const outcome = await browser.complete({ editId: 'capture-A', polygon });
  assert.equal(outcome.completed, true);
  assert.equal(browser.disposed, 0);
  assert.equal(browser.state.activeGeometryEdits.get('capture-A'), browser.edit);
  assert.equal(browser.payload.editId, 'capture-A');
  assert.equal(browser.payload.isCancelled, false);
  assert.deepEqual(JSON.parse(browser.payload.geometryJson), polygon);
  assert.equal(browser.payload.trimPreview, null);
});

test('KineX can attach a late waitForGeometryEditCompletion after JSON injection', async () => {
  const browser = makeState();
  const polygon = fixtureEsriPolygon(fixture, 'e2e.property.geometry', '20261029-fixture-test');
  const outcome = await browser.complete({ editId: 'capture-A', polygon });
  assert.equal(outcome.completed, true);

  // Reproduce the reported race: WorkbenchGeometryEditService's JS interop
  // call reaches waitForGeometryEditCompletion after the test resolves the
  // promise. A premature dispose would remove the entry and throw here.
  const lateEdit = browser.state.activeGeometryEdits.get('capture-A');
  assert.ok(lateEdit, 'completion must not remove the live edit before KineX awaits it');
  const completion = await lateEdit.completion.promise;
  assert.equal(completion.editId, 'capture-A');
  assert.deepEqual(JSON.parse(completion.geometryJson), polygon);
  assert.equal(browser.disposed, 0);

  // KineX's GeometryEditHandle finally owns disposal, not Guide Builder.
  browser.disposeByKineX('capture-A');
  assert.equal(browser.disposed, 1);
  assert.equal(browser.state.activeGeometryEdits.has('capture-A'), false);
});

test('injection refuses superseded, already settled or inactive captures', async () => {
  const polygon = fixtureEsriPolygon(fixture, 'e2e.property.geometry', '20261029-fixture-test');
  const browser = makeState();
  assert.equal((await browser.complete({editId: 'wrong', polygon})).completed, false);
  browser.edit.terminalIntent = 'cancel';
  assert.equal((await browser.complete({editId: 'capture-A', polygon})).completed, false);
  browser.edit.terminalIntent = null;
  browser.edit.sketchViewModel.activeTool = 'rectangle';
  assert.equal((await browser.complete({editId: 'capture-A', polygon})).completed, false);
  browser.edit.sketchViewModel.activeTool = 'polygon';
  browser.edit.captureVertexCount = 2;
  assert.equal((await browser.complete({editId: 'capture-A', polygon})).completed, false);
  assert.equal(browser.disposed, 0);
  assert.equal(browser.payload, undefined);
});

test('fixture action bypasses mouse events and does not click Done', async () => {
  const evaluated = [];
  let mouseUsed = false;
  const fakePage = {
    mouse: {click: async () => {mouseUsed = true;}},
    locator(selector) {
      assert.equal(selector, "[data-guide='geometry-task-panel']");
      return { first() { return {
        waitFor: async () => {}, textContent: async () => 'Draw Property',
        getAttribute: async () => 'Draw Property'
      }; } };
    },
    evaluate: async (callback, options) => {
      evaluated.push(callback.name);
      if (callback.name === 'inspectFixtureInjectionSession') return {ready: true, editId: 'capture-A'};
      if (callback.name === 'resolveFixtureCaptureWithJson') {
        assert.equal(options.editId, 'capture-A');
        assert.ok(options.polygon.rings[0].length > 3);
        return { completed: true, vertices: 5 };
      }
      throw new Error('unexpected evaluation');
    },
    waitForTimeout: async () => {}
  };
  const runtime = {runId: '20261029-fixture-test'};
  await injectFixturePolygon(fakePage, {
    type: 'injectFixturePolygon', fixture: path.join(root, 'fixtures/block-hectares-pin-1285.json'),
    geometryPath: 'e2e.property.geometry', after: 'settled', settleMs: 0
  }, {}, runtime);
  assert.deepEqual(evaluated, ['inspectFixtureInjectionSession', 'resolveFixtureCaptureWithJson']);
  assert.equal(mouseUsed, false);
  assert.equal(runtime.variables.fixtureGeometryMethod, 'esri-json-completion');
});
