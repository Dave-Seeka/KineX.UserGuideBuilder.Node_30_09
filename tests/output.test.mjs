import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeCoverageReport, writeGuide } from '../src/lib/output.mjs';

test('writeGuide links the blank screenshot without embedding a second guide image', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kinex-output-'));
  await writeGuide({ id: 'overview', title: 'Overview' }, [{
    number: 1,
    heading: 'Open',
    instruction: 'Open the Workbench.',
    notes: [],
    checks: [],
    image: 'open.png',
    blankImage: 'open-blank.png',
    legend: [{ number: 1, label: 'Workbench', color: '#0058a4', textColor: '#ffffff' }]
  }], root, { skipPdf: true });

  const markdown = await fs.readFile(path.join(root, 'guide.md'), 'utf8');
  const html = await fs.readFile(path.join(root, 'guide.html'), 'utf8');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));

  assert.match(markdown, /\*\*Legend\*\*/);
  assert.match(markdown, /Workbench/);
  assert.match(markdown, /Open blank screenshot without guide annotations/);
  assert.match(html, /annotation-legend/);
  assert.match(html, /Workbench/);
  assert.match(html, /open-blank\.png/);
  assert.equal(manifest.steps[0].blankImage, 'open-blank.png');
  assert.equal(manifest.steps[0].legend[0].label, 'Workbench');
});


test('writeCoverageReport accounts for generated, gated and excluded flows', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kinex-coverage-'));
  const report = await writeCoverageReport([
    { id: 'a', title: 'Generated', status: 'generated', order: 1 },
    { id: 'b', title: 'Data gated', status: 'skipped', reason: 'No fixture.', order: 2 },
    { id: 'c', title: 'Not selected', status: 'excluded', reason: 'Profile.', order: 3 }
  ], root, { profile: 'full', captureScope: { country: 'NZ', crop: 'KIWIFRUIT', season: '2027' } });

  assert.equal(report.totalDefined, 3);
  assert.equal(report.totalSelected, 2);
  assert.equal(report.generatedPercent, 50);
  assert.equal(report.accountedPercent, 100);
  const markdown = await fs.readFile(path.join(root, 'coverage.md'), 'utf8');
  assert.match(markdown, /Accounted coverage: 100%/);
  assert.match(markdown, /AppSelection:.*NZ \/ KIWIFRUIT \/ 2027/);
  assert.equal(report.scope.season, '2027');
});
