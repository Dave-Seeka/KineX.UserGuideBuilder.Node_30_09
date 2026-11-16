import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/lib/config.mjs';
import { validateFlows } from '../src/commands/validate.mjs';
import { captureAll } from '../src/commands/capture.mjs';
import { parseArgs } from '../src/lib/args.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const configPath = path.resolve(root, args.config ?? './config.json');
const flowsDirectory = path.resolve(root, './flows/latest-create');
const collectionsDirectory = path.resolve(root, './collections/latest-create');

const config = await loadConfig(configPath);
config.outputDir = path.resolve(root, './output/latest-create-regression');
config.collectionsDir = collectionsDirectory;
config.continueOnFlowError = false;
config.coverage = {
  ...config.coverage,
  profile: 'full',
  writeReport: true
};

await validateFlows(flowsDirectory, collectionsDirectory);
await captureAll(config, flowsDirectory, {
  profile: 'full',
  collections: collectionsDirectory,
  headed: args.headed === true,
  noPdf: args.noPdf === true,
  keepOpen: args.keepOpen === true
});
