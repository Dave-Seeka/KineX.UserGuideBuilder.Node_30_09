import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureDirectory, escapeHtml } from './utils.mjs';

export async function writeGuide(flow, completedSteps, outputDirectory, options = {}) {
  await ensureDirectory(outputDirectory);

  const markdown = buildMarkdown(flow, completedSteps);
  const html = buildHtml(flow, completedSteps);

  await fs.writeFile(path.join(outputDirectory, 'guide.md'), markdown, 'utf8');
  await fs.writeFile(path.join(outputDirectory, 'guide.html'), html, 'utf8');
  await fs.writeFile(
    path.join(outputDirectory, 'manifest.json'),
    JSON.stringify({
      id: flow.id,
      title: flow.title,
      description: flow.description ?? '',
      order: flow.order ?? null,
      category: flow.category ?? 'Orchard Workbench',
      safety: flow.safety ?? 'Non-destructive capture',
      prerequisites: flow.prerequisites ?? [],
      profiles: flow.profiles ?? ['full'],
      mutation: flow.mutation === true,
      coverage: flow.coverage ?? null,
      generatedAt: new Date().toISOString(),
      steps: completedSteps
    }, null, 2),
    'utf8'
  );

  if (!options.skipPdf) {
    await writePdf(
      path.join(outputDirectory, 'guide.html'),
      path.join(outputDirectory, 'guide.pdf')
    );
  }
}

export async function writeGuideIndex(entries, outputDirectory, options = {}) {
  await ensureDirectory(outputDirectory);
  const ordered = [...entries].sort((left, right) =>
    Number(left.order ?? 999) - Number(right.order ?? 999) ||
    String(left.title).localeCompare(String(right.title)));

  const manuals = options.manuals ?? [];
  const markdown = buildIndexMarkdown(ordered, manuals);
  const html = buildIndexHtml(ordered, manuals);
  await fs.writeFile(path.join(outputDirectory, 'index.md'), markdown, 'utf8');
  await fs.writeFile(path.join(outputDirectory, 'index.html'), html, 'utf8');
  await fs.writeFile(
    path.join(outputDirectory, 'capture-summary.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), profile: options.profile ?? null, guides: ordered, manuals }, null, 2),
    'utf8'
  );
}

function buildMarkdown(flow, steps) {
  const lines = [`# ${flow.title}`, ''];
  if (flow.description) lines.push(flow.description, '');
  if (flow.safety) lines.push(`**Capture safety:** ${flow.safety}`, '');
  if (flow.prerequisites?.length) {
    lines.push('## Before you start', '');
    for (const prerequisite of flow.prerequisites) lines.push(`- ${prerequisite}`);
    lines.push('');
  }

  for (const step of steps) {
    lines.push(`## ${step.number}. ${step.heading}`, '', step.instruction, '');
    if (step.notes?.length) {
      for (const note of step.notes) lines.push(`> ${note}`);
      lines.push('');
    }
    if (step.checks?.length) {
      lines.push('**Verified**', '');
      for (const check of step.checks) lines.push(`- ${check.label}: ${check.summary}`);
      lines.push('');
    }
    lines.push(`![${step.heading}](images/${step.image})`, '');
    appendMarkdownLegend(lines, step.legend);
    if (step.blankImage) {
      lines.push(`[Open blank screenshot without guide annotations](images/${step.blankImage})`, '');
    }
  }

  return `${lines.join('\n')}\n`;
}

function buildHtml(flow, steps) {
  const prerequisiteHtml = flow.prerequisites?.length
    ? `<section class="guide-prerequisites"><h2>Before you start</h2><ul>${flow.prerequisites.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>`
    : '';

  const stepHtml = steps.map((step) => `
    <section class="guide-step">
      <div class="step-heading"><span>${step.number}</span><h2>${escapeHtml(step.heading)}</h2></div>
      <p>${escapeHtml(step.instruction)}</p>
      ${(step.notes ?? []).map((note) => `<aside>${escapeHtml(note)}</aside>`).join('')}
      ${step.checks?.length ? `<div class="checks"><strong>Verified</strong><ul>${step.checks.map((check) => `<li><b>${escapeHtml(check.label)}:</b> ${escapeHtml(check.summary)}</li>`).join('')}</ul></div>` : ''}
      <figure><img src="images/${encodeURIComponent(step.image)}" alt="${escapeHtml(step.heading)}"><figcaption>Annotated screenshot</figcaption></figure>
      ${renderLegendHtml(step.legend)}
      ${step.blankImage ? `<p class="blank-link"><a href="images/${encodeURIComponent(step.blankImage)}" target="_blank" rel="noopener">Open blank screenshot without guide annotations</a></p>` : ''}
    </section>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(flow.title)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #172033; font-family: Inter, Arial, sans-serif; background: #eef2f6; }
  main { width: min(1320px, calc(100% - 40px)); margin: 28px auto; }
  header { padding: 28px 34px; border-radius: 14px; color: #fff; background: #17365d; }
  h1 { margin: 0; font-size: 34px; }
  header p { margin: 10px 0 0; opacity: .9; }
  header .safety { display: inline-block; margin-top: 14px; padding: 7px 10px; border-radius: 999px; color: #17365d; background: #dbeafe; font-weight: 700; }
  .guide-prerequisites, .guide-step { page-break-inside: avoid; margin: 22px 0; padding: 26px; border-radius: 14px; background: #fff; box-shadow: 0 5px 24px rgba(17, 31, 52, .08); }
  .guide-prerequisites h2 { margin-top: 0; }
  .step-heading { display: flex; align-items: center; gap: 12px; }
  .step-heading span { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; color: #fff; font-weight: 800; background: #d92d20; }
  h2 { margin: 0; font-size: 24px; }
  p, li { font-size: 16px; line-height: 1.55; }
  aside { margin: 12px 0; padding: 10px 14px; border-left: 4px solid #f59e0b; background: #fffbeb; }
  .checks { margin: 14px 0; padding: 12px 16px; border-left: 4px solid #15803d; background: #f0fdf4; }
  .checks ul { margin: 8px 0 0; padding-left: 22px; }
  figure { margin: 20px 0 0; }
  figcaption { margin-top: 8px; color: #64748b; font-size: 13px; text-align: center; }
  img { display: block; max-width: 100%; max-height: 690px; margin: auto; border: 1px solid #d8dee8; border-radius: 9px; object-fit: contain; }
  .annotation-legend { margin: 14px auto 0; max-width: 980px; padding: 12px 14px; border: 1px solid #d8dee8; border-radius: 9px; background: #f8fafc; }
  .annotation-legend > strong { display: block; margin-bottom: 8px; }
  .annotation-legend ol { display: flex; flex-wrap: wrap; gap: 8px 18px; margin: 0; padding: 0; list-style: none; }
  .annotation-legend li { display: flex; align-items: center; gap: 7px; min-width: 220px; font-size: 14px; line-height: 1.35; }
  .annotation-marker { display: inline-grid; place-items: center; min-width: 24px; height: 24px; padding: 0 6px; border: 2px solid #fff; border-radius: 999px; box-shadow: 0 1px 4px rgba(0,0,0,.2); font-size: 12px; font-weight: 800; }
  .blank-link { margin: 10px 0 0; text-align: center; }
  .blank-link a { color: #0058a4; font-weight: 700; }
  @media print { body { background: #fff; } main { width: 100%; margin: 0; } .guide-prerequisites, .guide-step { box-shadow: none; border: 1px solid #d8dee8; } }
</style>
</head>
<body><main><header><h1>${escapeHtml(flow.title)}</h1>${flow.description ? `<p>${escapeHtml(flow.description)}</p>` : ''}${flow.safety ? `<span class="safety">${escapeHtml(flow.safety)}</span>` : ''}</header>${prerequisiteHtml}${stepHtml}</main></body>
</html>`;
}


function appendMarkdownLegend(lines, legend) {
  if (!legend?.length) return;
  lines.push('**Legend**', '');
  for (const item of legend) {
    lines.push(`- **${item.number}.** ${item.label}`);
  }
  lines.push('');
}

function renderLegendHtml(legend) {
  if (!legend?.length) return '';
  return `<div class="annotation-legend" aria-label="Screenshot legend"><strong>Legend</strong><ol>${legend.map((item) => `<li><span class="annotation-marker" style="background:${legendColor(item.color, '#d92d20')};color:${legendColor(item.textColor, '#ffffff')}">${escapeHtml(String(item.number))}</span><span>${escapeHtml(item.label)}</span></li>`).join('')}</ol></div>`;
}

function legendColor(value, fallback) {
  const color = String(value ?? '').trim();
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : fallback;
}

function buildIndexMarkdown(entries, manuals = []) {
  const lines = ['# Orchard Workbench user guides', '', 'Generated from the Playwright flow suite.', ''];
  if (manuals.length) {
    lines.push('## Combined manuals', '');
    for (const manual of manuals) {
      lines.push(`- [${manual.title} - interactive](${manual.path}/guide.md) - ${manual.description ?? ''}`);
      if (manual.printMarkdownPath) lines.push(`- [${manual.title} - print layout](${manual.printMarkdownPath})`);
    }
    lines.push('');
  }
  const categories = groupBy(entries, (item) => item.category ?? 'Orchard Workbench');
  for (const [category, items] of categories) {
    lines.push(`## ${category}`, '');
    for (const item of items) {
      if (item.status === 'generated') {
        lines.push(`- [${item.title}](${item.id}/guide.md) — ${item.description ?? ''}`);
      } else {
        lines.push(`- **${item.title}** — ${item.status}: ${item.reason}`);
      }
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function buildIndexHtml(entries, manuals = []) {
  const categories = groupBy(entries, (item) => item.category ?? 'Orchard Workbench');
  const manualsHtml = manuals.length ? `<section><h2>Combined manuals</h2><div class="cards">${manuals.map((manual) => `<article class="card manual"><span>Combined guide</span><h3>${escapeHtml(manual.title)}</h3><p>${escapeHtml(manual.description ?? '')}</p><div class="manual-links"><a href="${escapeHtml(manual.path)}/guide.html">Interactive</a>${manual.printHtmlPath ? `<a href="${escapeHtml(manual.printHtmlPath)}">Print layout</a>` : ''}${manual.printPdfPath ? `<a href="${escapeHtml(manual.printPdfPath)}">Print PDF</a>` : ''}</div></article>`).join('')}</div></section>` : '';
  const categoryHtml = [...categories.entries()].map(([category, items]) => `
    <section>
      <h2>${escapeHtml(category)}</h2>
      <div class="cards">
        ${items.map((item) => item.status === 'generated'
          ? `<a class="card" href="${encodeURIComponent(item.id)}/guide.html"><span>Generated</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description ?? '')}</p></a>`
          : `<article class="card ${item.status}"><span>${escapeHtml(item.status)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.reason ?? '')}</p></article>`).join('')}
      </div>
    </section>`).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orchard Workbench user guides</title><style>
  *{box-sizing:border-box}body{margin:0;background:#eef2f6;color:#172033;font-family:Inter,Arial,sans-serif}main{width:min(1200px,calc(100% - 40px));margin:28px auto}header{background:#17365d;color:#fff;padding:30px;border-radius:14px}h1{margin:0}section{margin:30px 0}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}.card{display:block;padding:20px;border-radius:12px;background:#fff;color:inherit;text-decoration:none;box-shadow:0 5px 20px rgba(17,31,52,.08)}.card:hover{outline:3px solid #93c5fd}.card span{font-size:12px;font-weight:800;text-transform:uppercase;color:#0058a4}.card h3{margin:8px 0}.card p{margin:0;line-height:1.5}.card.skipped,.card.failed,.card.excluded{opacity:.72}.card.skipped span{color:#b45309}.card.failed span{color:#b42318}.card.excluded span{color:#64748b}.manual-links{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}.manual-links a{padding:8px 11px;border-radius:8px;background:#e8f1fb;color:#0058a4;font-weight:700;text-decoration:none}.manual-links a:hover{background:#dbeafe}
  </style></head><body><main><header><h1>Orchard Workbench user guides</h1><p>Screenshot guides generated from the KineX Playwright flow suite.</p></header>${manualsHtml}${categoryHtml}</main></body></html>`;
}

function groupBy(items, selector) {
  const groups = new Map();
  for (const item of items) {
    const key = selector(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}


export async function writeCoverageReport(entries, outputDirectory, options = {}) {
  await ensureDirectory(outputDirectory);
  const ordered = [...entries].sort((left, right) =>
    Number(left.order ?? 999) - Number(right.order ?? 999) ||
    String(left.title).localeCompare(String(right.title)));
  const profile = options.profile ?? 'full';
  const selected = ordered.filter((item) => item.status !== 'excluded');
  const counts = countStatuses(ordered);
  const selectedCounts = countStatuses(selected);
  const generatedPercent = selected.length === 0
    ? 0
    : Math.round((selectedCounts.generated / selected.length) * 100);
  const accountedPercent = selected.length === 0
    ? 0
    : Math.round(((selectedCounts.generated + selectedCounts.skipped) / selected.length) * 100);
  const report = {
    generatedAt: new Date().toISOString(),
    profile,
    scope: options.captureScope ?? null,
    totalDefined: ordered.length,
    totalSelected: selected.length,
    counts,
    selectedCounts,
    generatedPercent,
    accountedPercent,
    guides: ordered
  };
  await fs.writeFile(path.join(outputDirectory, 'coverage.json'), JSON.stringify(report, null, 2), 'utf8');
  await fs.writeFile(path.join(outputDirectory, 'coverage.md'), buildCoverageMarkdown(report), 'utf8');
  await fs.writeFile(path.join(outputDirectory, 'coverage.html'), buildCoverageHtml(report), 'utf8');
  return report;
}

function countStatuses(entries) {
  const counts = { generated: 0, skipped: 0, failed: 0, excluded: 0 };
  for (const entry of entries) {
    const key = entry.status in counts ? entry.status : 'failed';
    counts[key]++;
  }
  return counts;
}

function buildCoverageMarkdown(report) {
  const lines = [
    '# Orchard Workbench flow coverage', '',
    `**Profile:** ${report.profile}`,
    ...(report.scope ? [`**AppSelection:** ${report.scope.country} / ${report.scope.crop} / ${report.scope.season}`] : []), '',
    `- Defined flows: ${report.totalDefined}`,
    `- Selected flows: ${report.totalSelected}`,
    `- Generated: ${report.selectedCounts.generated}`,
    `- Data/permission gated: ${report.selectedCounts.skipped}`,
    `- Failed: ${report.selectedCounts.failed}`,
    `- Excluded by profile: ${report.counts.excluded}`,
    `- Generated coverage: ${report.generatedPercent}%`,
    `- Accounted coverage: ${report.accountedPercent}%`, '',
    '| Order | Flow | Category | Status | Reason |',
    '|---:|---|---|---|---|'
  ];
  for (const guide of report.guides) {
    lines.push(`| ${guide.order ?? ''} | ${escapeMarkdownCell(guide.title)} | ${escapeMarkdownCell(guide.category ?? '')} | ${guide.status} | ${escapeMarkdownCell(guide.reason ?? '')} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function buildCoverageHtml(report) {
  const rows = report.guides.map((guide) => `<tr class="${escapeHtml(guide.status)}"><td>${escapeHtml(guide.order ?? '')}</td><td>${escapeHtml(guide.title)}</td><td>${escapeHtml(guide.category ?? '')}</td><td>${escapeHtml(guide.status)}</td><td>${escapeHtml(guide.reason ?? '')}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orchard Workbench flow coverage</title><style>
  body{margin:0;background:#eef2f6;color:#172033;font-family:Inter,Arial,sans-serif}main{width:min(1200px,calc(100% - 40px));margin:28px auto}header,.panel{background:#fff;border-radius:14px;padding:24px;box-shadow:0 5px 20px rgba(17,31,52,.08)}header{background:#17365d;color:#fff}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:20px 0}.metric{background:#fff;border-radius:12px;padding:16px}.metric strong{display:block;font-size:28px}.panel{overflow:auto}table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid #d8dee8;text-align:left;vertical-align:top}.generated td:nth-child(4){color:#15803d}.skipped td:nth-child(4){color:#b45309}.failed td:nth-child(4){color:#b42318}.excluded{opacity:.65}
  </style></head><body><main><header><h1>Orchard Workbench flow coverage</h1><p>Profile: ${escapeHtml(report.profile)}</p>${report.scope ? `<p>AppSelection: ${escapeHtml(`${report.scope.country} / ${report.scope.crop} / ${report.scope.season}`)}</p>` : ''}</header><section class="metrics"><div class="metric"><span>Defined</span><strong>${report.totalDefined}</strong></div><div class="metric"><span>Selected</span><strong>${report.totalSelected}</strong></div><div class="metric"><span>Generated</span><strong>${report.selectedCounts.generated}</strong></div><div class="metric"><span>Accounted</span><strong>${report.accountedPercent}%</strong></div></section><section class="panel"><table><thead><tr><th>Order</th><th>Flow</th><th>Category</th><th>Status</th><th>Reason</th></tr></thead><tbody>${rows}</tbody></table></section></main></body></html>`;
}

function escapeMarkdownCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export async function writePdf(htmlPath, pdfPath, options = {}) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    await page.pdf({
      path: pdfPath,
      format: options.format ?? 'A4',
      landscape: options.landscape ?? true,
      printBackground: options.printBackground ?? true,
      preferCSSPageSize: options.preferCSSPageSize ?? true,
      margin: options.margin ?? { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
    });
  } finally {
    await browser.close();
  }
}
