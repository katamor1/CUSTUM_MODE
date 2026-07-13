import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import {
  normalizeChangedFilePathStrict,
  resolveWorkspacePathStrict
} from "../core/fileSystem"
import { formatSchemaErrors, loadSchemaValidator } from "../core/schemaLoader"
import { decodeTextBuffer } from "../core/textEncoding"
import type { DependencyEdge, ScopeSymbol } from "./evidenceScopeTypes"

export type RepositorySymbolIndexProvenance = {
  id: string
  sourceRevision: string
  sourcePath: string
  contentHash: string
  symbolCount: number
  edgeCount: number
}

export type LoadedRepositorySymbolIndex = RepositorySymbolIndexProvenance & {
  symbols: ScopeSymbol[]
  dependencyEdges: DependencyEdge[]
}

export type LoadRepositorySymbolIndexInput = {
  workspaceRoot: string
  indexPath: unknown
  expectedSourceRevision: string
  maxBytes: number
  textEncoding?: string
}

export async function loadRepositorySymbolIndex(
  input: LoadRepositorySymbolIndexInput
): Promise<LoadedRepositorySymbolIndex | undefined> {
  if (input.indexPath === undefined || input.indexPath === null) return undefined
  if (typeof input.indexPath !== "string" || !input.indexPath.trim()) {
    throw new Error("repository symbol index path must be a non-empty string")
  }

  const sourcePath = normalizeChangedFilePathStrict(
    input.indexPath,
    "repository symbol index path"
  )
  if (!/\.json$/i.test(sourcePath)) {
    throw new Error(`repository symbol index path must end in .json: ${sourcePath}`)
  }

  const resolvedPath = resolveWorkspacePathStrict(
    input.workspaceRoot,
    sourcePath,
    "repository symbol index path"
  )
  const rawBytes = await readIndexBytes(resolvedPath, input.maxBytes, sourcePath)
  const rawText = decodeTextBuffer(rawBytes, input.textEncoding ?? "auto")
  const parsed = parseIndexJson(rawText, sourcePath)
  const validate = await loadSchemaValidator("repository-symbol-index")
  if (!validate(parsed)) {
    const errors = formatSchemaErrors(validate)
    throw new Error(
      `Invalid repository symbol index (${sourcePath}):\n${errors.map((error) => `- ${error}`).join("\n")}`
    )
  }

  const document = parsed as RepositorySymbolIndexDocument
  const sourceRevision = normalizeRevision(document.index.source_revision, "repository symbol index source revision")
  const expectedRevision = normalizeRevision(input.expectedSourceRevision, "expected repository source revision")
  if (sourceRevision !== expectedRevision) {
    throw new Error(
      `repository symbol index source revision mismatch (${sourceRevision} != ${expectedRevision}): ${sourcePath}`
    )
  }

  const { symbols, dependencyEdges } = validateGraph(document, sourcePath)
  return {
    id: document.index.id,
    sourceRevision,
    sourcePath,
    contentHash: `sha256:${createHash("sha256").update(rawBytes).digest("hex")}`,
    symbolCount: symbols.length,
    edgeCount: dependencyEdges.length,
    symbols,
    dependencyEdges
  }
}

type RepositorySymbolIndexDocument = {
  schema_version: 1
  index: {
    id: string
    source_revision: string
    generator?: string
    generated_at?: string
  }
  symbols: RepositoryIndexSymbol[]
  edges: RepositoryIndexEdge[]
}

type RepositoryIndexSymbol = {
  id: string
  name: string
  path: string
  kind: string
  language?: string
  estimated_tokens?: number
  visibility?: "public" | "protected" | "private" | "internal" | "unknown"
  interface_change?: boolean
  risk_tags?: string[]
  is_test?: boolean
}

type RepositoryIndexEdge = {
  from: string
  to?: string
  kind: string
  resolution: "resolved" | "unknown"
  reason: string
  target_hint?: string
}

function validateGraph(
  document: RepositorySymbolIndexDocument,
  sourcePath: string
): { symbols: ScopeSymbol[]; dependencyEdges: DependencyEdge[] } {
  const symbolById = new Map<string, ScopeSymbol>()
  for (const raw of document.symbols) {
    if (symbolById.has(raw.id)) {
      throw new Error(`duplicate repository symbol id: ${raw.id} (${sourcePath})`)
    }
    const riskTags = [...new Set([
      ...(raw.risk_tags ?? []),
      ...(raw.is_test ? ["test-impact"] : [])
    ])].sort()
    symbolById.set(raw.id, {
      id: raw.id,
      name: raw.name,
      path: normalizeChangedFilePathStrict(raw.path, `repository symbol ${raw.id} path`),
      kind: raw.kind,
      ...(raw.language ? { language: raw.language } : {}),
      estimatedTokens: normalizeTokenCount(raw.estimated_tokens ?? estimateTokens(raw.name)),
      ...(raw.visibility ? { visibility: raw.visibility } : {}),
      ...(raw.interface_change !== undefined ? { interfaceChange: raw.interface_change } : {}),
      riskTags
    })
  }

  const edgeByKey = new Map<string, DependencyEdge>()
  for (const raw of document.edges) {
    if (!symbolById.has(raw.from)) {
      throw new Error(`repository edge source not found: ${raw.from} (${sourcePath})`)
    }
    if (raw.resolution === "resolved") {
      if (!raw.to || !symbolById.has(raw.to)) {
        throw new Error(`resolved edge target not found: ${raw.to ?? "<missing>"} (${sourcePath})`)
      }
    }
    const edge: DependencyEdge = {
      from: raw.from,
      ...(raw.to ? { to: raw.to } : {}),
      kind: raw.kind,
      resolution: raw.resolution,
      reason: raw.reason,
      ...(raw.target_hint ? { targetHint: raw.target_hint } : {})
    }
    const key = canonicalEdgeKey(edge)
    if (edgeByKey.has(key)) {
      throw new Error(`duplicate repository dependency edge: ${formatEdge(edge)} (${sourcePath})`)
    }
    edgeByKey.set(key, edge)
  }

  return {
    symbols: [...symbolById.values()].sort((left, right) => left.id.localeCompare(right.id)),
    dependencyEdges: [...edgeByKey.values()].sort(compareEdges)
  }
}

async function readIndexBytes(filePath: string, maxBytes: number, sourcePath: string): Promise<Buffer> {
  const normalizedMaxBytes = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : 0
  if (normalizedMaxBytes <= 0) {
    throw new Error(`repository symbol index maxBytes must be positive: ${maxBytes}`)
  }

  const handle = await fs.open(filePath, "r")
  try {
    const before = await handle.stat()
    if (!before.isFile()) throw new Error(`repository symbol index is not a file: ${sourcePath}`)
    if (before.size > normalizedMaxBytes) {
      throw new Error(
        `repository symbol index exceeded maxDocumentBytes (${before.size} > ${normalizedMaxBytes}): ${sourcePath}`
      )
    }

    const buffer = Buffer.alloc(before.size)
    let offset = 0
    while (offset < buffer.length) {
      const read = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (read.bytesRead === 0) break
      offset += read.bytesRead
    }

    const after = await handle.stat()
    if (after.size > normalizedMaxBytes) {
      throw new Error(
        `repository symbol index exceeded maxDocumentBytes (${after.size} > ${normalizedMaxBytes}): ${sourcePath}`
      )
    }
    if (after.size !== before.size || offset !== before.size) {
      throw new Error(`repository symbol index changed while reading: ${sourcePath}`)
    }
    return buffer
  } finally {
    await handle.close()
  }
}

function parseIndexJson(rawText: string, sourcePath: string): unknown {
  try {
    return JSON.parse(rawText) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid repository symbol index (${sourcePath}): JSON parse failed: ${message}`)
  }
}

function normalizeRevision(value: string, label: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(normalized)) throw new Error(`${label} must be a 40-character commit SHA: ${value}`)
  return normalized
}

function normalizeTokenCount(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.ceil(value))
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4))
}

function canonicalEdgeKey(edge: DependencyEdge): string {
  return `${edge.from}\u0000${edge.to ?? ""}\u0000${edge.kind}\u0000${edge.resolution}`
}

function formatEdge(edge: DependencyEdge): string {
  return `${edge.from} -> ${edge.to ?? edge.targetHint ?? "unknown"} (${edge.kind}/${edge.resolution})`
}

function compareEdges(left: DependencyEdge, right: DependencyEdge): number {
  return canonicalEdgeKey(left).localeCompare(canonicalEdgeKey(right))
    || left.reason.localeCompare(right.reason)
    || (left.targetHint ?? "").localeCompare(right.targetHint ?? "")
}
