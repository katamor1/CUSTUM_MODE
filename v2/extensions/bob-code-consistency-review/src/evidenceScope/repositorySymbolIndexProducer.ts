import { createHash } from "node:crypto"
import * as path from "node:path"
import { runExternalProcess } from "../core/externalProcessRunner"
import {
  normalizeChangedFilePathStrict,
  relativePosix,
  resolveWorkspacePathForKind,
  resolveWorkspacePathStrict
} from "../core/fileSystem"
import { classifyLanguageFromPath, type ReviewLanguage } from "../core/languageClassifier"
import { decodeTextBuffer } from "../core/textEncoding"
import {
  loadRepositoryIndexCache,
  writeAtomicTextFile,
  writeRepositoryIndexCache,
  type RepositoryIndexCacheEntry
} from "./repositoryIndexCache"
import {
  extractRepositorySourceFragment,
  repositoryFileSymbolId,
  type RepositoryIndexEdgeRecord,
  type RepositoryIndexSymbolRecord,
  type RepositoryReferenceCandidate,
  type RepositorySourceFragment
} from "./repositorySourceExtractor"

const PRODUCER_ID = "bob-repository-index-producer"
const PRODUCER_VERSION = 1
const GENERATOR_ID = "bob-code-consistency-review/repository-index-producer-v1"
const DEFAULT_INDEX_ID = "bob-repository-index"
const DEFAULT_MAX_FILES = 10_000
const DEFAULT_MAX_FILE_BYTES = 1024 * 1024
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024
const MAX_INDEX_SYMBOLS = 50_000
const MAX_INDEX_EDGES = 200_000
const DEFAULT_LANGUAGES: ReviewLanguage[] = [
  "c", "cpp", "h", "hpp", "typescript", "javascript", "python", "csharp", "java", "go", "rust"
]
const SOURCE_EXTENSIONS = [
  ".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx",
  ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".pyw", ".cs", ".java", ".go", ".rs"
]

export type RepositoryIndexCacheStatus = "miss" | "partial" | "hit"

export type ProduceRepositorySymbolIndexInput = {
  workspaceRoot: string
  repositoryRoot?: string
  sourceRevision: string
  indexPath: string
  cachePath?: string
  indexId?: string
  includeLanguages?: string[]
  maxFiles?: number
  maxFileBytes?: number
  maxTotalBytes?: number
  textEncoding?: string
  commandTimeoutMs?: number
  signal?: AbortSignal
}

export type ProduceRepositorySymbolIndexResult = {
  indexPath: string
  cachePath: string
  indexId: string
  sourceRevision: string
  contentHash: string
  symbolCount: number
  edgeCount: number
  scannedFiles: number
  reusedFiles: number
  rebuiltFiles: number
  removedFiles: number
  cacheStatus: RepositoryIndexCacheStatus
  warnings: string[]
}

type ProducerOptions = {
  workspaceRoot: string
  repositoryRoot: string
  sourceRevision: string
  indexPath: string
  cachePath: string
  indexId: string
  includeLanguages: string[]
  maxFiles: number
  maxFileBytes: number
  maxTotalBytes: number
  textEncoding: string
  commandTimeoutMs: number
  signal?: AbortSignal
}

type TrackedSourceEntry = {
  path: string
  objectId: string
  bytes: number
  language: string
}

type RepositorySymbolIndexDocument = {
  schema_version: 1
  index: {
    id: string
    source_revision: string
    generator: string
  }
  symbols: RepositoryIndexSymbolRecord[]
  edges: RepositoryIndexEdgeRecord[]
}

export async function produceRepositorySymbolIndex(
  input: ProduceRepositorySymbolIndexInput
): Promise<ProduceRepositorySymbolIndexResult> {
  const options = normalizeOptions(input)
  await verifyCheckedOutRevision(options)
  const sourceEntries = await listTrackedSourceEntries(options)
  if (sourceEntries.length > options.maxFiles) {
    throw new Error(`repository index source file count exceeded maxFiles (${sourceEntries.length} > ${options.maxFiles})`)
  }
  await verifyTrackedSourcesClean(options, new Set(sourceEntries.map((entry) => entry.path)))
  const totalSourceBytes = sourceEntries.reduce((sum, entry) => sum + entry.bytes, 0)
  if (totalSourceBytes > options.maxTotalBytes) {
    throw new Error(`repository index source bytes exceeded maxTotalBytes (${totalSourceBytes} > ${options.maxTotalBytes})`)
  }

  const optionsHash = producerOptionsHash(options)
  const cacheMaxBytes = Math.max(1024 * 1024, Math.min(64 * 1024 * 1024, options.maxTotalBytes * 4))
  const loadedCache = await loadRepositoryIndexCache(options.cachePath, cacheMaxBytes)
  const compatibleCache = loadedCache.cache?.producerId === PRODUCER_ID
    && loadedCache.cache.producerVersion === PRODUCER_VERSION
    && loadedCache.cache.optionsHash === optionsHash
    ? loadedCache.cache
    : undefined
  const warnings = [...loadedCache.warnings]
  if (loadedCache.cache && !compatibleCache) {
    warnings.push("repository index cache invalidated: producer identity or options changed")
  }

  const entries = new Map<string, RepositoryIndexCacheEntry>()
  let reusedFiles = 0
  let rebuiltFiles = 0
  for (const source of sourceEntries) {
    const cached = compatibleCache?.entries.get(source.path)
    if (cached && cached.objectId === source.objectId && cached.language === source.language && cached.bytes === source.bytes) {
      entries.set(source.path, cached)
      reusedFiles += 1
      continue
    }

    const raw = await readSourceBlob(options, source)
    const contentHash = sha256(raw)
    const fragment = extractRepositorySourceFragment({
      path: source.path,
      language: source.language,
      text: decodeTextBuffer(raw, options.textEncoding),
      byteLength: raw.length
    })
    entries.set(source.path, {
      path: source.path,
      objectId: source.objectId,
      contentHash,
      bytes: raw.length,
      language: source.language,
      fragment
    })
    rebuiltFiles += 1
  }

  const removedFiles = compatibleCache
    ? [...compatibleCache.entries.keys()].filter((filePath) => !entries.has(filePath)).length
    : 0
  const document = buildIndexDocument(options, [...entries.values()].map((entry) => entry.fragment))
  if (document.symbols.length > MAX_INDEX_SYMBOLS) {
    throw new Error(`repository index symbol count exceeded schema maximum (${document.symbols.length} > ${MAX_INDEX_SYMBOLS})`)
  }
  if (document.edges.length > MAX_INDEX_EDGES) {
    throw new Error(`repository index edge count exceeded schema maximum (${document.edges.length} > ${MAX_INDEX_EDGES})`)
  }

  const serialized = `${JSON.stringify(document, null, 2)}\n`
  const contentHash = sha256(Buffer.from(serialized, "utf8"))
  await writeRepositoryIndexCache({
    filePath: options.cachePath,
    producerId: PRODUCER_ID,
    producerVersion: PRODUCER_VERSION,
    optionsHash,
    sourceRevision: options.sourceRevision,
    entries
  })
  await writeAtomicTextFile(options.indexPath, serialized)

  const cacheStatus: RepositoryIndexCacheStatus = compatibleCache
    ? rebuiltFiles === 0 && removedFiles === 0 ? "hit" : "partial"
    : "miss"
  return {
    indexPath: relativePosix(options.workspaceRoot, options.indexPath),
    cachePath: relativePosix(options.workspaceRoot, options.cachePath),
    indexId: options.indexId,
    sourceRevision: options.sourceRevision,
    contentHash,
    symbolCount: document.symbols.length,
    edgeCount: document.edges.length,
    scannedFiles: sourceEntries.length,
    reusedFiles,
    rebuiltFiles,
    removedFiles,
    cacheStatus,
    warnings: [...new Set(warnings)].sort()
  }
}

export function isRepositoryIndexProducerLanguage(value: string): boolean {
  return DEFAULT_LANGUAGES.includes(value.trim().toLowerCase() as ReviewLanguage)
}

function normalizeOptions(input: ProduceRepositorySymbolIndexInput): ProducerOptions {
  const workspaceRoot = path.resolve(input.workspaceRoot)
  const repositoryRoot = resolveWorkspacePathStrict(
    workspaceRoot,
    input.repositoryRoot ?? workspaceRoot,
    "repositoryRoot"
  )
  const sourceRevision = normalizeRevision(input.sourceRevision)
  const indexPath = resolveWorkspacePathForKind(workspaceRoot, input.indexPath, "repository-symbol-index-output")
  const cacheValue = input.cachePath ?? defaultCachePath(input.indexPath)
  const cachePath = resolveWorkspacePathForKind(workspaceRoot, cacheValue, "repository-symbol-index-cache")
  if (indexPath === cachePath) throw new Error("repository symbol index and cache paths must differ")
  return {
    workspaceRoot,
    repositoryRoot,
    sourceRevision,
    indexPath,
    cachePath,
    indexId: normalizeIndexId(input.indexId ?? DEFAULT_INDEX_ID),
    includeLanguages: normalizeLanguages(input.includeLanguages),
    maxFiles: positiveInteger(input.maxFiles, DEFAULT_MAX_FILES, "maxFiles"),
    maxFileBytes: positiveInteger(input.maxFileBytes, DEFAULT_MAX_FILE_BYTES, "maxFileBytes"),
    maxTotalBytes: positiveInteger(input.maxTotalBytes, DEFAULT_MAX_TOTAL_BYTES, "maxTotalBytes"),
    textEncoding: input.textEncoding ?? "auto",
    commandTimeoutMs: positiveInteger(input.commandTimeoutMs, DEFAULT_COMMAND_TIMEOUT_MS, "commandTimeoutMs"),
    signal: input.signal
  }
}

function defaultCachePath(indexPath: string): string {
  return /\.json$/iu.test(indexPath) ? indexPath.replace(/\.json$/iu, ".cache.json") : `${indexPath}.cache.json`
}

async function verifyCheckedOutRevision(options: ProducerOptions): Promise<void> {
  const result = await git(options, ["rev-parse", "HEAD"], 4096)
  const checkedOut = result.stdout.toString("utf8").trim().toLowerCase()
  if (checkedOut !== options.sourceRevision) {
    throw new Error(`repository index source revision does not match checked out HEAD (${options.sourceRevision} != ${checkedOut})`)
  }
}

async function listTrackedSourceEntries(options: ProducerOptions): Promise<TrackedSourceEntry[]> {
  const result = await git(options, ["ls-tree", "-r", "-l", "-z", options.sourceRevision], MAX_GIT_OUTPUT_BYTES)
  const allowed = new Set(options.includeLanguages)
  const entries: TrackedSourceEntry[] = []
  for (const record of result.stdout.toString("utf8").split("\0").filter(Boolean)) {
    const tabIndex = record.indexOf("\t")
    if (tabIndex < 0) throw new Error("repository index git tree record is malformed")
    const header = record.slice(0, tabIndex).trim().split(/\s+/u)
    if (header.length !== 4) throw new Error("repository index git tree header is malformed")
    const [, objectType, objectId, sizeValue] = header
    if (objectType !== "blob") continue
    if (!/^[0-9a-f]{40,64}$/u.test(objectId)) throw new Error(`repository index git object id is invalid: ${objectId}`)
    const bytes = Number(sizeValue)
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error(`repository index git object size is invalid: ${sizeValue}`)
    const sourcePath = normalizeChangedFilePathStrict(record.slice(tabIndex + 1), "repository tracked source path")
    const language = classifyLanguageFromPath(sourcePath)
    if (!allowed.has(language)) continue
    if (bytes > options.maxFileBytes) {
      throw new Error(`repository index source file exceeded maxFileBytes (${bytes} > ${options.maxFileBytes}): ${sourcePath}`)
    }
    entries.push({ path: sourcePath, objectId, bytes, language })
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path))
}

async function verifyTrackedSourcesClean(options: ProducerOptions, sourcePaths: Set<string>): Promise<void> {
  if (sourcePaths.size === 0) return
  const result = await git(options, ["diff", "--name-only", "-z", options.sourceRevision, "--"], MAX_GIT_OUTPUT_BYTES)
  const dirty = result.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((value) => normalizeChangedFilePathStrict(value, "repository dirty source path"))
    .filter((filePath) => sourcePaths.has(filePath))
    .sort()
  if (dirty.length > 0) {
    throw new Error(`repository index tracked workspace content differs from source revision:\n${dirty.map((filePath) => `- ${filePath}`).join("\n")}`)
  }
}

async function readSourceBlob(options: ProducerOptions, source: TrackedSourceEntry): Promise<Buffer> {
  const result = await git(
    options,
    ["cat-file", "blob", source.objectId],
    Math.max(128 * 1024, source.bytes + 64 * 1024)
  )
  if (result.stdout.length !== source.bytes) {
    throw new Error(`repository index source blob size changed (${result.stdout.length} != ${source.bytes}): ${source.path}`)
  }
  return result.stdout
}

function buildIndexDocument(options: ProducerOptions, fragments: RepositorySourceFragment[]): RepositorySymbolIndexDocument {
  const symbolsById = new Map<string, RepositoryIndexSymbolRecord>()
  const edgesByKey = new Map<string, RepositoryIndexEdgeRecord>()
  const references: RepositoryReferenceCandidate[] = []
  for (const fragment of [...fragments].sort((left, right) => left.path.localeCompare(right.path))) {
    for (const symbol of fragment.symbols) {
      if (symbolsById.has(symbol.id)) throw new Error(`repository producer generated duplicate symbol id: ${symbol.id}`)
      symbolsById.set(symbol.id, symbol)
    }
    for (const edge of fragment.edges) edgesByKey.set(edgeKey(edge), edge)
    references.push(...fragment.references)
  }

  const symbols = [...symbolsById.values()].sort((left, right) => left.id.localeCompare(right.id))
  const files = new Set(fragments.map((fragment) => fragment.path))
  const symbolsByName = new Map<string, RepositoryIndexSymbolRecord[]>()
  for (const symbol of symbols) {
    const values = symbolsByName.get(symbol.name) ?? []
    values.push(symbol)
    symbolsByName.set(symbol.name, values)
  }

  for (const reference of references.sort(compareReferences)) {
    const resolved = reference.targetPath
      ? resolvePathReference(reference, files, symbolsById)
      : resolveNameReference(reference, symbolsByName)
    if (resolved) edgesByKey.set(edgeKey(resolved), resolved)
  }

  return {
    schema_version: 1,
    index: { id: options.indexId, source_revision: options.sourceRevision, generator: GENERATOR_ID },
    symbols,
    edges: [...edgesByKey.values()].sort(compareEdges)
  }
}

function resolvePathReference(
  reference: RepositoryReferenceCandidate,
  files: Set<string>,
  symbolsById: Map<string, RepositoryIndexSymbolRecord>
): RepositoryIndexEdgeRecord | undefined {
  const target = reference.targetPath
  if (!target) return undefined
  const resolvedPath = resolveReferencedPath(reference.from, target, files)
  if (resolvedPath) {
    const targetId = repositoryFileSymbolId(resolvedPath)
    if (!symbolsById.has(targetId)) return undefined
    return { from: reference.from, to: targetId, kind: reference.kind, resolution: "resolved", reason: reference.reason }
  }
  if (!isRepositoryRelativeReference(target)) return undefined
  return {
    from: reference.from,
    kind: reference.kind,
    resolution: "unknown",
    reason: `${reference.reason}; repository path unresolved`,
    target_hint: target
  }
}

function resolveNameReference(
  reference: RepositoryReferenceCandidate,
  symbolsByName: Map<string, RepositoryIndexSymbolRecord[]>
): RepositoryIndexEdgeRecord | undefined {
  const targetName = reference.targetName
  if (!targetName) return undefined
  const allowedKinds = new Set(reference.targetKinds ?? [])
  const matches = (symbolsByName.get(targetName) ?? [])
    .filter((symbol) => allowedKinds.size === 0 || allowedKinds.has(symbol.kind))
  if (matches.length !== 1) return undefined
  return { from: reference.from, to: matches[0].id, kind: reference.kind, resolution: "resolved", reason: reference.reason }
}

function resolveReferencedPath(fromId: string, target: string, files: Set<string>): string | undefined {
  const fromPath = fromId.startsWith("file:") ? fromId.slice("file:".length) : ""
  if (!fromPath) return undefined
  const candidates: string[] = []
  if (target.startsWith("./") || target.startsWith("../") || target.includes("/")) {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), target))
    candidates.push(base)
    for (const extension of SOURCE_EXTENSIONS) candidates.push(`${base}${extension}`)
    for (const extension of SOURCE_EXTENSIONS) candidates.push(path.posix.join(base, `index${extension}`))
  } else if (/^[A-Za-z0-9_.-]+(?:\.[A-Za-z0-9_.-]+)+$/u.test(target)) {
    const modulePath = target.replace(/^\.+/u, "").replace(/\./gu, "/")
    candidates.push(modulePath, `${modulePath}.py`, `${modulePath}/__init__.py`)
  }
  return candidates.map(cleanCandidate).find((candidate) => Boolean(candidate && files.has(candidate)))
}

function cleanCandidate(value: string): string {
  const normalized = path.posix.normalize(value.replace(/\\/g, "/"))
  return normalized.startsWith("../") || normalized === ".." || normalized.startsWith("/") ? "" : normalized
}

function isRepositoryRelativeReference(value: string): boolean {
  return value.startsWith("./") || value.startsWith("../") || (!value.startsWith("<") && value.includes("/") && !/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value))
}

function producerOptionsHash(options: ProducerOptions): string {
  return sha256(Buffer.from(JSON.stringify({
    producerId: PRODUCER_ID,
    producerVersion: PRODUCER_VERSION,
    repositoryRoot: relativePosix(options.workspaceRoot, options.repositoryRoot),
    includeLanguages: options.includeLanguages,
    textEncoding: options.textEncoding,
    extractorPolicy: GENERATOR_ID
  }), "utf8"))
}

async function git(
  options: ProducerOptions,
  args: string[],
  maxBufferBytes: number
): Promise<{ stdout: Buffer; stderr: Buffer; exitCode: number }> {
  return runExternalProcess({
    command: "git",
    args,
    cwd: options.repositoryRoot,
    maxBufferBytes,
    timeoutMs: options.commandTimeoutMs,
    signal: options.signal
  })
}

function normalizeRevision(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[0-9a-f]{40}$/u.test(normalized)) {
    throw new Error(`repository index sourceRevision must be a 40-character commit SHA: ${value}`)
  }
  return normalized
}

function normalizeIndexId(value: string): string {
  const normalized = value.trim()
  if (!normalized || /[\0-\x1f\x7f]/u.test(normalized)) throw new Error("repository index id is invalid")
  return normalized
}

function normalizeLanguages(values: string[] | undefined): string[] {
  const requested = values === undefined ? DEFAULT_LANGUAGES : values
  const normalized = [...new Set(requested.map((value) => value.trim().toLowerCase()).filter(Boolean))]
  const unsupported = normalized.filter((value) => !isRepositoryIndexProducerLanguage(value))
  if (unsupported.length > 0) throw new Error(`repository index includeLanguages contains unsupported values: ${unsupported.join(", ")}`)
  return normalized.sort()
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const selected = value ?? fallback
  if (!Number.isFinite(selected) || selected <= 0) throw new Error(`${label} must be a positive finite number`)
  return Math.floor(selected)
}

function sha256(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

function edgeKey(edge: RepositoryIndexEdgeRecord): string {
  return `${edge.from}\u0000${edge.to ?? ""}\u0000${edge.kind}\u0000${edge.resolution}`
}

function edgeSortKey(edge: RepositoryIndexEdgeRecord): string {
  return `${edgeKey(edge)}\u0000${edge.reason}\u0000${edge.target_hint ?? ""}`
}

function compareEdges(left: RepositoryIndexEdgeRecord, right: RepositoryIndexEdgeRecord): number {
  return edgeSortKey(left).localeCompare(edgeSortKey(right))
}

function compareReferences(left: RepositoryReferenceCandidate, right: RepositoryReferenceCandidate): number {
  return left.from.localeCompare(right.from)
    || left.kind.localeCompare(right.kind)
    || (left.targetPath ?? "").localeCompare(right.targetPath ?? "")
    || (left.targetName ?? "").localeCompare(right.targetName ?? "")
    || left.reason.localeCompare(right.reason)
}
