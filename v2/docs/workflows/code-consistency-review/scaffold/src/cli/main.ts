#!/usr/bin/env node

import { runPreprocess } from "./commands/preprocess.js";
import { runValidateOutput } from "./commands/validate-output.js";
import { runTriage } from "./commands/triage.js";

type CommandName = "preprocess" | "validate-output" | "triage" | "help";

function printHelp(): void {
  console.log(`bob-review

Usage:
  bob-review preprocess --input review-input.yaml --out .bob-review/review-package
  bob-review validate-output --package .bob-review/review-package --bob-output .bob-review/bob-output/bob-output.yaml
  bob-review triage --package .bob-review/review-package --bob-output .bob-review/bob-output/bob-output.yaml --out .bob-review/human-triage

Commands:
  preprocess       Generate review-package and bob-input.md
  validate-output  Validate bob-output.yaml
  triage           Generate human triage templates
`);
}

function getCommand(argv: string[]): CommandName {
  const command = argv[2];
  if (command === "preprocess" || command === "validate-output" || command === "triage") {
    return command;
  }
  return "help";
}

async function main(): Promise<void> {
  const command = getCommand(process.argv);
  const args = process.argv.slice(3);

  try {
    switch (command) {
      case "preprocess":
        await runPreprocess(args);
        return;
      case "validate-output":
        await runValidateOutput(args);
        return;
      case "triage":
        await runTriage(args);
        return;
      case "help":
      default:
        printHelp();
        return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[bob-review] ERROR: ${message}`);
    process.exitCode = 1;
  }
}

await main();
