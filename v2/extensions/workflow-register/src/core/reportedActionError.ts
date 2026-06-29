export function reportedActionError(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  if (record.status !== "error" && record.valid !== false) return undefined

  const details = [
    ...formatList(record.issues, formatIssue),
    ...formatList(record.errors, formatMessage),
    formatMessage(record.message)
  ].filter((item): item is string => Boolean(item))

  return details.length > 0
    ? `action provider reported an error: ${details.join("; ")}`
    : "action provider reported an error."
}

function formatList(value: unknown, formatter: (item: unknown) => string | undefined): string[] {
  return Array.isArray(value) ? value.map(formatter).filter((item): item is string => Boolean(item)) : []
}

function formatIssue(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (!value || typeof value !== "object") return undefined
  const issue = value as Record<string, unknown>
  const issuePath = typeof issue.path === "string" ? issue.path : "$"
  const message = typeof issue.message === "string" ? issue.message : "validation failed"
  return `${issuePath}: ${message}`
}

function formatMessage(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  return typeof record.message === "string" && record.message.trim() ? record.message.trim() : undefined
}
