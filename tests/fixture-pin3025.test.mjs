import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { placedFixtureRing, fixturePlacementOffset, fixtureEsriPolygon } from '../src/lib/fixture-e2e.mjs';
import { assertFixtureTestWriteApproval, openFixtureOrchardNavigator } from '../src/lib/actions.mjs';
import { fixtureRunStepEntries } from '../src/lib/runner.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(fs.readFileSync(path.join(root,'fixtures/block-hectares-pin-3025.json'),'utf8'));
const flow = JSON.parse(fs.readFileSync(path.join(root,'flows/295-block-hectares-e2e-fixture.json'),'utf8'));

function signedArea(ring) {
  return ring.slice(1).reduce((sum,[x2,y2],i)=>sum + ring[i][0]*y2 - x2*ring[i][1],0)/2;
}

test('PIN3025 source geometry is fixed across run IDs, not translated at all', () => {
  for (const runId of ['first','second','20261030170100']) {
    assert.deepEqual(fixturePlacementOffset(fixture,runId),{x:0,y:0});
    const paths = ['e2e.property.geometry','e2e.orchard.geometry',
      ...fixture.e2e.blocks.map((_,i)=>`e2e.blocks.${i}.geometry`)];
    for (const geoPath of paths) {
      const source = geoPath.split('.').reduce((a,k)=>a[k],fixture);
      assert.deepEqual(placedFixtureRing(fixture,geoPath,runId),source);
      const polygon = fixtureEsriPolygon(fixture,geoPath,runId);
      assert.equal(polygon.spatialReference.wkid,2193);
      assert.ok(Math.abs(signedArea(polygon.rings[0]))>1);
    }
  }
  assert.equal(fixture.source.propertyGlobalId,'bf2f50b0-53ef-47f1-9eb9-2347417ea477');
  assert.deepEqual(fixture.e2e.blocks.map(b=>b.sourcePhysicalAreaId),['297807','297808','297809','297810']);
  assert.equal(fixture.e2e.orchard.authoritative,false);
});

test('PIN3025 write approval is required, even if called outside the preflight', () => {
  assert.throws(()=>assertFixtureTestWriteApproval(fixture,{}),/no approval for test writes/);
  assert.throws(()=>assertFixtureTestWriteApproval(fixture,{KINEX_PIN3025_TEST_WRITE_APPROVED:'true'}),/explicitly opt in/);
  assert.doesNotThrow(()=>assertFixtureTestWriteApproval(fixture,{KINEX_PIN3025_TEST_WRITE_APPROVED:'PIN3025-APPROVED-TEST'}));
});

test('PIN3025 flow uses fixed sourced geometry, names and manual hectares', () => {
  const text=JSON.stringify(flow);
  assert.doesNotMatch(text,/pin-1285\.json|PIN1285|PIN 1285/);
  assert.match(text,/pin-3025\.json/);
  assert.deepEqual(flow.steps[4].actions[0].blocks.map(b=>b.businessHectares),[.29,.61,1.5,.7]);
  assert.equal(flow.steps[0].actions[0].type,'preflightFixturePlacement');
});

test('verify-only selects Step 5 and does not run create/publish actions', () => {
  const steps=fixtureRunStepEntries(flow,true);
  assert.equal(steps.length,1);
  assert.equal(steps[0][0],4);
  assert.equal(steps[0][1].actions[0].type,'verifyBlockHectareFixture');
  assert.equal(fixtureRunStepEntries(flow,false).length,5);
});

function navigatorPage({businessFocus = false, mapFocus = false, initialView = 'Blocks',
  hasBack = true, noOrchardSearch = false} = {}) {
  const calls = [];
  let view = initialView;
  const controls = (selector) => ({
    first() { return this; },
    locator(childSelector) { return controls(`${selector} ${childSelector}`); },
    async isVisible() {
      if (selector.includes('business-focus-full-gis')) return businessFocus;
      if (selector.includes('workbench-focus-toggle')) return !businessFocus;
      if (selector.includes('back-to-orchards')) return !businessFocus && view === 'Blocks' && hasBack;
      if (selector.includes('block-navigator')) return !businessFocus && view === 'Blocks';
      if (selector.includes("button[role='tab']")) return !businessFocus && !mapFocus && view !== 'Blocks';
      if (selector.includes('orchard-search')) return !businessFocus && view === 'Orchards' && !noOrchardSearch;
      return false;
    },
    async getAttribute(key) {
      if (selector.includes('workbench-focus-toggle') && key === 'aria-pressed') return mapFocus?'true':'false';
      if (selector.includes('workbench-sidebar-column') && key === 'class') return 'resizable-workbench-grid__sidebar';
      return null;
    },
    async click() {
      calls.push(selector);
      if (selector.includes('business-focus-full-gis')) businessFocus = false;
      if (selector.includes('workbench-focus-toggle')) mapFocus = false;
      if (selector.includes('back-to-orchards')) view = 'Orchards';
      if (selector.includes("button[role='tab']")) view = 'Orchards';
    }
  });
  return { calls, page: {
    locator: controls,
    async waitForTimeout() { /* simulate reactive UI polling */ }
  } };
}

test('Orchard navigator exits business/map focus then uses the Orchards tab', async () => {
  const {page, calls} = navigatorPage({businessFocus:true,mapFocus:true,initialView:'Properties'});
  await openFixtureOrchardNavigator(page,1000);
  assert.equal(calls.length,3);
  assert.match(calls[0],/business-focus-full-gis/);
  assert.match(calls[1],/workbench-focus-toggle/);
  assert.match(calls[2],/Orchards/);
});

test('MultiBlock Blocks navigator uses Back to orchards because entity tabs are absent', async () => {
  const {page,calls} = navigatorPage({initialView:'Blocks'});
  await openFixtureOrchardNavigator(page,1000);
  assert.equal(calls.length,1);
  assert.match(calls[0],/back-to-orchards/);
});

test('already visible Orchard search needs no extra navigation', async () => {
  const {page,calls} = navigatorPage({initialView:'Orchards'});
  await openFixtureOrchardNavigator(page,1000);
  assert.deepEqual(calls,[]);
});

test('missing Blocks back button fails with actionable view diagnostics instead of a stale-tab timeout', async () => {
  const {page,calls} = navigatorPage({initialView:'Blocks',hasBack:false});
  await assert.rejects(openFixtureOrchardNavigator(page,40),/blockNavigatorVisible=true, backToOrchardsVisible=false, orchardTabVisible=false/);
  assert.deepEqual(calls,[]);
});
