import Ajv, { type ValidateFunction } from "ajv";
import { readTextFile } from "./file-system.js";

export type SchemaName = "review-input" | "bob-output";

const schemaPathByName: Record<SchemaName, string> = {
  "review-input": "docs/workflows/code-consistency-review/schemas/review-input.schema.json",
  "bob-output": "docs/workflows/code-consistency-review/schemas/bob-output.schema.json",
};

export async function loadSchemaValidator(schemaName: SchemaName): Promise<ValidateFunction> {
  const schemaText = await readTextFile(schemaPathByName[schemaName]);
  const schema = JSON.parse(schemaText) as Record<string, unknown>;

  const ajv = new Ajv({
    allErrors: true,
    strict: false,
  });

  return ajv.compile(schema);
}

export function formatSchemaErrors(validate: ValidateFunction): string[] {
  return (validate.errors ?? []).map((error) => {
    const path = error.instancePath || "/";
    return `${path} ${error.message ?? "is invalid"}`;
  });
}
