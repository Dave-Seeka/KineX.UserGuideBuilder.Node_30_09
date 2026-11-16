#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { parseArgs, printHelp } from './lib/args.mjs';

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  const args = parseArgs(rest);

  if (command === 'validate') {
    const { validateFlows } = await import('./commands/validate.mjs');
    await validateFlows(args.flows ?? './flows', args.collections ?? './collections');
    return;
  }

  const { loadConfig } = await import('./lib/config.mjs');
  const config = await loadConfig(args.config ?? './config.json');
  if (args.outputDir) {
    config.outputDir = path.resolve(args.outputDir);
  }

  switch (command) {
    case 'auth': {
      const { authenticate } = await import('./commands/auth.mjs');
      await authenticate(config, args);
      break;
    }
    case 'capture': {
      if (!args.flow) {
        throw new Error('capture requires --flow <path-to-flow.json>.');
      }
      const { captureFlow } = await import('./commands/capture.mjs');
      await captureFlow(config, path.resolve(args.flow), args);
      break;
    }
    case 'test-e2e': {
      if (!args.scenario || args.scenario === true) throw new Error('test-e2e requires --scenario <path-to-scenario.json>.');
      if (args.dryRun === true) {
        const { loadE2eScenario } = await import('./lib/e2e-scenario.mjs');
        const { scenario, flow } = await loadE2eScenario(path.resolve(args.scenario), { allowPlaceholders: true });
        console.log(JSON.stringify({ scenario: scenario.id, flow: flow.id, steps: flow.steps.map(s => s.heading), mutation: true, requiresGISApproval: true }, null, 2));
        break;
      }
      const { captureE2eScenario } = await import('./commands/capture.mjs');
      await captureE2eScenario(config, path.resolve(args.scenario), args);
      break;
    }
    case 'capture-all': {
      const { captureAll } = await import('./commands/capture.mjs');
      await captureAll(config, path.resolve(args.flows ?? './flows'), args);
      break;
    }
    case 'join': {
      const { joinGuides } = await import('./commands/join.mjs');
      await joinGuides(config, path.resolve(args.collections ?? config.collectionsDir), args);
      break;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error(`\nGuide builder failed: ${error instanceof Error ? error.message : String(error)}`);
  if (process.env.DEBUG && error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  process.exitCode = 1;
});
