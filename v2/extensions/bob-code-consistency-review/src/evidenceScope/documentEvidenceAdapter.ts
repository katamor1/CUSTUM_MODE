import type {
  DocumentEvidenceAdapter,
  DocumentEvidenceQuery,
  DocumentEvidenceUnit
} from "./evidenceScopeTypes"

type RankedUnit = {
  unit: DocumentEvidenceUnit
  score: number
}

export class InMemoryDocumentEvidenceAdapter implements DocumentEvidenceAdapter {
  private readonly units: DocumentEvidenceUnit[]

  constructor(units: DocumentEvidenceUnit[]) {
    this.units = units.map(normalizeUnit)
  }

  findCandidates(query: DocumentEvidenceQuery): DocumentEvidenceUnit[] {
    const querySymbols = new Set(query.symbolIds)
    const queryTags = new Set([...query.riskTags, ...query.ruleIds])
    const queryKeywords = query.keywords.map(normalizeTerm).filter(Boolean)
    const ranked: RankedUnit[] = []

    this.units.forEach((unit) => {
      const score = scoreUnit(unit, querySymbols, queryTags, queryKeywords)
      if (score > 0) ranked.push({ unit, score })
    })

    ranked.sort((left, right) => right.score - left.score
      || left.unit.id.localeCompare(right.unit.id)
      || left.unit.contentHash.localeCompare(right.unit.contentHash)
      || left.unit.sourcePath.localeCompare(right.unit.sourcePath)
      || left.unit.locator.localeCompare(right.unit.locator))

    const selected = new Map<string, DocumentEvidenceUnit>()
    for (const item of ranked) {
      if (!selected.has(item.unit.id)) selected.set(item.unit.id, item.unit)
    }
    return [...selected.values()]
  }
}

function scoreUnit(
  unit: DocumentEvidenceUnit,
  querySymbols: Set<string>,
  queryTags: Set<string>,
  queryKeywords: string[]
): number {
  let score = 0
  for (const symbol of unit.linkedSymbols ?? []) {
    if (querySymbols.has(symbol)) score += 100
  }
  for (const tag of unit.tags ?? []) {
    if (queryTags.has(tag)) score += 40
  }

  const searchable = normalizeTerm([
    unit.sourcePath,
    unit.locator,
    ...(unit.tags ?? []),
    ...(unit.keywords ?? [])
  ].join(" "))
  for (const keyword of queryKeywords) {
    if (keyword && searchable.includes(keyword)) score += 10
  }
  return score
}

function normalizeUnit(unit: DocumentEvidenceUnit): DocumentEvidenceUnit {
  return {
    ...unit,
    estimatedTokens: normalizeTokenCount(unit.estimatedTokens),
    linkedSymbols: [...new Set(unit.linkedSymbols ?? [])].sort(),
    tags: [...new Set(unit.tags ?? [])].sort(),
    keywords: [...new Set(unit.keywords ?? [])].sort()
  }
}

function normalizeTokenCount(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.ceil(value))
}

function normalizeTerm(value: string): string {
  return value.trim().toLowerCase()
}
