import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { ensureDirectory, escapeHtml } from './utils.mjs';
import { writePdf } from './output.mjs';
import { listCollectionFiles, loadCollection } from './collection-loader.mjs';
import { coverageProfileFor, normalizeProfile } from './profiles.mjs';

export async function joinCollections(config, collectionsDirectory, options = {}) {
  const files = await listCollectionFiles(collectionsDirectory);
  const manuals = [];
  for (const file of files) {
    const { collection } = await loadCollection(file);
    if (!collectionMatchesProfile(collection, options.profile)) {
      continue;
    }
    manuals.push(await joinCollection(config, collection, options));
  }
  return manuals;
}


function collectionMatchesProfile(collection, profile) {
  const normalizedProfile = normalizeProfile(profile ?? 'full');
  const coverageProfile = coverageProfileFor(normalizedProfile);
  const profiles = Array.isArray(collection.profiles) && collection.profiles.length > 0
    ? collection.profiles.map((item) => String(item).trim().toLowerCase())
    : ['full', 'all'];
  return coverageProfile === 'all' || profiles.includes(coverageProfile) || profiles.includes('all');
}

export async function joinCollection(config, collection, options = {}) {
  const outputRoot = config.outputDir;
  const destination = path.join(outputRoot, 'combined', collection.id);
  const staging = path.join(outputRoot, '.staging', `combined-${collection.id}-${process.pid}-${Date.now()}`);
  const imagesRoot = path.join(staging, 'images');
  await fs.rm(destination, { recursive: true, force: true });
  await fs.rm(staging, { recursive: true, force: true });
  await ensureDirectory(imagesRoot);

  const summary = await readCaptureSummary(outputRoot);
  const statusById = new Map((summary?.guides ?? []).map((item) => [item.id, item]));
  const guideIds = collection.guides?.length
    ? collection.guides
    : (summary?.guides ?? []).filter((item) => item.status === 'generated').map((item) => item.id);

  const chapters = [];
  const omitted = [];
  let continuousStep = 1;

  for (const guideId of guideIds) {
    const status = statusById.get(guideId);
    const manifestPath = path.join(outputRoot, guideId, 'manifest.json');
    let manifest;
    try {
      manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      omitted.push({
        id: guideId,
        title: status?.title ?? guideId,
        status: status?.status ?? 'missing',
        reason: status?.reason ?? 'No generated guide manifest was found.'
      });
      if (collection.strict === true) {
        throw new Error(`Collection '${collection.title}' requires guide '${guideId}', but it was not generated.`);
      }
      continue;
    }

    const chapterNumber = chapters.length + 1;
    const chapterImages = path.join(imagesRoot, guideId);
    await ensureDirectory(chapterImages);
    const steps = [];

    for (const sourceStep of manifest.steps ?? []) {
      const sourceImage = path.join(outputRoot, guideId, 'images', sourceStep.image);
      const targetImage = path.join(chapterImages, sourceStep.image);
      await fs.copyFile(sourceImage, targetImage);

      let blankImagePath = null;
      if (sourceStep.blankImage) {
        const sourceBlankImage = path.join(outputRoot, guideId, 'images', sourceStep.blankImage);
        const targetBlankImage = path.join(chapterImages, sourceStep.blankImage);
        await fs.copyFile(sourceBlankImage, targetBlankImage);
        blankImagePath = `images/${guideId}/${sourceStep.blankImage}`;
      }

      const number = collection.numbering === 'per-guide'
        ? `${chapterNumber}.${sourceStep.number}`
        : continuousStep++;
      steps.push({
        ...sourceStep,
        number,
        imagePath: `images/${guideId}/${sourceStep.image}`,
        blankImagePath
      });
    }

    chapters.push({
      ...manifest,
      chapterNumber,
      steps
    });
  }

  const printGuide = normalizePrintGuide(config.printGuide);
  const model = {
    id: collection.id,
    title: collection.title,
    description: collection.description ?? '',
    audience: collection.audience ?? '',
    version: collection.version ?? '',
    generatedAt: new Date().toISOString(),
    numbering: collection.numbering ?? 'continuous',
    chapters,
    omitted,
    outputs: {
      interactive: {
        html: 'guide.html',
        markdown: 'guide.md',
        pdf: options.noPdf ? null : 'guide.pdf'
      },
      print: printGuide.enabled ? {
        html: `${printGuide.fileBaseName}.html`,
        markdown: `${printGuide.fileBaseName}.md`,
        pdf: options.noPdf ? null : `${printGuide.fileBaseName}.pdf`,
        imageVariant: printGuide.imageVariant
      } : null
    }
  };

  await fs.writeFile(path.join(staging, 'guide.md'), buildMarkdown(model), 'utf8');
  await fs.writeFile(path.join(staging, 'guide.html'), buildHtml(model), 'utf8');

  if (printGuide.enabled) {
    await fs.writeFile(
      path.join(staging, `${printGuide.fileBaseName}.md`),
      buildPrintMarkdown(model, printGuide),
      'utf8'
    );
    await fs.writeFile(
      path.join(staging, `${printGuide.fileBaseName}.html`),
      buildPrintHtml(model, printGuide),
      'utf8'
    );
  }

  await fs.writeFile(path.join(staging, 'manifest.json'), JSON.stringify(model, null, 2), 'utf8');

  if (!options.noPdf) {
    await writePdf(path.join(staging, 'guide.html'), path.join(staging, 'guide.pdf'));
    if (printGuide.enabled) {
      await writePdf(
        path.join(staging, `${printGuide.fileBaseName}.html`),
        path.join(staging, `${printGuide.fileBaseName}.pdf`),
        {
          landscape: false,
          margin: { top: '0', right: '0', bottom: '0', left: '0' }
        }
      );
    }
  }

  await ensureDirectory(path.dirname(destination));
  await fs.rename(staging, destination);

  return {
    id: collection.id,
    title: collection.title,
    description: collection.description ?? '',
    path: `combined/${collection.id}`,
    chapterCount: chapters.length,
    omittedCount: omitted.length,
    printHtmlPath: printGuide.enabled
      ? `combined/${collection.id}/${printGuide.fileBaseName}.html`
      : null,
    printMarkdownPath: printGuide.enabled
      ? `combined/${collection.id}/${printGuide.fileBaseName}.md`
      : null,
    printPdfPath: printGuide.enabled && !options.noPdf
      ? `combined/${collection.id}/${printGuide.fileBaseName}.pdf`
      : null
  };
}

async function readCaptureSummary(outputRoot) {
  try {
    return JSON.parse(await fs.readFile(path.join(outputRoot, 'capture-summary.json'), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function normalizePrintGuide(value = {}) {
  const fileBaseName = /^[a-z0-9][a-z0-9._-]*$/i.test(String(value.fileBaseName ?? 'guide-print'))
    ? String(value.fileBaseName ?? 'guide-print')
    : 'guide-print';
  return {
    enabled: value.enabled !== false,
    fileBaseName,
    imageVariant: value.imageVariant === 'blank' ? 'blank' : 'annotated',
    includeContents: value.includeContents === true,
    includeCoverageNotes: value.includeCoverageNotes === true,
    includePrerequisites: value.includePrerequisites !== false,
    includeSafety: value.includeSafety === true
  };
}

function buildMarkdown(model) {
  const lines = [`# ${model.title}`, ''];
  if (model.description) lines.push(model.description, '');
  if (model.audience) lines.push(`**Audience:** ${model.audience}`, '');
  if (model.version) lines.push(`**Version:** ${model.version}`, '');
  lines.push('## Contents', '');
  for (const chapter of model.chapters) lines.push(`${chapter.chapterNumber}. [${chapter.title}](#${anchor(chapter.title)})`);
  lines.push('');

  for (const chapter of model.chapters) {
    lines.push(`# ${chapter.chapterNumber}. ${chapter.title}`, '');
    if (chapter.description) lines.push(chapter.description, '');
    if (chapter.prerequisites?.length) {
      lines.push('## Before you start', '');
      for (const item of chapter.prerequisites) lines.push(`- ${item}`);
      lines.push('');
    }
    for (const step of chapter.steps) {
      lines.push(`## ${step.number}. ${step.heading}`, '', step.instruction, '');
      for (const note of step.notes ?? []) lines.push(`> ${note}`);
      if (step.notes?.length) lines.push('');
      if (step.checks?.length) {
        lines.push('**Verified**', '');
        for (const check of step.checks) lines.push(`- ${check.label}: ${check.summary}`);
        lines.push('');
      }
      lines.push(`![${step.heading}](${step.imagePath})`, '');
      appendMarkdownLegend(lines, step.legend);
      if (step.blankImagePath) {
        lines.push(`[Open blank screenshot without guide annotations](${step.blankImagePath})`, '');
      }
    }
  }

  if (model.omitted.length) {
    lines.push('# Coverage notes', '');
    for (const item of model.omitted) lines.push(`- **${item.title}** - ${item.status}: ${item.reason}`);
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function buildPrintMarkdown(model, settings) {
  const lines = [`# ${model.title}`, ''];
  if (model.description) lines.push(model.description, '');
  if (model.audience) lines.push(`**Audience:** ${model.audience}`, '');
  if (model.version) lines.push(`**Version:** ${model.version}`, '');

  if (settings.includeContents) {
    lines.push('## Contents', '');
    for (const chapter of model.chapters) lines.push(`${chapter.chapterNumber}. ${chapter.title}`);
    lines.push('');
  }

  for (const chapter of model.chapters) {
    lines.push(`## ${chapter.title}`, '');
    if (chapter.description) lines.push(chapter.description, '');
    if (settings.includeSafety && chapter.safety) lines.push(`> Alert! ${chapter.safety}`, '');
    if (settings.includePrerequisites && chapter.prerequisites?.length) {
      lines.push('> Tip! Before you start:', '');
      for (const item of chapter.prerequisites) lines.push(`> - ${item}`);
      lines.push('');
    }

    for (const step of chapter.steps) {
      lines.push(`${step.number}. **${step.heading}:** ${step.instruction}`, '');
      for (const note of step.notes ?? []) lines.push(`> ${note}`);
      if (step.notes?.length) lines.push('');
      const imagePath = printImagePath(step, settings.imageVariant);
      lines.push(`![${step.heading}](${imagePath})`, '');
      if (settings.imageVariant !== 'blank') {
        appendMarkdownLegend(lines, step.legend);
      }
    }
  }

  if (settings.includeCoverageNotes && model.omitted.length) {
    lines.push('## Guide coverage', '');
    for (const item of model.omitted) lines.push(`- **${item.title}** - ${item.status}: ${item.reason}`);
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function buildHtml(model) {
  const contents = model.chapters.map((chapter) => `<li><a href="#chapter-${chapter.chapterNumber}">${chapter.chapterNumber}. ${escapeHtml(chapter.title)}</a></li>`).join('');
  const chapters = model.chapters.map((chapter) => `
    <section class="chapter" id="chapter-${chapter.chapterNumber}">
      <header class="chapter-header"><span>Chapter ${chapter.chapterNumber}</span><h1>${escapeHtml(chapter.title)}</h1>${chapter.description ? `<p>${escapeHtml(chapter.description)}</p>` : ''}</header>
      ${chapter.prerequisites?.length ? `<section class="prerequisites"><h2>Before you start</h2><ul>${chapter.prerequisites.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>` : ''}
      ${chapter.steps.map((step) => `
        <section class="step">
          <div class="step-heading"><span>${escapeHtml(step.number)}</span><h2>${escapeHtml(step.heading)}</h2></div>
          <p>${escapeHtml(step.instruction)}</p>
          ${(step.notes ?? []).map((note) => `<aside>${escapeHtml(note)}</aside>`).join('')}
          ${step.checks?.length ? `<div class="checks"><strong>Verified</strong><ul>${step.checks.map((check) => `<li><b>${escapeHtml(check.label)}:</b> ${escapeHtml(check.summary)}</li>`).join('')}</ul></div>` : ''}
          <figure><img src="${encodePath(step.imagePath)}" alt="${escapeHtml(step.heading)}"><figcaption>Annotated screenshot</figcaption></figure>
          ${renderLegendHtml(step.legend)}
          ${step.blankImagePath ? `<p class="blank-link"><a href="${encodePath(step.blankImagePath)}" target="_blank" rel="noopener">Open blank screenshot without guide annotations</a></p>` : ''}
        </section>`).join('')}
    </section>`).join('');
  const omitted = model.omitted.length ? `<section class="coverage"><h1>Coverage notes</h1><ul>${model.omitted.map((item) => `<li><b>${escapeHtml(item.title)}</b> - ${escapeHtml(item.status)}: ${escapeHtml(item.reason)}</li>`).join('')}</ul></section>` : '';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(model.title)}</title><style>
  @page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#eef2f6;color:#172033;font-family:Inter,Arial,sans-serif}main{width:min(1320px,calc(100% - 40px));margin:28px auto}.cover{min-height:520px;display:flex;flex-direction:column;justify-content:center;padding:54px;border-radius:16px;background:#17365d;color:#fff;page-break-after:always}.cover h1{font-size:46px;margin:0 0 16px}.cover p{font-size:20px;max-width:850px;line-height:1.5}.meta{display:flex;gap:20px;margin-top:24px;opacity:.9}.contents,.coverage,.prerequisites,.step{margin:22px 0;padding:26px;border-radius:14px;background:#fff;box-shadow:0 5px 24px rgba(17,31,52,.08)}.contents{page-break-after:always}.contents li{margin:10px 0}.contents a{color:#0058a4;text-decoration:none}.chapter{page-break-before:always}.chapter-header{padding:28px 34px;border-radius:14px;background:#17365d;color:#fff}.chapter-header span{font-size:13px;font-weight:800;text-transform:uppercase;opacity:.8}.chapter-header h1{margin:8px 0 0}.chapter-header p{margin-bottom:0;opacity:.9}.step{page-break-inside:avoid}.step-heading{display:flex;align-items:center;gap:12px}.step-heading>span{display:grid;place-items:center;min-width:38px;height:38px;padding:0 8px;border-radius:20px;background:#d92d20;color:#fff;font-weight:800}.step h2{margin:0}.step p,.step li,.coverage li{font-size:16px;line-height:1.55}aside{margin:12px 0;padding:10px 14px;border-left:4px solid #f59e0b;background:#fffbeb}.checks{margin:14px 0;padding:12px 16px;border-left:4px solid #15803d;background:#f0fdf4}.checks ul{margin:8px 0 0;padding-left:22px}figure{margin:20px 0 0}figcaption{margin-top:8px;color:#64748b;font-size:13px;text-align:center}img{display:block;max-width:100%;max-height:680px;margin:auto;border:1px solid #d8dee8;border-radius:9px;object-fit:contain}.annotation-legend{margin:14px auto 0;max-width:980px;padding:12px 14px;border:1px solid #d8dee8;border-radius:9px;background:#f8fafc}.annotation-legend>strong{display:block;margin-bottom:8px}.annotation-legend ol{display:flex;flex-wrap:wrap;gap:8px 18px;margin:0;padding:0;list-style:none}.annotation-legend li{display:flex;align-items:center;gap:7px;min-width:220px;font-size:14px;line-height:1.35}.annotation-marker{display:inline-grid;place-items:center;min-width:24px;height:24px;padding:0 6px;border:2px solid #fff;border-radius:999px;box-shadow:0 1px 4px rgba(0,0,0,.2);font-size:12px;font-weight:800}.blank-link{margin:10px 0 0;text-align:center}.blank-link a{color:#0058a4;font-weight:700}@media print{body{background:#fff}main{width:100%;margin:0}.contents,.coverage,.prerequisites,.step{box-shadow:none;border:1px solid #d8dee8}.chapter-header,.cover{print-color-adjust:exact}}
  </style></head><body><main><section class="cover"><h1>${escapeHtml(model.title)}</h1>${model.description ? `<p>${escapeHtml(model.description)}</p>` : ''}<div class="meta">${model.audience ? `<span>Audience: ${escapeHtml(model.audience)}</span>` : ''}${model.version ? `<span>Version: ${escapeHtml(model.version)}</span>` : ''}<span>${model.chapters.length} chapters</span></div></section><section class="contents"><h1>Contents</h1><ol>${contents}</ol></section>${chapters}${omitted}</main></body></html>`;
}


function appendMarkdownLegend(lines, legend) {
  if (!legend?.length) return;
  lines.push('**Legend**', '');
  for (const item of legend) {
    lines.push(`- **${item.number}.** ${item.label}`);
  }
  lines.push('');
}

function renderLegendHtml(legend, cssClass = 'annotation-legend') {
  if (!legend?.length) return '';
  return `<div class="${cssClass}" aria-label="Screenshot legend"><strong>Legend</strong><ol>${legend.map((item) => `<li><span class="annotation-marker" style="background:${legendColor(item.color, '#d92d20')};color:${legendColor(item.textColor, '#ffffff')}">${escapeHtml(String(item.number))}</span><span>${escapeHtml(item.label)}</span></li>`).join('')}</ol></div>`;
}

function legendColor(value, fallback) {
  const color = String(value ?? '').trim();
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : fallback;
}

function buildPrintHtml(model, settings) {
  const contents = settings.includeContents
    ? `<section class="print-contents"><h2>Contents</h2><ol>${model.chapters.map((chapter) => `<li>${chapter.chapterNumber}. ${escapeHtml(chapter.title)}</li>`).join('')}</ol></section>`
    : '';
  const chapters = model.chapters.map((chapter, index) => `
    <section class="print-chapter${index === 0 ? ' first' : ''}">
      <header class="print-chapter-header">
        <h2>${escapeHtml(chapter.title)}</h2>
        ${chapter.description ? `<p>${escapeHtml(chapter.description)}</p>` : ''}
      </header>
      ${settings.includeSafety && chapter.safety ? `<aside class="callout alert"><strong>Alert!</strong> ${escapeHtml(chapter.safety)}</aside>` : ''}
      ${settings.includePrerequisites && chapter.prerequisites?.length ? `<aside class="callout tip"><strong>Tip! Before you start.</strong><ul>${chapter.prerequisites.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></aside>` : ''}
      ${chapter.steps.map((step) => `
        <section class="print-step">
          <p class="print-step-copy"><span class="print-step-number">${escapeHtml(step.number)}.</span><span><strong>${escapeHtml(step.heading)}:</strong> ${escapeHtml(step.instruction)}</span></p>
          ${(step.notes ?? []).map((note) => renderPrintNote(note)).join('')}
          <figure><img src="${encodePath(printImagePath(step, settings.imageVariant))}" alt="${escapeHtml(step.heading)}"></figure>
          ${settings.imageVariant !== 'blank' ? renderLegendHtml(step.legend, 'print-annotation-legend') : ''}
        </section>`).join('')}
    </section>`).join('');
  const coverage = settings.includeCoverageNotes && model.omitted.length
    ? `<section class="print-coverage"><h2>Guide coverage</h2><ul>${model.omitted.map((item) => `<li><strong>${escapeHtml(item.title)}</strong> - ${escapeHtml(item.status)}: ${escapeHtml(item.reason)}</li>`).join('')}</ul></section>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(model.title)} - Print guide</title>
<style>
  @page { size: A4 portrait; margin: 13mm 15mm 14mm; }
  * { box-sizing: border-box; }
  html { background: #fff; }
  body { margin: 0; color: #202124; background: #fff; font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.42; }
  main { width: 100%; }
  .print-document-header { margin: 0 0 7mm; }
  .print-kicker { margin: 0 0 2mm; color: #303030; font-size: 10pt; }
  .print-document-header h1 { margin: 0 0 4mm; color: #161616; font-size: 17pt; line-height: 1.2; text-align: center; }
  .print-document-header p { max-width: 172mm; margin: 0 auto 2mm; text-align: left; }
  .print-meta { display: flex; gap: 7mm; margin-top: 3mm; color: #555; font-size: 8.5pt; }
  .print-contents { break-after: page; }
  .print-contents h2, .print-chapter-header h2, .print-coverage h2 { margin: 0 0 3mm; font-size: 13pt; text-align: center; }
  .print-contents li { margin: 1.5mm 0; }
  .print-chapter { margin: 0; }
  .print-chapter:not(.first) { break-before: page; }
  .print-chapter-header { margin: 0 0 4mm; break-after: avoid; }
  .print-chapter-header p { margin: 0 0 3mm; }
  .print-step { margin: 0 0 7mm; break-inside: avoid; }
  .print-step-copy { display: grid; grid-template-columns: 9mm 1fr; column-gap: 1mm; margin: 0 0 3mm; }
  .print-step-number { font-weight: 700; }
  figure { margin: 0; text-align: center; }
  figure img { display: block; width: auto; max-width: 76%; max-height: 108mm; margin: 0 auto; object-fit: contain; }
  .print-annotation-legend { display: flex; flex-wrap: wrap; gap: 1.5mm 5mm; width: 76%; margin: 2.5mm auto 0; padding: 2mm 2.5mm; border: .25mm solid #d8dee8; border-radius: 2mm; background: #f8fafc; }
  .print-annotation-legend > strong { width: 100%; font-size: 8.5pt; }
  .print-annotation-legend ol { display: contents; list-style: none; }
  .print-annotation-legend li { display: flex; align-items: center; gap: 1.5mm; font-size: 8pt; }
  .print-annotation-legend .annotation-marker { display: inline-grid; place-items: center; min-width: 5.5mm; height: 5.5mm; padding: 0 1mm; border: .5mm solid #fff; border-radius: 999px; font-size: 7.5pt; font-weight: 700; }
  .callout { margin: 3mm 0 5mm; padding: 2.5mm 3.5mm; break-inside: avoid; border-left: 1.5mm solid #f59e0b; }
  .callout p { margin: 0; }
  .callout ul { margin: 1.5mm 0 0 5mm; padding: 0; }
  .callout.tip { border-color: #84cc16; background: #f1f9d4; }
  .callout.alert { border-color: #db2777; background: #fde7f2; }
  .callout.note { border-color: #f59e0b; background: #fff7d6; }
  .print-coverage { break-before: page; }
  .print-coverage li { margin: 2mm 0; }
  @media screen {
    body { background: #e5e7eb; }
    main { width: 210mm; min-height: 297mm; margin: 12mm auto; padding: 13mm 15mm 14mm; background: #fff; box-shadow: 0 4px 24px rgba(0,0,0,.16); }
  }
  @media print {
    body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  }
</style>
</head>
<body><main>
  <header class="print-document-header">
    <p class="print-kicker">Orchard Workbench</p>
    <h1>${escapeHtml(model.title)}</h1>
    ${model.description ? `<p>${escapeHtml(model.description)}</p>` : ''}
    <div class="print-meta">${model.audience ? `<span>Audience: ${escapeHtml(model.audience)}</span>` : ''}${model.version ? `<span>Version: ${escapeHtml(model.version)}</span>` : ''}</div>
  </header>
  ${contents}
  ${chapters}
  ${coverage}
</main></body></html>`;
}

function renderPrintNote(note) {
  const value = String(note ?? '').trim();
  const lower = value.toLowerCase();
  const kind = lower.startsWith('tip')
    ? 'tip'
    : (lower.startsWith('alert') || lower.startsWith('warning'))
      ? 'alert'
      : 'note';
  return `<aside class="callout ${kind}"><p>${escapeHtml(value)}</p></aside>`;
}

function printImagePath(step, imageVariant) {
  if (imageVariant === 'blank' && step.blankImagePath) return step.blankImagePath;
  return step.imagePath;
}

function encodePath(value) {
  return String(value).split('/').map(encodeURIComponent).join('/');
}

function anchor(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
