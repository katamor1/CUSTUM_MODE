import * as path from "node:path"
import { collectGitDiff } from "./gitDiffCollector"
import { discoverReviewInputCandidates } from "./reviewInputDiscovery"
import { resolveWorkspacePathForKind, resolveWorkspacePathStrict, writeTextFile } from "./fileSystem"
import {
  MAX_TRACEABILITY_CANDIDATE_COUNT,
  renderTraceabilityPrompt
} from "./traceabilityAiDraftPrompt"
import { extractSingleJsonObjectText } from "./structuredTextExtractor"
import {
  readTraceabilityCatalog,
  writeTraceabilityCatalog,
  type WriteTraceabilityCatalogResult
} from "./traceabilityCatalogStore"
import type { DiffSummary } from "./diffTypes"
import type { ReviewInput } from "./reviewTypes"
import type {
  TraceabilityCatalog,
  TraceabilityDecision,
  TraceabilityDomain,
  TraceabilityItem,
  TraceabilityLink,
  TraceabilityStatus
} from "./traceabilityCatalog"

export type PrepareAiTraceabilityDraftPromptInput = {
  workspaceRoot: string
  outputDir: string
  catalogPath?: string
  docsRoot?: string
  base: string
  head: string
  vcs: "git" | "bazaar" | "bzr"
  vcsRoot?: string
  bzrPath?: string
  diffFixturePath?: string
  textEncoding?: string
}

export type PrepareAiTraceabilityDraftPromptResult = {
  status: "ok"
  promptPath: string
  prompt: string
  warnings: string[]
}

export type ApplyAiTraceabilityDraftInput = {
  workspaceRoot: string
  catalogPath?: string
  text: string
  textEncoding?: string
}

export type ApplyAiTraceabilityDraftResult =
  | { status: "ok"; catalogPath: string; backupPath?: string; catalog: TraceabilityCatalog; warnings: string[] }
  | { status: "error"; errors: string[]; warnings: string[] }

export type MergeAiTraceabilityDraftResult = { status: "ok"; catalog: TraceabilityCatalog; warnings: string[] }

const PROMPT_FILE_NAME = "ai-draft-prompt.md"
const MAX_AI_DRAFT_STRING_LENGTH = 2048
const MAX_AI_DRAFT_ALIASES = 50
const AI_DRAFT_COLLECTION_LIMITS = {
  documents: 200,
  domains: 200,
  items: 1000,
  links: 2000,
  decisions: 1000
} as const
const ITEM_TYPES = new Set(["requirement", "basic_design", "detailed_design", "test_spec", "qa_item", "review_finding"])
const LINK_TYPES = new Set(["satisfies", "elaborates", "verified_by", "clarifies", "reviewed_by", "references"])
const GATES = new Set(["basic_design", "detailed_design", "test"])

type RawTraceabilityCatalog = {
  schema_version: 1
  documents: unknown[]
  domains: unknown[]
  items: unknown[]
  links: unknown[]
  decisions: unknown[]
}

/**
 * workspace 内の文書候補と差分から AI traceability draft 用 prompt を生成する。
 *
 * AI に渡すのは候補作成のための context までであり、catalog の承認状態や
 * workspace 外 path の採用可否は後続の host 側検証に残す。
 */
export async function prepareAiTraceabilityDraftPrompt(input: PrepareAiTraceabilityDraftPromptInput): Promise<PrepareAiTraceabilityDraftPromptResult> {
  const warnings: string[] = []
  const outputDir = resolveWorkspacePathForKind(input.workspaceRoot, input.outputDir, "traceability-ai-draft-output")
  const discovery = await discoverReviewInputCandidates(input.workspaceRoot, {
    docsRoot: input.docsRoot,
    textEncoding: input.textEncoding,
    maxFiles: MAX_TRACEABILITY_CANDIDATE_COUNT
  })
  warnings.push(...discovery.warnings)

  const read = await readTraceabilityCatalog({ workspaceRoot: input.workspaceRoot, catalogPath: input.catalogPath, textEncoding: input.textEncoding })
  const catalog = read.status === "ok" ? read.catalog : undefined
  if (read.status === "error") warnings.push(...read.errors)

  let diff: DiffSummary | undefined
  try {
    diff = await collectGitDiff(minimalTraceabilityReviewInput(input), {
      workspaceRoot: input.workspaceRoot,
      diffFixturePath: input.diffFixturePath,
      bzrPath: input.bzrPath,
      textEncoding: input.textEncoding
    })
  } catch (error) {
    warnings.push(`diff summary unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }

  const prompt = renderTraceabilityPrompt({ input, catalog, diff, candidates: discovery.documents, warnings })
  const promptPath = path.join(outputDir, PROMPT_FILE_NAME)
  await writeTextFile(promptPath, prompt)
  return { status: "ok", promptPath, prompt, warnings }
}

/**
 * AI が返した traceability draft を host 側で検証し catalog へ取り込む。
 *
 * AI 出力は提案データとして扱い、承認済み状態や既存 catalog の人間判断を直接変更しない。
 * catalog 書き込み時の backup と path 検証も Webview ではなく host が担う。
 */
export async function applyAiTraceabilityDraft(input: ApplyAiTraceabilityDraftInput): Promise<ApplyAiTraceabilityDraftResult> {
  const warnings: string[] = []
  let draft: TraceabilityCatalog
  try {
    draft = parseAiTraceabilityDraft(input.text)
  } catch (error) {
    return { status: "error", errors: [`AI traceability draft JSON parse failed: ${error instanceof Error ? error.message : String(error)}`], warnings }
  }
  const pathErrors = validateDraftSourcePaths(input.workspaceRoot, draft)
  if (pathErrors.length > 0) return { status: "error", errors: pathErrors, warnings }

  const read = await readTraceabilityCatalog({ workspaceRoot: input.workspaceRoot, catalogPath: input.catalogPath, textEncoding: input.textEncoding })
  if (read.status === "error") return { status: "error", errors: read.errors, warnings }

  const merged = mergeAiTraceabilityDraft(read.catalog, draft)
  const write = await writeTraceabilityCatalog({
    workspaceRoot: input.workspaceRoot,
    catalogPath: input.catalogPath,
    catalog: merged.catalog,
    backupExisting: !read.created
  })
  if (write.status === "error") return { status: "error", errors: write.errors, warnings: [...warnings, ...merged.warnings] }
  return okApplyResult(write, merged.catalog, [...warnings, ...merged.warnings])
}

/**
 * AI draft JSON を catalog 候補へ正規化する境界。
 *
 * accepted / rejected / deprecated は人間の判断結果なので、AI がそれらの状態や
 * 承認済み endpoint を作った場合は canonicalize せず error にする。
 */
export function parseAiTraceabilityDraft(text: string): TraceabilityCatalog {
  const parsed = JSON.parse(extractSingleJsonObjectText(text, { label: "AI traceability draft JSON text" })) as unknown
  if (!isRecord(parsed)) throw new Error("top-level value must be an object")
  if (parsed.schema_version !== 1) throw new Error("schema_version must be 1")

  const rawCatalog: RawTraceabilityCatalog = {
    schema_version: 1,
    documents: arrayValue(parsed.documents, "documents"),
    domains: arrayValue(parsed.domains, "domains"),
    items: arrayValue(parsed.items, "items"),
    links: arrayValue(parsed.links ?? [], "links"),
    decisions: arrayValue(parsed.decisions ?? [], "decisions")
  }

  const schemaErrors = validateAiDraftSchema(rawCatalog)
  if (schemaErrors.length > 0) throw new Error(`AI traceability draft schema invalid: ${schemaErrors.join("; ")}`)

  const typedCatalog = rawCatalog as TraceabilityCatalog
  // AI 出力は候補作成までで、人が承認済みの id/status/endpoint を直接作らせない。
  const violations = aiAcceptedStateViolations(typedCatalog)
  if (violations.length > 0) throw new Error(`AI draft must not create accepted state: ${violations.join("; ")}`)
  return {
    schema_version: 1,
    documents: typedCatalog.documents,
    domains: typedCatalog.domains.map((domain) => normalizeDomain(domain)),
    items: typedCatalog.items.map((item) => normalizeItem(item)),
    links: (typedCatalog.links ?? []).map((link) => normalizeLink(link)),
    decisions: (typedCatalog.decisions ?? []).map((decision) => normalizeDecision(decision))
  }
}

/**
 * AI draft を既存 catalog に統合する。
 *
 * 既存の accepted/rejected/deprecated は人間確認済みの責務境界なので、
 * 同じ key の候補が AI draft に含まれても上書きしない。
 */
export function mergeAiTraceabilityDraft(existing: TraceabilityCatalog, draft: TraceabilityCatalog): MergeAiTraceabilityDraftResult {
  const warnings: string[] = []
  // 既存の accepted/rejected/deprecated は人間の判断結果なので、AI draft の同一 key では上書きしない。
  const catalog: TraceabilityCatalog = {
    schema_version: 1,
    documents: mergeByKey(existing.documents ?? [], draft.documents ?? [], (item) => item.document_id, () => false),
    domains: mergeByKey(existing.domains ?? [], draft.domains ?? [], (item) => item.code, isHumanReviewed),
    items: mergeByKey(existing.items ?? [], draft.items ?? [], itemKey, isHumanReviewed),
    links: mergeByKey(existing.links ?? [], draft.links ?? [], linkKey, isHumanReviewed),
    decisions: mergeByKey(existing.decisions ?? [], draft.decisions ?? [], decisionKey, isHumanReviewed)
  }

  return { status: "ok", catalog, warnings }
}

function okApplyResult(
  write: WriteTraceabilityCatalogResult & { status: "ok" },
  catalog: TraceabilityCatalog,
  warnings: string[]
): ApplyAiTraceabilityDraftResult {
  return {
    status: "ok",
    catalogPath: write.catalogPath,
    backupPath: write.backupPath,
    catalog,
    warnings
  }
}

function normalizeDomain(domain: TraceabilityDomain): TraceabilityDomain {
  return { ...domain, status: "proposed" }
}

function normalizeItem(item: TraceabilityItem): TraceabilityItem {
  return { ...item, id: undefined, status: "proposed" }
}

function normalizeLink(link: TraceabilityLink): TraceabilityLink {
  return { ...link, from: undefined, to: undefined, status: "proposed" }
}

function normalizeDecision(decision: TraceabilityDecision): TraceabilityDecision {
  return { ...decision, status: "proposed" }
}

function aiAcceptedStateViolations(catalog: TraceabilityCatalog): string[] {
  const violations: string[] = []
  for (const domain of catalog.domains) {
    if (domain.status !== "proposed") violations.push(`domain ${domain.code} has status ${domain.status}`)
  }
  for (const item of catalog.items) {
    if (item.id) violations.push(`item ${item.id} sets id`)
    if (item.status !== "proposed") violations.push(`item ${item.proposed_id ?? item.id ?? "(unknown)"} has status ${item.status}`)
  }
  for (const link of catalog.links ?? []) {
    if (link.from || link.to) violations.push(`link ${link.from ?? link.proposed_from ?? "(unknown)"} sets accepted endpoint`)
    if (link.status !== "proposed") violations.push(`link ${link.proposed_from ?? link.from ?? "(unknown)"} has status ${link.status}`)
  }
  for (const decision of catalog.decisions ?? []) {
    if (decision.status !== "proposed") violations.push(`decision ${decision.subject} has status ${decision.status}`)
  }
  return violations
}

function validateAiDraftSchema(catalog: RawTraceabilityCatalog): string[] {
  const errors: string[] = []
  checkCollectionLimit("documents", catalog.documents, AI_DRAFT_COLLECTION_LIMITS.documents, errors)
  checkCollectionLimit("domains", catalog.domains, AI_DRAFT_COLLECTION_LIMITS.domains, errors)
  checkCollectionLimit("items", catalog.items, AI_DRAFT_COLLECTION_LIMITS.items, errors)
  checkCollectionLimit("links", catalog.links, AI_DRAFT_COLLECTION_LIMITS.links, errors)
  checkCollectionLimit("decisions", catalog.decisions, AI_DRAFT_COLLECTION_LIMITS.decisions, errors)

  const documentIds = new Set<string>()
  catalog.documents.forEach((document, index) => {
    if (!isRecord(document)) {
      errors.push(`documents[${index}] must be an object`)
      return
    }
    const id = requiredString(document, `documents[${index}].document_id`, errors)
    requiredString(document, `documents[${index}].source_path`, errors)
    optionalString(document, "display_id", `documents[${index}].display_id`, errors)
    optionalStringOrNull(document, "extracted_id", `documents[${index}].extracted_id`, errors)
    requiredOneOf(document, ["extracted", "sidecar-generated"], `documents[${index}].id_source`, errors)
    addUnique(documentIds, id, `duplicate document_id '${id}'`, errors)
  })

  const domainCodes = new Set<string>()
  catalog.domains.forEach((domain, index) => {
    if (!isRecord(domain)) {
      errors.push(`domains[${index}] must be an object`)
      return
    }
    const code = requiredString(domain, `domains[${index}].code`, errors)
    requiredString(domain, `domains[${index}].status`, errors)
    optionalString(domain, "label", `domains[${index}].label`, errors)
    optionalString(domain, "description", `domains[${index}].description`, errors)
    optionalStringArray(domain, "aliases", `domains[${index}].aliases`, MAX_AI_DRAFT_ALIASES, errors)
    addUnique(domainCodes, code, `duplicate domain code '${code}'`, errors)
  })

  const itemKeys = new Set<string>()
  catalog.items.forEach((item, index) => {
    if (!isRecord(item)) {
      errors.push(`items[${index}] must be an object`)
      return
    }
    const proposedId = optionalString(item, "proposed_id", `items[${index}].proposed_id`, errors)
    const acceptedId = optionalStringOrNull(item, "id", `items[${index}].id`, errors)
    if (!proposedId && !acceptedId) errors.push(`items[${index}] must include proposed_id`)
    requiredOneOf(item, Array.from(ITEM_TYPES), `items[${index}].type`, errors)
    requiredString(item, `items[${index}].source_document_id`, errors)
    requiredString(item, `items[${index}].domain`, errors)
    requiredPositiveInteger(item, "sequence", `items[${index}].sequence`, errors)
    requiredString(item, `items[${index}].status`, errors)
    optionalString(item, "source_path", `items[${index}].source_path`, errors)
    optionalString(item, "text_summary", `items[${index}].text_summary`, errors)
    optionalStringRecord(item, "anchor", ["heading", "location", "source_hash", "current_hash"], `items[${index}].anchor`, errors)
    optionalStringRecord(item, "qa", ["question", "answer", "status"], `items[${index}].qa`, errors)
    optionalStringRecord(item, "review", ["severity", "action_plan", "status"], `items[${index}].review`, errors)
    addUnique(itemKeys, String(proposedId ?? acceptedId ?? ""), `duplicate item '${proposedId ?? acceptedId}'`, errors)
  })

  const linkKeys = new Set<string>()
  catalog.links.forEach((link, index) => {
    if (!isRecord(link)) {
      errors.push(`links[${index}] must be an object`)
      return
    }
    const proposedFrom = optionalString(link, "proposed_from", `links[${index}].proposed_from`, errors)
    const proposedTo = optionalString(link, "proposed_to", `links[${index}].proposed_to`, errors)
    const from = optionalString(link, "from", `links[${index}].from`, errors)
    const to = optionalString(link, "to", `links[${index}].to`, errors)
    if (!proposedFrom && !from) errors.push(`links[${index}] must include proposed_from`)
    if (!proposedTo && !to) errors.push(`links[${index}] must include proposed_to`)
    const linkType = requiredOneOf(link, Array.from(LINK_TYPES), `links[${index}].link_type`, errors)
    requiredString(link, `links[${index}].status`, errors)
    addUnique(linkKeys, `${linkType}:${proposedFrom ?? from ?? ""}:${proposedTo ?? to ?? ""}`, `duplicate link at links[${index}]`, errors)
  })

  const decisionKeys = new Set<string>()
  catalog.decisions.forEach((decision, index) => {
    if (!isRecord(decision)) {
      errors.push(`decisions[${index}] must be an object`)
      return
    }
    const subject = requiredString(decision, `decisions[${index}].subject`, errors)
    const gate = requiredOneOf(decision, Array.from(GATES), `decisions[${index}].gate`, errors)
    const value = requiredOneOf(decision, ["n/a"], `decisions[${index}].decision`, errors)
    optionalString(decision, "reason", `decisions[${index}].reason`, errors)
    requiredString(decision, `decisions[${index}].status`, errors)
    addUnique(decisionKeys, `${subject}:${gate}:${value}`, `duplicate decision at decisions[${index}]`, errors)
  })

  return errors
}

function validateDraftSourcePaths(workspaceRoot: string, catalog: TraceabilityCatalog): string[] {
  const errors: string[] = []
  for (const document of catalog.documents ?? []) validateDraftSourcePath(workspaceRoot, document.source_path, `document ${document.document_id}`, errors)
  for (const item of catalog.items ?? []) {
    if (item.source_path) validateDraftSourcePath(workspaceRoot, item.source_path, `item ${item.proposed_id ?? item.id ?? "(unknown)"}`, errors)
  }
  return errors
}

function validateDraftSourcePath(workspaceRoot: string, sourcePath: string, subject: string, errors: string[]): void {
  try {
    // AI が返す source_path も workspace 内の証跡参照として再解決し、外部ファイル参照を catalog に残さない。
    resolveWorkspacePathStrict(workspaceRoot, sourcePath, `traceability draft source_path for ${subject}`)
  } catch (error) {
    errors.push(`traceability draft source_path invalid for ${subject}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function checkCollectionLimit(name: keyof typeof AI_DRAFT_COLLECTION_LIMITS, values: unknown[], maxCount: number, errors: string[]): void {
  if (values.length > maxCount) errors.push(`${name} exceeds max count (${values.length} > ${maxCount})`)
}

function requiredString(record: Record<string, unknown>, pathName: string, errors: string[]): string | undefined {
  const key = pathName.slice(pathName.lastIndexOf(".") + 1)
  const value = record[key]
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${pathName} must be a non-empty string`)
    return undefined
  }
  checkStringLength(value, pathName, errors)
  return value
}

function optionalString(record: Record<string, unknown>, key: string, pathName: string, errors: string[]): string | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== "string") {
    errors.push(`${pathName} must be a string`)
    return undefined
  }
  checkStringLength(value, pathName, errors)
  return value
}

function optionalStringOrNull(record: Record<string, unknown>, key: string, pathName: string, errors: string[]): string | null | undefined {
  const value = record[key]
  if (value === undefined || value === null) return value
  if (typeof value !== "string") {
    errors.push(`${pathName} must be a string or null`)
    return undefined
  }
  checkStringLength(value, pathName, errors)
  return value
}

function optionalStringArray(record: Record<string, unknown>, key: string, pathName: string, maxCount: number, errors: string[]): void {
  const value = record[key]
  if (value === undefined) return
  if (!Array.isArray(value)) {
    errors.push(`${pathName} must be an array`)
    return
  }
  if (value.length > maxCount) errors.push(`${pathName} exceeds max count (${value.length} > ${maxCount})`)
  value.forEach((item, index) => {
    if (typeof item !== "string") {
      errors.push(`${pathName}[${index}] must be a string`)
      return
    }
    checkStringLength(item, `${pathName}[${index}]`, errors)
  })
}

function optionalStringRecord(record: Record<string, unknown>, key: string, fields: string[], pathName: string, errors: string[]): void {
  const value = record[key]
  if (value === undefined) return
  if (!isRecord(value)) {
    errors.push(`${pathName} must be an object`)
    return
  }
  for (const field of fields) optionalString(value, field, `${pathName}.${field}`, errors)
}

function requiredOneOf(record: Record<string, unknown>, allowedValues: string[], pathName: string, errors: string[]): string | undefined {
  const value = requiredString(record, pathName, errors)
  if (value !== undefined && !allowedValues.includes(value)) errors.push(`${pathName} must be one of: ${allowedValues.join(", ")}`)
  return value
}

function requiredPositiveInteger(record: Record<string, unknown>, key: string, pathName: string, errors: string[]): number | undefined {
  const value = record[key]
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    errors.push(`${pathName} must be a positive integer`)
    return undefined
  }
  return value
}

function checkStringLength(value: string, pathName: string, errors: string[]): void {
  if (value.length > MAX_AI_DRAFT_STRING_LENGTH) errors.push(`${pathName} exceeds max string length (${value.length} > ${MAX_AI_DRAFT_STRING_LENGTH})`)
}

function addUnique(values: Set<string>, value: string | undefined, message: string, errors: string[]): void {
  if (!value) return
  if (values.has(value)) errors.push(message)
  values.add(value)
}

function mergeByKey<T>(
  existingItems: T[],
  draftItems: T[],
  keyOf: (value: T) => string,
  preserveExisting: (value: T) => boolean
): T[] {
  const result = [...existingItems]
  for (const candidate of draftItems) {
    const key = keyOf(candidate)
    const index = result.findIndex((item) => keyOf(item) === key)
    if (index < 0) {
      result.push(candidate)
      continue
    }
    if (!preserveExisting(result[index])) result[index] = candidate
  }
  return result
}

function itemKey(item: TraceabilityItem): string {
  return item.proposed_id ?? item.id ?? `${item.type}:${item.source_document_id}:${item.domain}:${item.sequence}`
}

function linkKey(link: TraceabilityLink): string {
  return `${link.link_type}:${link.proposed_from ?? link.from ?? ""}:${link.proposed_to ?? link.to ?? ""}`
}

function decisionKey(decision: TraceabilityDecision): string {
  return `${decision.subject}:${decision.gate}:${decision.decision}`
}

function isHumanReviewed(value: { status?: TraceabilityStatus }): boolean {
  return value.status === "accepted" || value.status === "rejected" || value.status === "deprecated"
}

function arrayValue(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function minimalTraceabilityReviewInput(input: PrepareAiTraceabilityDraftPromptInput): ReviewInput {
  return {
    schema_version: 1,
    review: {
      id: "traceability-ai-draft",
      title: "traceability AI draft",
      change_type: "maintenance",
      purpose: "Collect traceability candidates before review-input generation",
      base: input.base,
      head: input.head,
      vcs: input.vcs,
      vcs_root: input.vcsRoot
    },
    artifacts: {},
    review_focus: []
  }
}
