import path from 'node:path';
import { joinCollections } from '../lib/join.mjs';
import { writeGuideIndex } from '../lib/output.mjs';

export async function joinGuides(config, collectionsDirectory, args = {}) {
  const profile = String(args.profile ?? config.coverage?.profile ?? 'full').trim().toLowerCase();
  const manuals = await joinCollections(config, path.resolve(collectionsDirectory), {
    noPdf: Boolean(args.noPdf),
    profile
  });

  let guides = [];
  try {
    const summary = await import('node:fs/promises').then((fs) => fs.readFile(path.join(config.outputDir, 'capture-summary.json'), 'utf8'));
    guides = JSON.parse(summary).guides ?? [];
  } catch {
    // Joining can still succeed when only guide manifests are present.
  }

  await writeGuideIndex(guides, config.outputDir, { manuals });
  for (const manual of manuals) {
    console.log(`Combined guide generated: ${path.join(config.outputDir, manual.path)}`);
  }
  return manuals;
}
