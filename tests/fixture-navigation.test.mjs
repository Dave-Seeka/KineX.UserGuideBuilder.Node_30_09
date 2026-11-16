import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// Execute the real browser callback with a minimal MapView/ArcGIS SDK contract.
// Mock the module import only; do not replace goTo/toScreen implementation.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const actions = fs.readFileSync(path.join(root, 'src/lib/actions.mjs'), 'utf8').replace(/\r\n/g, '\n');
const match = actions.match(/async function prepareFixtureSketch\([\s\S]*?\n}\n\nasync function fixturePointerHitTest/);
assert.ok(match, 'browser drawing callback exists');
const source = match[0].replace(/\n\nasync function fixturePointerHitTest$/, '')
  .replace("await import('/js/arcgis-map-state.js')", 'await stateLoader()');

function makeBrowser({ wkid = 2193, ignoreExtentNavigation = false,
  ignorePointNavigation = false, corruptToScreen = false,
  withViewpoint = false, fatalAfterNavigation = false, mapClickEnabled = false } = {}) {
  const calls = [];
  class ArcPoint {
    constructor(options) { Object.assign(this, options); }
  }
  class ArcExtent {
    constructor(options) { Object.assign(this, options); }
    contains(p) {
      return p.x >= this.xmin && p.x <= this.xmax && p.y >= this.ymin && p.y <= this.ymax;
    }
  }
  class Element {}
  const rect = { left: 0, top: 0, right: 1134, bottom: 802, width: 1134, height: 802 };
  const surface = new Element();
  surface.getBoundingClientRect = () => rect;
  surface.matches = () => true;
  const hit = { tagName: 'CANVAS', className: '', closest: () => null };
  surface.contains = (element) => element === hit;
  surface.isConnected = true;
  const center = new ArcPoint({ x: 1660000, y: 5820000, spatialReference: { wkid } });
  const view = {
    container: surface, width: 1134, height: 802, scale: 18056, stationary: true,
    spatialReference: { wkid }, center,
    extent: new ArcExtent({ xmin: center.x - 2500, xmax: center.x + 2500,
      ymin: center.y - 2000, ymax: center.y + 2000 }),
    when: async () => {},
    viewpoint: withViewpoint ? { clone: () => ({savedInitial: true}) } : null,
    async goTo(target) {
      calls.push(target);
      if (target?.savedInitial) {
        this.center = center;
        this.extent = new ArcExtent({ xmin: center.x - 2500, xmax: center.x + 2500,
          ymin: center.y - 2000, ymax: center.y + 2000 });
        this.fatalError = null;
        return;
      }
      if (fatalAfterNavigation) this.fatalError = new Error('WebGL context lost');
      if (target instanceof ArcExtent) {
        if (ignoreExtentNavigation) return;
        this.center = new ArcPoint({ x: (target.xmin + target.xmax) / 2,
          y: (target.ymin + target.ymax) / 2 });
        this.extent = target;
      } else {
        assert.ok(target.target instanceof ArcPoint, 'fallback uses an ArcGIS Point');
        if (ignorePointNavigation) return;
        this.center = target.target;
        this.extent = new ArcExtent({ xmin: this.center.x - 3000,
          xmax: this.center.x + 3000, ymin: this.center.y - 3000, ymax: this.center.y + 3000 });
      }
    },
    toScreen(point) {
      assert.ok(point instanceof ArcPoint, 'MapView.toScreen must receive ArcGIS Point');
      if (corruptToScreen) return { x: -39381, y: -66006 };
      return { x: this.width / 2 + (point.x - this.center.x) / 10,
        y: this.height / 2 - (point.y - this.center.y) / 10 };
    }
  };
  const state = {
    activeMapViews: new Map([['map', {view, mapClickEnabled}]]),
    activeGeometryEdits: new Map([['edit', {editId:'edit', mapViewId:'map',
      mode:'capture', terminalIntent:null, captureVertexCount:0}]])
  };
  const projection = { load: async () => {},
    execute(point, reference) { return new ArcPoint({ x: point.x, y: point.y,
      spatialReference: reference }); } };
  const context = {
    HTMLElement: Element,
    stateLoader: async () => state,
    window: { innerWidth: 1440, innerHeight: 900,
      $arcgis: { import: async (modules) => modules.map((name) => {
        if (name.endsWith('Point.js')) return {default:ArcPoint};
        if (name.endsWith('Extent.js')) return {default:ArcExtent};
        if (name.endsWith('projectOperator.js')) return {default:projection};
        throw new Error(`Unexpected ArcGIS import ${name}`);
      }) } },
    document: {querySelector: () => ({contains: (element) => element === surface}),
      elementFromPoint: () => hit},
    setTimeout, Number, Math, Promise
  };
  const prepare = vm.runInNewContext(`(${source})`, context);
  return {prepare, view, calls, ArcPoint, ArcExtent};
}
const ring = [[1690800, 6114800], [1691000, 6114800], [1691000, 6115000], [1690800, 6115000]];

test('NZTM same-WKID fixture uses ArcGIS Point and Extent and lands on canvas', async () => {
  const browser = makeBrowser();
  const plan = await browser.prepare({ring, wkid:2193});
  assert.equal(plan.ready, true, plan.reason);
  assert.ok(browser.calls[0] instanceof browser.ArcExtent);
  assert.equal(plan.points.length, 4);
  assert.ok(plan.points.every((p) => p.x > 0 && p.x < 1134 && p.y > 0 && p.y < 802));
});

test('a superseded extent goTo falls back to explicit Point target', async () => {
  const browser = makeBrowser({ignoreExtentNavigation:true});
  const plan = await browser.prepare({ring, wkid:2193});
  assert.equal(plan.ready, true, plan.reason);
  assert.ok(browser.calls[1].target instanceof browser.ArcPoint);
});

test('an ignored Point goTo fails with actual and target map centers', async () => {
  const browser = makeBrowser({ignoreExtentNavigation:true, ignorePointNavigation:true});
  const plan = await browser.prepare({ring, wkid:2193});
  assert.equal(plan.ready, false);
  assert.match(plan.reason, /did not navigate to fixture/);
  assert.match(plan.reason, /actual center/);
  assert.match(plan.reason, /target center/);
  assert.equal(browser.calls.length, 2);
});

test('toScreen inconsistency is reported when map extent is already correct', async () => {
  const browser = makeBrowser({corruptToScreen:true});
  const plan = await browser.prepare({ring, wkid:2193});
  assert.equal(plan.ready, false);
  assert.match(plan.reason, /toScreen is inconsistent/);
});

test('fatal map rendering error aborts and restores original viewpoint', async () => {
  const browser = makeBrowser({withViewpoint:true, fatalAfterNavigation:true});
  const plan = await browser.prepare({ring, wkid:2193});
  assert.equal(plan.ready, false);
  assert.match(plan.reason, /WebGL context lost/);
  assert.equal(browser.calls.at(-1).savedInitial, true);
  assert.equal(browser.view.center.x, 1660000);
  assert.equal(browser.view.center.y, 5820000);
});


test('reject active KineX feature-selection click interception before drawing', async () => {
  const browser = makeBrowser({ mapClickEnabled: true });
  const plan = await browser.prepare({ring, wkid: 2193});
  assert.equal(plan.ready, false);
  assert.equal(plan.retryable, true);
  assert.match(plan.reason, /feature-selection click handler is still enabled/);
  assert.equal(browser.calls.length, 0, 'must not navigate until sketch can receive clicks');
});
