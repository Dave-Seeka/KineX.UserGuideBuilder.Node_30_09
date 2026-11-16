import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { joinCollection, joinCollections } from '../src/lib/join.mjs';

test('joinCollection builds a standalone manual with continuous numbering and coverage notes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kinex-guide-'));
  const outputDir = path.join(root, 'output');
  const guideDir = path.join(outputDir, 'overview');
  await fs.mkdir(path.join(guideDir, 'images'), { recursive: true });
  await fs.writeFile(path.join(guideDir, 'images', 'one.png'), 'image');
  await fs.writeFile(path.join(guideDir, 'images', 'one-blank.png'), 'blank image');
  await fs.writeFile(path.join(guideDir, 'manifest.json'), JSON.stringify({
    id: 'overview',
    title: 'Overview',
    description: 'Overview guide',
    steps: [{ number: 1, heading: 'Open', instruction: 'Open it.', notes: [], checks: [{ label: 'Visible', summary: 'Workbench visible' }], image: 'one.png', blankImage: 'one-blank.png', legend: [{ number: 1, label: 'Workbench', color: '#0058a4', textColor: '#ffffff' }] }]
  }));
  await fs.writeFile(path.join(outputDir, 'capture-summary.json'), JSON.stringify({
    guides: [
      { id: 'overview', title: 'Overview', status: 'generated' },
      { id: 'missing', title: 'Missing guide', status: 'skipped', reason: 'No Block data.' }
    ]
  }));

  const manual = await joinCollection(
    { outputDir },
    { id: 'manual', title: 'Manual', numbering: 'continuous', guides: ['overview', 'missing'] },
    { noPdf: true }
  );

  assert.equal(manual.chapterCount, 1);
  assert.equal(manual.omittedCount, 1);
  const manifest = JSON.parse(await fs.readFile(path.join(outputDir, 'combined', 'manual', 'manifest.json'), 'utf8'));
  assert.equal(manifest.chapters[0].steps[0].number, 1);
  assert.equal(manifest.chapters[0].steps[0].blankImagePath, 'images/overview/one-blank.png');
  assert.equal(manifest.omitted[0].reason, 'No Block data.');
  const markdown = await fs.readFile(path.join(outputDir, 'combined', 'manual', 'guide.md'), 'utf8');
  assert.match(markdown, /Verified/);
  assert.match(markdown, /\*\*Legend\*\*/);
  assert.match(markdown, /Workbench/);
  assert.match(markdown, /Coverage notes/);
  assert.match(markdown, /Open blank screenshot without guide annotations/);
  await fs.access(path.join(outputDir, 'combined', 'manual', 'images', 'overview', 'one-blank.png'));
  const printMarkdown = await fs.readFile(path.join(outputDir, 'combined', 'manual', 'guide-print.md'), 'utf8');
  const printHtml = await fs.readFile(path.join(outputDir, 'combined', 'manual', 'guide-print.html'), 'utf8');
  assert.doesNotMatch(printMarkdown, /Verified/);
  assert.doesNotMatch(printHtml, /Open blank screenshot/);
  assert.match(printHtml, /A4 portrait/);
  assert.match(printHtml, /1\.<\/span>/);
  assert.match(printHtml, /images\/overview\/one\.png/);
  assert.match(printHtml, /print-annotation-legend/);
  assert.match(printHtml, /Workbench/);
});


test('joinCollections only builds manuals for the active profile', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kinex-collection-profile-'));
  const outputDir = path.join(root, 'output');
  const collectionsDir = path.join(root, 'collections');
  await fs.mkdir(collectionsDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, 'capture-summary.json'), JSON.stringify({ guides: [] }));
  await fs.writeFile(path.join(collectionsDir, 'safe.json'), JSON.stringify({
    id: 'safe', title: 'Safe manual', guides: [], profiles: ['full', 'core']
  }));
  await fs.writeFile(path.join(collectionsDir, 'mutation.json'), JSON.stringify({
    id: 'mutation', title: 'Mutation manual', guides: [], profiles: ['mutation']
  }));

  const manuals = await joinCollections(
    { outputDir, printGuide: { enabled: false } },
    collectionsDir,
    { noPdf: true, profile: 'full' }
  );

  assert.deepEqual(manuals.map((item) => item.id), ['safe']);
  await fs.access(path.join(outputDir, 'combined', 'safe', 'manifest.json'));
  await assert.rejects(fs.access(path.join(outputDir, 'combined', 'mutation', 'manifest.json')));

  await fs.rm(path.join(outputDir, 'combined'), { recursive: true, force: true });
  const laptopManuals = await joinCollections(
    { outputDir, printGuide: { enabled: false } },
    collectionsDir,
    { noPdf: true, profile: 'laptop' }
  );
  assert.deepEqual(laptopManuals.map((item) => item.id), ['safe']);

  await fs.rm(path.join(outputDir, 'combined'), { recursive: true, force: true });
  const laptopMutationManuals = await joinCollections(
    { outputDir, printGuide: { enabled: false } },
    collectionsDir,
    { noPdf: true, profile: 'laptop-mutation' }
  );
  assert.deepEqual(laptopMutationManuals.map((item) => item.id), ['mutation']);
});
