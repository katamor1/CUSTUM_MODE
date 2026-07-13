import { randomUUID } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { normalizeChangedFilePathStrict } from "../core/fileSystem"
import type {
  RepositoryIndexEdgeRecord,
  RepositoryIndexSymbolRecord,
  RepositoryReferenceCandidate,
  RepositorySourceFragment
} from "./repositorySourceExtractor"

export type RepositoryIndexCacheEntry = {
  path: string
  objectId: string
  contentHash: string
  bytes: number
  language: string
  fragment: RepositorySourceFragment
}

export type RepositoryIndexCache = {
  schemaVersion: 1
  producerId: string
  producerVersion: number
  optionsHash: string
  sourceRevision: string
  entries: Map<string, RepositoryIndexCacheEntry>
}

export type RepositoryIndexCacheLoadResult = {
  cache?: RepositoryIndexCache
  warnings: string[]
}

type RepositoryIndexCacheDocument = {
  schema_version: 1
  producer: {
    id: string
    version: number
    options_hash: string
  }
  source_revision: string
  files: Array<{
    path: string
    object_id: string
    content_hash: string
    bytes: number
    language: string
    fragment: RepositorySourceFragment
  }>
}

export async function loadRepositoryIndexCache(
  filePath: string,
  maxBytes: number
): Promise<RepositoryIndexCacheLoadResult> {
  let raw: Buffer
  try {
    raw = await readBoundedFile(filePath, maxBytes)
  } catch (error) {
    if (isMissing(error)) return { warnings: [] }
    return { warnings: [`repository index cache ignored: ${message(error)}`] }
  }

  try {
    const document = validateCacheDocument(JSON.parse(raw.toString("utf8")) as unknown)
    const entries = new Map<string, RepositoryIndexCacheEntry>()
    for (const item of document.files) {
      if (entries.has(item.path)) throw new Error(`duplicate cache file path: ${item.path}`)
      entries.set(item.path, {
        path: item.path,
        objectId: item.object_id,
        contentHash: item.content_hash,
        bytes: item.bytes,
        language: item.language,
        fragment: item.fragment
      })
    }
    return {
      cache: {
        schemaVersion: 1,
        producerId: document.producer.id,
        producerVersion: document.producer.version,
        optionsHash: document.producer.options_hash,
        sourceRevision: document.source_revision,
        entries
      },
      warnings: []
    }
  } catch (error) {
    return { warnings: [`repository index cache ignored: ${message(error)}`] }
  }
}

export async function writeRepositoryIndexCache(input: {
  filePath: string
  producerId: string
  producerVersion: number
  optionsHash: string
  sourceRevision: string
  entries: Map<string, RepositoryIndexCacheEntry>
}): Promise<void> {
  const files = [...input.entries.values()]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((entry) => ({
      path: entry.path,
      object_id: entry.objectId,
      content_hash: entry.contentHash,
      bytes: entry.bytes,
      language: entry.language,
      fragment: entry.fragment
    }))
  const document: RepositoryIndexCacheDocument = {
    schema_version: 1,
    producer: {
      id: input.producerId,
      version: input.producerVersion,
      options_hash: input.optionsHash
    },
    source_revision: input.sourceRevision,
    files
  }
  await writeAtomicTextFile(input.filePath, `${JSON.stringify(document, null, 2)}\n`)
}

export async function writeAtomicTextFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`
  await fs.writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" })
  try {
    await fs.rename(temporaryPath, filePath)
  } catch (error) {
    if (!replaceRetryable(error)) throw error
    await fs.rm(filePath, { force: true })
    await fs.rename(temporaryPath, filePath)
  } finally {
    await fs.rm(temporaryPath, { force: true })
  }
}

async function readBoundedFile(filePath: string, maxBytes: number): Promise<Buffer> {
  const safeMaxBytes = positiveInteger(maxBytes, "cache maxBytes")
  const handle = await fs.open(filePath, "r")
  try {
    const before = await handle.stat()
    if (!before.isFile()) throw new Error(`cache path is not a file: ${filePath}`)
    if (before.size > safeMaxBytes) throw new Error(`cache exceeded maxBytes (${before.size} > ${safeMaxBytes})`)
    const buffer = Buffer.alloc(before.size)
    let offset = 0
    while (offset < buffer.length) {
      const result = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (result.bytesRead === 0) break
      offset += result.bytesRead
    }
    const after = await handle.stat()
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || offset !== before.size) {
      throw new Error("cache changed while reading")
    }
    return buffer
  } finally {
    await handle.close()
  }
}

function validateCacheDocument(value: unknown): RepositoryIndexCacheDocument {
  if (!isRecord(value)) throw new Error("cache root must be an object")
  if (value.schema_version !== 1) throw new Error(`unsupported cache schema_version: ${String(value.schema_version)}`)
  if (!isRecord(value.producer)) throw new Error("cache producer must be an object")
  if (typeof value.producer.id !== "string" || !value.producer.id) throw new Error("cache producer.id is required")
  if (!Number.isInteger(value.producer.version) || Number(value.producer.version) < 1) throw new Error("cache producer.version must be a positive integer")
  if (typeof value.producer.options_hash !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value.producer.options_hash)) {
    throw new Error("cache producer.options_hash is invalid")
  }
  if (typeof value.source_revision !== "string" || !/^[0-9a-f]{40}$/u.test(value.source_revision)) {
    throw new Error("cache source_revision is invalid")
  }
  if (!Array.isArray(value.files)) throw new Error("cache files must be an array")

  for (const item of value.files) {
    if (!isRecord(item)) throw new Error("cache file entry must be an object")
    if (typeof item.path !== "string" || normalizeChangedFilePathStrict(item.path, "cache file path") !== item.path) {
      throw new Error(`cache file path is invalid: ${String(item.path)}`)
    }
    if (typeof item.object_id !== "string" || !/^[0-9a-f]{40,64}$/u.test(item.object_id)) {
      throw new Error(`cache object id is invalid: ${String(item.path)}`)
    }
    if (typeof item.content_hash !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(item.content_hash)) {
      throw new Error(`cache content hash is invalid: ${String(item.path)}`)
    }
    if (!Number.isInteger(item.bytes) || Number(item.bytes) < 0) throw new Error(`cache byte count is invalid: ${String(item.path)}`)
    if (typeof item.language !== "string" || !item.language) throw new Error(`cache language is invalid: ${String(item.path)}`)
    if (!validFragment(item.fragment, item.path, item.language)) throw new Error(`cache fragment is invalid: ${String(item.path)}`)
  }
  return value as unknown as RepositoryIndexCacheDocument
}

function validFragment(value: unknown, expectedPath: string, expectedLanguage: string): value is RepositorySourceFragment {
  if (!isRecord(value) || value.path !== expectedPath || value.language !== expectedLanguage) return false
  if (!Array.isArray(value.symbols) || !Array.isArray(value.edges) || !Array.isArray(value.references)) return false
  const symbolIds = new Set<string>()
  for (const symbol of value.symbols) {
    if (!validSymbol(symbol, expectedPath) || symbolIds.has(symbol.id)) return false
    symbolIds.add(symbol.id)
  }
  for (const edge of value.edges) {
    if (!validEdge(edge) || !symbolIds.has(edge.from) || (edge.resolution === "resolved" && (!edge.to || !symbolIds.has(edge.to)))) return false
  }
  return value.references.every((reference) => validReference(reference, symbolIds))
}

function validSymbol(value: unknown, expectedPath: string): value is RepositoryIndexSymbolRecord {
  if (!isRecord(value)) return false
  if (typeof value.id !== "string" || !value.id || typeof value.name !== "string" || !value.name) return false
  if (value.path !== expectedPath || typeof value.kind !== "string" || !value.kind || typeof value.language !== "string" || !value.language) return false
  if (typeof value.estimated_tokens !== "number" || !Number.isFinite(value.estimated_tokens) || value.estimated_tokens < 0) return false
  if (value.visibility !== undefined && !["public", "protected", "private", "internal", "unknown"].includes(String(value.visibility))) return false
  if (value.is_test !== undefined && typeof value.is_test !== "boolean") return false
  if (value.risk_tags !== undefined && (!Array.isArray(value.risk_tags) || value.risk_tags.some((tag) => typeof tag !== "string" || !tag))) return false
  return true
}

function validEdge(value: unknown): value is RepositoryIndexEdgeRecord {
  if (!isRecord(value) || typeof value.from !== "string" || !value.from || typeof value.kind !== "string" || !value.kind) return false
  if (value.resolution !== "resolved" && value.resolution !== "unknown") return false
  if (typeof value.reason !== "string" || !value.reason) return false
  if (value.resolution === "resolved") return typeof value.to === "string" && Boolean(value.to) && value.target_hint === undefined
  return value.to === undefined && typeof value.target_hint === "string" && Boolean(value.target_hint)
}

function validReference(value: unknown, symbolIds: Set<string>): value is RepositoryReferenceCandidate {
  if (!isRecord(value) || typeof value.from !== "string" || !symbolIds.has(value.from)) return false
  if (!["imports", "includes", "tests", "calls", "uses-type"].includes(String(value.kind))) return false
  if (typeof value.reason !== "string" || !value.reason) return false
  const hasPath = typeof value.targetPath === "string" && Boolean(value.targetPath)
  const hasName = typeof value.targetName === "string" && Boolean(value.targetName)
  if (hasPath === hasName) return false
  if (value.targetKinds !== undefined && (!Array.isArray(value.targetKinds) || value.targetKinds.some((kind) => typeof kind !== "string" || !kind))) return false
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`)
  return Math.floor(value)
}

function isMissing(error: unknown): boolean {
  return isNodeError(error) && error.code === "ENOENT"
}

function replaceRetryable(error: unknown): boolean {
  return isNodeError(error) && ["EEXIST", "EPERM", "EACCES"].includes(error.code ?? "")
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
