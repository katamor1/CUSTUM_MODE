import { requireOption } from "../args.js";
import { generateHumanTriage } from "../../triage/human-triage-helper.js";

export async function runTriage(args: string[]): Promise<void> {
  const packageDir = requireOption(args, "--package");
  const bobOutputPath = requireOption(args, "--bob-output");
  const outDir = requireOption(args, "--out");

  await generateHumanTriage({ packageDir, bobOutputPath, outDir });

  console.log(`[bob-review] human triage files generated: ${outDir}`);
}
