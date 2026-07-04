import { ValidationIssue } from "./types"

export function validateJsonAgainstSchema(value: unknown, schema: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  validateSchemaNode(value, schema, "$", issues, schema, new Set<string>())
  return issues
}

function validateSchemaNode(
  value: unknown,
  schema: unknown,
  path: string,
  issues: ValidationIssue[],
  rootSchema: unknown,
  refs: Set<string>
): void {
  if (!isRecord(schema)) return

  if (typeof schema.$ref === "string") {
    if (refs.has(schema.$ref)) return
    const resolved = resolveLocalRef(rootSchema, schema.$ref)
    if (!resolved) {
      issues.push({ path, message: `project schema reference could not be resolved: ${schema.$ref}` })
      return
    }
    refs.add(schema.$ref)
    validateSchemaNode(value, resolved, path, issues, rootSchema, refs)
    refs.delete(schema.$ref)
    return
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
    issues.push({ path, message: `project schema expected one of: ${schema.enum.map(String).join(", ")}` })
    return
  }

  if (typeof schema.type === "string" && !matchesType(value, schema.type)) {
    issues.push({ path, message: `project schema expected ${schema.type}` })
    return
  }

  if (typeof value === "string" && Number.isInteger(schema.minLength) && value.length < (schema.minLength as number)) {
    issues.push({ path, message: `project schema expected string length >= ${schema.minLength}` })
  }
  if (typeof value === "number" && typeof schema.minimum === "number" && value < schema.minimum) {
    issues.push({ path, message: `project schema expected number >= ${schema.minimum}` })
  }

  if (isRecord(value)) validateObjectSchema(value, schema, path, issues, rootSchema, refs)
  if (Array.isArray(value)) validateArraySchema(value, schema, path, issues, rootSchema, refs)
}

function validateObjectSchema(
  value: Record<string, unknown>,
  schema: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[],
  rootSchema: unknown,
  refs: Set<string>
): void {
  const properties = isRecord(schema.properties) ? schema.properties : {}
  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === "string")
    : []

  for (const key of required) {
    if (!(key in value)) {
      issues.push({ path: propertyPath(path, key), message: `project schema requires property ${key}` })
    }
  }

  for (const [key, childSchema] of Object.entries(properties)) {
    if (key in value) validateSchemaNode(value[key], childSchema, propertyPath(path, key), issues, rootSchema, refs)
  }

  if (schema.additionalProperties === false) {
    const allowed = new Set(Object.keys(properties))
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) {
        issues.push({ path: propertyPath(path, key), message: `project schema does not allow property ${key}` })
      }
    }
  }
}

function validateArraySchema(
  value: unknown[],
  schema: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[],
  rootSchema: unknown,
  refs: Set<string>
): void {
  if (!schema.items) return
  value.forEach((item, index) => validateSchemaNode(item, schema.items, `${path}[${index}]`, issues, rootSchema, refs))
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "array":
      return Array.isArray(value)
    case "boolean":
      return typeof value === "boolean"
    case "integer":
      return Number.isInteger(value)
    case "number":
      return typeof value === "number" && Number.isFinite(value)
    case "object":
      return isRecord(value)
    case "string":
      return typeof value === "string"
    default:
      return true
  }
}

function resolveLocalRef(rootSchema: unknown, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined
  return ref
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce((current: unknown, key) => isRecord(current) ? current[key] : undefined, rootSchema)
}

function propertyPath(base: string, key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
