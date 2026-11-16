import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldAutoWaitForMap, waitForMapReady } from '../src/lib/map-ready.mjs';

test('shouldAutoWaitForMap matches only the configured Workbench route', () => {
  const config = {
    baseUrl: 'https://kinex.test:7004',
    map: {
      autoWaitOnWorkbenchNavigation: true,
      workbenchPath: '/arcgis/orchard-workbench'
    }
  };

  assert.equal(
    shouldAutoWaitForMap('https://kinex.test:7004/arcgis/orchard-workbench', config),
    true
  );
  assert.equal(
    shouldAutoWaitForMap('https://kinex.test:7004/arcgis/orchard-workbench/details', config),
    true
  );
  assert.equal(
    shouldAutoWaitForMap('https://kinex.test:7004/dashboard', config),
    false
  );
  assert.equal(
    shouldAutoWaitForMap('https://kinex.test:7004/arcgis/orchard-workbench', {
      ...config,
      map: { ...config.map, autoWaitOnWorkbenchNavigation: false }
    }),
    false
  );
});

test('waitForMapReady requires an enabled map tool and a rendered ArcGIS surface', async () => {
  const waits = [];
  const elements = new Map([
    ["[data-guide='map-tool-home']", [element({ enabled: true, box: { width: 40, height: 40 } })]],
    ['.arcgis-map-view-container .esri-view-surface', [element({ box: { width: 900, height: 600 } })]],
    ['.arcgis-map-view-container .esri-view-surface canvas', [element({ box: { width: 900, height: 600 } })]],
    ['.arcgis-map-view-error', []]
  ]);

  const page = {
    locator(selector) {
      return collection(elements.get(selector) ?? []);
    },
    async waitForTimeout(ms) {
      waits.push(ms);
    }
  };

  const result = await waitForMapReady(page, { settleMs: 8000 }, {
    map: { timeoutMs: 120000, pollIntervalMs: 250 }
  });

  assert.equal(result.enabledReadyControls, 1);
  assert.equal(result.validSurfaces, 1);
  assert.equal(result.validCanvases, 1);
  assert.deepEqual(waits, [8000]);
});

function element({ visible = true, enabled = true, box = null, text = '' } = {}) {
  return {
    async isVisible() { return visible; },
    async isEnabled() { return enabled; },
    async boundingBox() { return box; },
    async innerText() { return text; }
  };
}

function collection(items) {
  return {
    async count() { return items.length; },
    nth(index) { return items[index] ?? element({ visible: false, enabled: false }); }
  };
}
