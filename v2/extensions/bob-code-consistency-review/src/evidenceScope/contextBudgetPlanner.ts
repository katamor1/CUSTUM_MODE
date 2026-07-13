import type {
  ContextBudgetReport,
  ExcludedScopeItem,
  ScopeBudgetItem,
  ScopePriority,
  SelectedScopeItem
} from "./evidenceScopeTypes"

const PRIORITY_ORDER: Record<ScopePriority, number> = {
  required: 0,
  high: 1,
  medium: 2,
  low: 3
}

export type ContextBudgetPolicy = {
  tokenBudget: number
  includeLowPriority?: boolean
}

export function planContextBudget(items: ScopeBudgetItem[], policy: ContextBudgetPolicy): ContextBudgetReport {
  const tokenBudget = normalizeTokenCount(policy.tokenBudget)
  const includeLowPriority = policy.includeLowPriority ?? false
  const normalizedItems = deduplicateItems(items).sort(compareItems)
  const selected: SelectedScopeItem[] = []
  const excluded: ExcludedScopeItem[] = []
  let selectedTokens = 0
  let requiredTokens = 0

  for (const item of normalizedItems) {
    if (item.priority === "required") {
      selected.push(item)
      selectedTokens += item.estimatedTokens
      requiredTokens += item.estimatedTokens
      continue
    }

    if (item.priority === "low" && !includeLowPriority) {
      excluded.push({ ...item, exclusionReason: "low-priority-policy" })
      continue
    }

    if (selectedTokens + item.estimatedTokens <= tokenBudget) {
      selected.push(item)
      selectedTokens += item.estimatedTokens
      continue
    }

    excluded.push({ ...item, exclusionReason: "token-budget" })
  }

  return {
    budgetTokens: tokenBudget,
    selectedTokens,
    requiredTokens,
    overBudget: selectedTokens > tokenBudget,
    selected,
    excluded
  }
}

function deduplicateItems(items: ScopeBudgetItem[]): ScopeBudgetItem[] {
  const byKey = new Map<string, ScopeBudgetItem>()
  for (const rawItem of items) {
    const item = normalizeItem(rawItem)
    const key = `${item.kind}:${item.id}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, item)
      continue
    }

    const priority = PRIORITY_ORDER[item.priority] < PRIORITY_ORDER[existing.priority] ? item.priority : existing.priority
    byKey.set(key, {
      ...existing,
      priority,
      estimatedTokens: Math.max(existing.estimatedTokens, item.estimatedTokens),
      reasons: [...new Set([...existing.reasons, ...item.reasons])].sort()
    })
  }
  return [...byKey.values()]
}

function normalizeItem(item: ScopeBudgetItem): ScopeBudgetItem {
  return {
    ...item,
    estimatedTokens: normalizeTokenCount(item.estimatedTokens),
    reasons: [...new Set(item.reasons.filter(Boolean))].sort()
  }
}

function normalizeTokenCount(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.ceil(value))
}

function compareItems(left: ScopeBudgetItem, right: ScopeBudgetItem): number {
  return PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority]
    || left.id.localeCompare(right.id)
    || left.kind.localeCompare(right.kind)
}
