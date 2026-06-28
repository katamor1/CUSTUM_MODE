import { requireOption } from "../args.js";
import { validateBobOutput } from "../../core/bob-output-validator.js";

export async function runValidateOutput(args: string[]): Promise<void> {
  const packageDir = requireOption(args, "--package");
  const bobOutputPath = requireOption(args, "--bob-output");

  const report = await validateBobOutput({ packageDir, bobOutputPath });

  if (report.errors.length > 0) {
    console.error(`[bob-review] bob-output invalid: ${report.errors.length} error(s)`);
    for (const error of report.errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  for (const warning of report.warnings) {
    console.warn(`[bob-review] warning: ${warning}`);
  }

  console.log("[bob-review] bob-output valid");
}
