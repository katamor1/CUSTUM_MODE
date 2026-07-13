import type { ProjectRule, RuleApplicability, ScopePriority } from "./evidenceScopeTypes"

export type ParsedProjectRules = {
  rules: ProjectRule[]
  warnings: string[]
}

const PRIORITIES = new Set<ScopePriority>(["required", "high", "medium", "low"])

export function parseProjectRules(value: unknown): ParsedProjectRules {
  if (value === undefined || value === null) return { rules: [], warnings: [] }
  if (!Array.isArray(value)) {
    return { rules: [], warnings: ["evidence_scope_rules must be an array; ignored."] }
  }

  const rules: ProjectRule[] = []
  const warnings: string[] = []
  value.forEach((entry, index) => {
    const parsed = parseRule(entry)
    if (parsed.rule) {
      rules.push(parsed.rule)
      return
    }
    const label = parsed.id ? ` ${parsed.id}` : ` at index ${index}`
    warnings.push(`invalid evidence scope rule${label}: ${parsed.reason}`)
  })

  const unique = new Map<string, ProjectRule>()
  for (const rule of rules) {
    if (unique.has(rule.id)) {
      warnings.push(`duplicate evidence scope rule ${rule.id}; later entry ignored.`)
      continue
    }
    unique.set(rule.id, rule)
  }
  return {
    rules: [...unique.values()].sort((left, right) => left.id.localeCompare(right.id)),
    warnings
  }
}

type ParseRuleResult = {
  rule?: ProjectRule
  id?: string
  reason: string
}

function parseRule(value: unknown): ParseRuleResult {
  if (!isRecord(value)) return { reason: "entry must be an object" }
  const id = readNonEmptyString(value.id)
  const title = readNonEmptyString(value.title)
  const evaluation = value.evaluation
  if (!id) return { reason: "id is required" }
  if (!title) return { id, reason: "title is required" }
  if (evaluation !== "local" && evaluation !== "ai") {
    return { id, reason: "evaluation must be local or ai" }
  }

  const priorityValue = value.priority
  if (priorityValue !== undefined && (typeof priorityValue !== "string" || !PRIORITIES.has(priorityValue as ScopePriority))) {
    return { id, reason: "priority must be required, high, medium, or low" }
  }
  const rawEstimatedTokens = value.estimated_tokens ?? value.estimatedTokens
  const estimatedTokens = readOptionalNonNegativeNumber(rawEstimatedTokens)
  if (rawEstimatedTokens !== undefined && estimatedTokens === undefined) {
    return { id, reason: "estimated_tokens must be a non-negative number" }
  }

  const appliesWhen = parseApplicability(value.applies_when ?? value.appliesWhen)
  if (appliesWhen.error) return { id, reason: appliesWhen.error }

  return {
    reason: "",
    rule: {
      id,
      title,
      evaluation,
      ...(estimatedTokens !== undefined ? { estimatedTokens } : {}),
      priority: (priorityValue as ScopePriority | undefined) ?? "required",
      ...(appliesWhen.value ? { appliesWhen: appliesWhen.value } : {})
    }
  }
}

function parseApplicability(value: unknown): { value?: RuleApplicability; error?: string } {
  if (value === undefined || value === null) return {}
  if (!isRecord(value)) return { error: "applies_when must be an object" }

  const paths = readStringArray(value.paths)
  if (paths.error) return { error: `applies_when.paths ${paths.error}` }
  const languages = readStringArray(value.languages)
  if (languages.error) return { error: `applies_when.languages ${languages.error}` }
  const symbolKinds = readStringArray(value.symbol_kinds ?? value.symbolKinds)
  if (symbolKinds.error) return { error: `applies_when.symbol_kinds ${symbolKinds.error}` }
  const riskTags = readStringArray(value.risk_tags ?? value.riskTags)
  if (riskTags.error) return { error: `applies_when.risk_tags ${riskTags.error}` }
  const interfaceChange = value.interface_change ?? value.interfaceChange
  if (interfaceChange !== undefined && typeof interfaceChange !== "boolean") {
    return { error: "applies_when.interface_change must be boolean" }
  }

  const applicability: RuleApplicability = {
    ...(paths.values?.length ? { paths: paths.values } : {}),
    ...(languages.values?.length ? { languages: languages.values } : {}),
    ...(symbolKinds.values?.length ? { symbolKinds: symbolKinds.values } : {}),
    ...(riskTags.values?.length ? { riskTags: riskTags.values } : {}),
    ...(interfaceChange !== undefined ? { interfaceChange } : {})
  }
  return { value: applicability }
}

function readStringArray(value: unknown): { values?: string[]; error?: string } {
  if (value === undefined || value === null) return {}
  if (!Array.isArray(value)) return { error: "must be an array" }
  const values = value.map(readNonEmptyString)
  if (values.some((item) => !item)) return { error: "must contain non-empty strings" }
  return { values: [...new Set(values as string[])].sort() }
}

function readOptionalNonNegativeNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined
  return Math.ceil(value)
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
