import * as path from "node:path"
import Ajv2020, { ErrorObject, ValidateFunction } from "ajv/dist/2020"
import { readTextFile } from "./fileSystem"

export type SchemaName = "review-input" | "bob-output"

export async function loadSchemaValidator(name: SchemaName): Promise<ValidateFunction> {
  const schemaPath = path.join(__dirname, "..", "..", "resources", "schemas", `${name}.schema.json`)
  const schema = JSON.parse(await readTextFile(schemaPath))
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  return ajv.compile(schema)
}

export function formatSchemaErrors(validate: ValidateFunction): string[] {
  return (validate.errors ?? []).map(formatError)
}

function formatError(error: ErrorObject): string {
  const pathText = error.instancePath || "$"
  const params = Object.keys(error.params ?? {}).length > 0 ? ` ${JSON.stringify(error.params)}` : ""
  return `${pathText} ${error.message ?? "is invalid"}${params}`
}
