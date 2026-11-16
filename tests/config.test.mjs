import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/lib/config.mjs';

test('loadConfig merges custom toast settings', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kinex-config-'));
  const configPath = path.join(root, 'config.json');
  await fs.writeFile(configPath, JSON.stringify({
    baseUrl: 'https://kinex.test:7004',
    map: {
      timeoutMs: 180000,
      settleMs: 12000
    },
    toast: {
      timeoutMs: 25000,
      selectors: ['[data-guide="notification-toast"]']
    },
    printGuide: {
      imageVariant: 'blank',
      includeContents: true
    },
    coverage: {
      profile: 'core',
      writeReport: false
    },
    mutations: {
      enabled: true,
      confirmation: 'ALLOW KINEX GUIDE MUTATIONS',
      testPrefix: 'GUIDE-QA'
    }
  }));

  const config = await loadConfig(configPath);
  assert.equal(config.map.timeoutMs, 180000);
  assert.deepEqual(config.viewports.laptop, { width: 1366, height: 768 });
  assert.equal(config.viewportAudit.enabled, true);
  assert.equal(config.viewportAudit.horizontalOverflowTolerance, 2);
  assert.equal(config.map.settleMs, 12000);
  assert.equal(config.map.readySelector, "[data-guide='map-tool-home']");
  assert.equal(config.portalLogin.authenticatedSelector, "[data-guide='orchard-workbench']");
  assert.equal(config.portalLogin.probeMapTimeoutMs, 30000);
  assert.equal(config.portalLogin.email, '');
  assert.equal(config.portalLogin.emailEnvironmentVariable, 'KINEX_GUIDE_PORTAL_EMAIL');
  assert.equal(config.toast.timeoutMs, 25000);
  assert.equal(config.toast.dismissTimeoutMs, 10000);
  assert.deepEqual(config.toast.selectors, ['[data-guide="notification-toast"]']);
  assert.equal(config.rateLimitCooldownMs, 30000);
  assert.equal(config.printGuide.enabled, true);
  assert.equal(config.printGuide.imageVariant, 'blank');
  assert.equal(config.printGuide.includeContents, true);
  assert.equal(config.printGuide.fileBaseName, 'guide-print');
  assert.equal(config.coverage.profile, 'core');
  assert.equal(config.coverage.writeReport, false);
  assert.equal(config.mutations.enabled, true);
  assert.equal(config.mutations.confirmation, 'ALLOW KINEX GUIDE MUTATIONS');
  assert.equal(config.mutations.testPrefix, 'GUIDE-QA');
});
