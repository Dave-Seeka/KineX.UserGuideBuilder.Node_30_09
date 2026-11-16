import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const browserSourceUrl = new URL('../src/lib/browser.mjs', import.meta.url);
const runnerSourceUrl = new URL('../src/lib/runner.mjs', import.meta.url);
const captureSourceUrl = new URL('../src/commands/capture.mjs', import.meta.url);

test('ArcGIS auth remains live in one capture tab instead of serializing GIS credentials', async () => {
  const source = await fs.readFile(browserSourceUrl, 'utf8');

  assert.doesNotMatch(source, /IdentityManager\.toJSON\(\)/);
  assert.doesNotMatch(source, /IdentityManager\.initialize\(/);
  assert.doesNotMatch(source, /restoreSessionStorage\(/);
  assert.match(source, /ArcGIS credentials are intentionally not serialized by Guide Builder/);
  assert.match(source, /waitForInteractiveWorkbench/);
  assert.match(source, /clickVisibleLoginControl/);
  assert.match(source, /advanceInteractivePortalLogin/);
  assert.match(source, /input\[type='email'\]/);
  assert.match(source, /KINEX_GUIDE_PORTAL_EMAIL/);
  assert.match(source, /proveMapInteractivity/);
});

test('capture flows reuse the authenticated Workbench page so ArcGIS tab state survives', async () => {
  const runner = await fs.readFile(runnerSourceUrl, 'utf8');
  const capture = await fs.readFile(captureSourceUrl, 'utf8');

  assert.match(runner, /const suppliedPage = args\.page \?\? null/);
  assert.match(runner, /const ownsPage = suppliedPage === null/);
  assert.match(capture, /page: session\.page/);
});
