import YAML from "yaml";
import { readTextFile } from "./file-system.js";
import type { ReviewInput } from "./result.js";
import { formatSchemaErrors, loadSchemaValidator } from "./schema-loader.js";

export async function validateReviewInput(inputPath: string): Promise<ReviewInput> {
  const raw = await readTextFile(inputPath);
  const parsed = YAML.parse(raw) as unknown;

  const validate = await loadSchemaValidator("review-input");
  if (!validate(parsed)) {
    const errors = formatSchemaErrors(validate);
    throw new Error(`Invalid review-input.yaml:\n${errors.map((e) => `- ${e}`).join("\n")}`);
  }

  return parsed as ReviewInput;
}
