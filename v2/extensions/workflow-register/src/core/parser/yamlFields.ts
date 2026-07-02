export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function requiredString(record: Record<string, unknown>, key: string): string {
  const value = optionalString(record, key)
  if (!value) throw new Error(`Missing required string: ${key}`)
  return value
}

export function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

export function optionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  return typeof record[key] === "boolean" ? record[key] as boolean : undefined
}

export function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return undefined
}

export function arrayField(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key]
  return Array.isArray(value) ? value : []
}

export function listField(record: Record<string, unknown>, key: string, fallback: string[] = []): string[] {
  const value = record[key]
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === "string" && value.trim()) return [value.trim()]
  return fallback
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
