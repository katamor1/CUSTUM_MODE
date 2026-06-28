import YAML from "yaml";
import { readTextFile } from "./file-system.js";
import type { ValidationReport } from "./result.js";
import { formatSchemaErrors, loadSchemaValidator } from "./schema-loader.js";

export async function validateBobOutput(input: {
  packageDir: string;
  bobOutputPath: string;
}): Promise<ValidationReport> {
  const warnings: string[] = [];

  const raw = await readTextFile(input.bobOutputPath);
  const parsed = YAML.parse(raw) as unknown;

  const validate = await loadSchemaValidator("bob-output");
  const errors = validate(parsed) ? [] : formatSchemaErrors(validate);

  if (input.packageDir.length === 0) {
    warnings.push("packageDir is empty; evidence-index check skipped");
  } else {
    warnings.push("MVP scaffold: evidence-index existence check is TODO");
  }

  return { errors, warnings };
}
