import type { ProjectRule, RuleApplicability, ScopeSymbol } from "./evidenceScopeTypes"

export function selectApplicableRules(rules: ProjectRule[], symbols: ScopeSymbol[]): ProjectRule[] {
  return rules
    .filter((rule) => isRuleApplicable(rule.appliesWhen, symbols))
    .map(normalizeRule)
    .sort((left, right) => left.id.localeCompare(right.id))
}

function isRuleApplicable(appliesWhen: RuleApplicability | undefined, symbols: ScopeSymbol[]): boolean {
  if (!appliesWhen) return true
  return symbols.some((symbol) => symbolMatches(appliesWhen, symbol))
}

function symbolMatches(appliesWhen: RuleApplicability, symbol: ScopeSymbol): boolean {
  if (appliesWhen.paths?.length && !appliesWhen.paths.some((pattern) => matchesPath(pattern, symbol.path))) return false
  if (appliesWhen.languages?.length && !appliesWhen.languages.includes(symbol.language ?? "unknown")) return false
  if (appliesWhen.symbolKinds?.length && !appliesWhen.symbolKinds.includes(symbol.kind)) return false
  if (appliesWhen.riskTags?.length) {
    const symbolTags = new Set(symbol.riskTags ?? [])
    if (!appliesWhen.riskTags.some((tag) => symbolTags.has(tag))) return false
  }
  if (appliesWhen.interfaceChange !== undefined && Boolean(symbol.interfaceChange) !== appliesWhen.interfaceChange) return false
  return true
}

function normalizeRule(rule: ProjectRule): ProjectRule {
  return {
    ...rule,
    estimatedTokens: rule.evaluation === "local" ? 0 : normalizeTokenCount(rule.estimatedTokens ?? 0),
    priority: rule.priority ?? "required"
  }
}

function normalizeTokenCount(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.ceil(value))
}

function matchesPath(pattern: string, path: string): boolean {
  const normalizedPattern = normalizePath(pattern)
  const normalizedPath = normalizePath(path)
  const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  const expression = escaped
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*")
  return new RegExp(`^${expression}$`).test(normalizedPath)
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "")
}
