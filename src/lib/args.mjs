export function parseArgs(values) {
  const result = {};

  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = values[index + 1];
    if (!next || next.startsWith('--')) {
      result[key] = true;
      continue;
    }

    result[key] = next;
    index += 1;
  }

  return result;
}

export function printHelp() {
  console.log(`KineX User Guide Builder (Node)\n\nCommands:\n  auth         Open a headed browser and save authenticated storage state.\n  capture      Capture one JSON flow. Requires --flow.\n  capture-all  Capture every JSON flow and build configured combined manuals.
  test-e2e    Run the approval-gated JSON Property/Orchard/Block/MA mutation scenario.\n  join         Join already-generated guides into combined manuals.\n  validate     Validate flow files without opening a browser.\n\nCommon options:\n  --config <file>  Configuration file. Default: ./config.json\n  --headed         Show the browser while capturing.
  --season YYYY    Set safe guide capture season (default 2027 for capture-all).
  --crop CODE      Crop scope (default KIWIFRUIT for capture-all).
  --country CODE   Country scope (default NZ for capture-all).
  --no-guide-scope Disable automatic AppSelection for capture-all.\n  --flow <file>    Flow JSON for the capture command.
  --scenario <file> E2E scenario JSON (required for test-e2e).
  --dry-run        Validate and show the scenario steps without opening a browser.\n  --flows <dir>    Flow directory for capture-all or validate.\n  --collections <dir> Collection definitions for capture-all or join.\n  --profile <name> Coverage profile: smoke, core, full, mutation, laptop or laptop-mutation.\n  --output-dir <dir> Override the configured output directory for this run.\n  --no-pdf         Skip PDF generation.\n  --keep-open      Keep the browser open after capture.
  --verify-only    For Block hectares E2E, run only Step 5 (no creates/publishes).
  --orchard-pin <PIN> Existing Orchard PIN; required with --verify-only.
  --block-prefix <prefix> Existing Block name prefix; required with --verify-only.
  --expected-hectares <csv> Four existing business hectare values (e.g. 1.50,2.59,3,2.65).\n`);
}
