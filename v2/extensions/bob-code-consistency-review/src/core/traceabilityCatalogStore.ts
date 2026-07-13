import { createHash, randomUUID } from "node:crypto"
import * as fs from "node:fs/promises"
import type { FileHandle } from "node:fs/promises"
import * as path from "node:path"
import { isInsidePath, resolveWorkspacePathForKind } from "./fileSystem"
import { decodeTextBuffer } from "./textEncoding"
import { renderTraceabilityGateReport, validateTraceabilityCatalog, type TraceabilityCatalog, type TraceabilityItem, type TraceabilityValidationReport } from "./traceabilityCatalog"

export const DEFAULT_TRACEABILITY_CATALOG_PATH = ".bob-trace/traceability-catalog.json"
export const DEFAULT_TRACEABILITY_GATE_REPORT_PATH = ".bob-trace/gate-report.md"

export type ReadTraceabilityCatalogResult =
  | { status: "ok"; catalog: TraceabilityCatalog; catalogPath: string; created: boolean; revision: string | null }
  | { status: "error"; catalogPath: string; errors: string[] }

export type WriteTraceabilityCatalogResult =
  | { status: "ok"; catalogPath: string; backupPath?: string; revision: string }
  | { status: "error"; catalogPath: string; errors: string[]; code?: "stale_revision" }

export type ValidateAndWriteTraceabilityGateReportResult =
  | { status: "ok"; catalogPath: string; reportPath: string; report: TraceabilityValidationReport; markdown: string; revision: string | null }
  | { status: "error"; catalogPath: string; reportPath: string; errors: string[]; code?: "stale_revision" }

const catalogPathTails = new Map<string, Promise<void>>()

type FileIdentity = { dev: bigint; ino: bigint }

type PhysicalTarget = {
  workspacePhysicalRoot: string
  logicalPath: string
  physicalPath: string
}

type ParentGuard = {
  workspacePhysicalRoot: string
  physicalPath: string
  identity: FileIdentity
}

class StaleCatalogRevisionError extends Error {
  constructor(
    readonly observedRevision: string | null,
    readonly currentRevision: string | null
  ) {
    super(staleRevisionMessage(observedRevision, currentRevision))
    this.name = "StaleCatalogRevisionError"
  }
}

export async function readTraceabilityCatalog(input: {
  workspaceRoot: string
  catalogPath?: string
  textEncoding?: string
}): Promise<ReadTraceabilityCatalogResult> {
  const workspacePhysicalRoot = await resolveWorkspacePhysicalRoot(input.workspaceRoot)
  const catalogPath = resolveCatalogPath(input.workspaceRoot, input.catalogPath)
  return withCatalogPathLock(workspacePhysicalRoot, catalogPath, async (target) => (
    readCatalogSnapshot(target, input.textEncoding, catalogPath)
  ))
}

export async function writeTraceabilityCatalog(input: {
  workspaceRoot: string
  catalogPath?: string
  catalog: TraceabilityCatalog
  backupExisting?: boolean
  expectedRevision?: string | null
}): Promise<WriteTraceabilityCatalogResult> {
  const workspacePhysicalRoot = await resolveWorkspacePhysicalRoot(input.workspaceRoot)
  const catalogPath = resolveCatalogPath(input.workspaceRoot, input.catalogPath)
  return withCatalogPathLock(workspacePhysicalRoot, catalogPath, async (target) => {
    let backupPath: string | undefined
    let backupParentGuard: ParentGuard | undefined
    try {
      const existingBytes = await readOptionalFile(target)
      const currentRevision = existingBytes ? contentRevision(existingBytes) : null
      if (input.expectedRevision !== undefined && input.expectedRevision !== currentRevision) {
        return staleCatalogWrite(catalogPath, input.expectedRevision, currentRevision)
      }

      if (input.backupExisting && existingBytes) {
        const parentGuard = await ensureParentGuard(target)
        backupParentGuard = parentGuard
        backupPath = uniqueBackupPath(target.physicalPath)
        await writeNewFile(backupPath, existingBytes, parentGuard)
      }
      const bytes = Buffer.from(`${JSON.stringify(normalizeCatalog(input.catalog), null, 2)}\n`, "utf8")
      await atomicReplaceFile(target, bytes, () => validateCatalogCommitRevision(target, currentRevision))
      return { status: "ok", catalogPath, backupPath, revision: contentRevision(bytes) }
    } catch (error) {
      if (error instanceof StaleCatalogRevisionError) {
        if (backupPath && backupParentGuard) await removeGuardedFile(backupPath, backupParentGuard)
        return staleCatalogWrite(catalogPath, error.observedRevision, error.currentRevision)
      }
      return {
        status: "error",
        catalogPath,
        errors: [`traceability catalog write failed: ${error instanceof Error ? error.message : String(error)}`]
      }
    }
  })
}

export async function validateAndWriteTraceabilityGateReport(input: {
  workspaceRoot: string
  catalogPath?: string
  reportPath?: string
  textEncoding?: string
  expectedRevision?: string | null
}): Promise<ValidateAndWriteTraceabilityGateReportResult> {
  const workspacePhysicalRoot = await resolveWorkspacePhysicalRoot(input.workspaceRoot)
  const catalogPath = resolveCatalogPath(input.workspaceRoot, input.catalogPath)
  const reportPath = resolveWorkspacePathForKind(input.workspaceRoot, input.reportPath ?? DEFAULT_TRACEABILITY_GATE_REPORT_PATH, "traceability-gate-report")
  return withCatalogPathLock(workspacePhysicalRoot, catalogPath, async (target) => {
    const read = await readCatalogSnapshot(target, input.textEncoding, catalogPath)
    if (read.status === "error") return { status: "error", catalogPath, reportPath, errors: read.errors }
    if (input.expectedRevision !== undefined && input.expectedRevision !== read.revision) {
      return {
        status: "error",
        code: "stale_revision",
        catalogPath,
        reportPath,
        errors: [staleRevisionMessage(input.expectedRevision, read.revision)]
      }
    }

    const report = validateTraceabilityCatalog(read.catalog)
    const markdown = renderTraceabilityGateReport(report)
    try {
      const reportTarget = await resolvePhysicalTarget(workspacePhysicalRoot, reportPath)
      if (samePhysicalPath(reportTarget.physicalPath, target.physicalPath)) {
        throw new Error(`traceability gate report resolves to the same physical target as the catalog: ${reportPath}`)
      }
      await atomicReplaceFile(
        reportTarget,
        Buffer.from(markdown, "utf8"),
        () => validateCatalogCommitRevision(target, read.revision)
      )
      return { status: "ok", catalogPath, reportPath, report, markdown, revision: read.revision }
    } catch (error) {
      if (error instanceof StaleCatalogRevisionError) {
        return {
          status: "error",
          code: "stale_revision",
          catalogPath,
          reportPath,
          errors: [error.message]
        }
      }
      return {
        status: "error",
        catalogPath,
        reportPath,
        errors: [`traceability gate report write failed: ${error instanceof Error ? error.message : String(error)}`]
      }
    }
  })
}

export function emptyTraceabilityCatalog(): TraceabilityCatalog {
  return {
    schema_version: 1,
    documents: [],
    domains: [],
    items: [],
    links: [],
    decisions: []
  }
}

export function resolveCatalogPath(workspaceRoot: string, catalogPath = DEFAULT_TRACEABILITY_CATALOG_PATH): string {
  return resolveWorkspacePathForKind(workspaceRoot, catalogPath, "traceability-catalog")
}

function normalizeCatalog(value: unknown): TraceabilityCatalog {
  const record = isRecord(value) ? value : {}
  const maybeWrapped = isRecord(record.catalog) ? record.catalog : record
  const catalog = maybeWrapped as Partial<TraceabilityCatalog>
  return {
    schema_version: 1,
    documents: Array.isArray(catalog.documents) ? catalog.documents : [],
    domains: Array.isArray(catalog.domains) ? catalog.domains : [],
    items: Array.isArray(catalog.items) ? catalog.items.map(normalizeCatalogItem) : [],
    links: Array.isArray(catalog.links) ? catalog.links : [],
    decisions: Array.isArray(catalog.decisions) ? catalog.decisions : []
  }
}

function normalizeCatalogItem(item: TraceabilityItem): TraceabilityItem {
  const sequence = sequenceFromTraceabilityId(item.id ?? item.proposed_id)
  return sequence === undefined ? item : { ...item, sequence }
}

function sequenceFromTraceabilityId(id: string | null | undefined): number | undefined {
  if (!id) return undefined
  const match = id.match(/-(\d{4})$/)
  if (!match) return undefined
  const sequence = Number(match[1])
  return Number.isInteger(sequence) && sequence > 0 ? sequence : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function timestampForFileName(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}

async function readCatalogSnapshot(
  target: PhysicalTarget,
  textEncoding = "utf8",
  catalogPath = target.logicalPath
): Promise<ReadTraceabilityCatalogResult> {
  let bytes: Buffer | undefined
  try {
    bytes = await readOptionalFile(target)
  } catch (error) {
    return {
      status: "error",
      catalogPath,
      errors: [`traceability catalog read failed: ${error instanceof Error ? error.message : String(error)}`]
    }
  }
  if (!bytes) {
    return { status: "ok", catalog: emptyTraceabilityCatalog(), catalogPath, created: true, revision: null }
  }
  try {
    const parsed = JSON.parse(decodeTextBuffer(bytes, textEncoding)) as unknown
    return {
      status: "ok",
      catalog: normalizeCatalog(parsed),
      catalogPath,
      created: false,
      revision: contentRevision(bytes)
    }
  } catch (error) {
    return {
      status: "error",
      catalogPath,
      errors: [`traceability catalog JSON parse failed: ${error instanceof Error ? error.message : String(error)}`]
    }
  }
}

async function readOptionalFile(target: PhysicalTarget): Promise<Buffer | undefined> {
  await validatePhysicalTarget(target)
  let handle: FileHandle
  try {
    handle = await fs.open(target.physicalPath, "r")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await validatePhysicalTarget(target)
      return undefined
    }
    throw error
  }
  try {
    await validatePhysicalTarget(target)
    await assertOpenHandleIdentity(handle, target.physicalPath, target.workspacePhysicalRoot)
    return await handle.readFile()
  } finally {
    await handle.close()
  }
}

async function validateCatalogCommitRevision(target: PhysicalTarget, observedRevision: string | null): Promise<void> {
  const commitBytes = await readOptionalFile(target)
  const commitRevision = commitBytes ? contentRevision(commitBytes) : null
  if (commitRevision !== observedRevision) {
    throw new StaleCatalogRevisionError(observedRevision, commitRevision)
  }
}

function contentRevision(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

function uniqueBackupPath(catalogPath: string): string {
  return `${catalogPath}.bak-${timestampForFileName(new Date())}-${randomUUID().replace(/-/g, "").slice(0, 12)}`
}

async function atomicReplaceFile(
  target: PhysicalTarget,
  bytes: Uint8Array,
  validateCommit?: () => Promise<void>
): Promise<void> {
  const parentGuard = await ensureParentGuard(target)
  const tempPath = path.join(parentGuard.physicalPath, `.${path.basename(target.physicalPath)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    await writeNewFile(tempPath, bytes, parentGuard)
    await renameWithTransientRetry(tempPath, target.physicalPath, async () => {
      await validateParentGuard(parentGuard)
      await validatePhysicalTarget(target)
      await assertPhysicalPathMatches(target.workspacePhysicalRoot, tempPath, tempPath)
      await validateCommit?.()
    })
    await validatePhysicalTarget(target)
  } catch (error) {
    await removeGuardedFile(tempPath, parentGuard)
    throw error
  }
}

async function renameWithTransientRetry(source: string, target: string, validate: () => Promise<void>): Promise<void> {
  const delaysMs = [10, 50, 100]
  for (let attempt = 0; ; attempt += 1) {
    try {
      // Node has no portable openat/renameat2 API. Revalidate immediately before
      // every rename attempt; only the final check-to-rename scheduler gap remains.
      await validate()
      await fs.rename(source, target)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (!(["EPERM", "EACCES", "EBUSY"].includes(code ?? "")) || attempt >= delaysMs.length) throw error
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]))
    }
  }
}

async function withCatalogPathLock<T>(
  workspacePhysicalRoot: string,
  catalogPath: string,
  operation: (target: PhysicalTarget) => Promise<T>
): Promise<T> {
  const initialTarget = await resolvePhysicalTarget(workspacePhysicalRoot, catalogPath)
  const key = normalizeLockKey(initialTarget.physicalPath)
  const prior = catalogPathTails.get(key) ?? Promise.resolve()
  const owner = prior.then(
    async () => operation(await reacquirePhysicalTarget(initialTarget)),
    async () => operation(await reacquirePhysicalTarget(initialTarget))
  )
  const tail = owner.then(() => undefined, () => undefined)
  catalogPathTails.set(key, tail)
  void tail.then(() => {
    if (catalogPathTails.get(key) === tail) catalogPathTails.delete(key)
  })
  return owner
}

async function resolveWorkspacePhysicalRoot(workspaceRoot: string): Promise<string> {
  const physicalRoot = await fs.realpath(path.resolve(workspaceRoot))
  const stats = await fs.stat(physicalRoot)
  if (!stats.isDirectory()) throw new Error(`traceability workspace root is not a directory: ${workspaceRoot}`)
  return physicalRoot
}

async function resolvePhysicalTarget(workspacePhysicalRoot: string, logicalPath: string): Promise<PhysicalTarget> {
  return {
    workspacePhysicalRoot,
    logicalPath,
    physicalPath: await resolvePhysicalTargetPath(workspacePhysicalRoot, logicalPath)
  }
}

async function reacquirePhysicalTarget(initial: PhysicalTarget): Promise<PhysicalTarget> {
  const current = await resolvePhysicalTarget(initial.workspacePhysicalRoot, initial.logicalPath)
  if (!samePhysicalPath(current.physicalPath, initial.physicalPath)) {
    throw new Error(`traceability catalog target changed during operation: ${initial.logicalPath}`)
  }
  await validatePhysicalTarget(current)
  return current
}

async function resolvePhysicalTargetPath(workspacePhysicalRoot: string, targetPath: string): Promise<string> {
  const resolved = path.resolve(targetPath)
  let current = resolved
  const missingSuffix: string[] = []
  while (true) {
    try {
      const realAncestor = await fs.realpath(current)
      const physicalPath = path.resolve(realAncestor, ...missingSuffix)
      assertInsidePhysicalWorkspace(workspacePhysicalRoot, physicalPath, targetPath)
      return physicalPath
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error
      try {
        const stats = await fs.lstat(current)
        if (stats.isSymbolicLink()) {
          throw new Error(`traceability catalog target is a dangling symbolic link: ${targetPath}`)
        }
      } catch (lstatError) {
        const lstatCode = (lstatError as NodeJS.ErrnoException).code
        if (lstatCode !== "ENOENT" && lstatCode !== "ENOTDIR") throw lstatError
      }
      const parent = path.dirname(current)
      if (parent === current) {
        assertInsidePhysicalWorkspace(workspacePhysicalRoot, resolved, targetPath)
        return resolved
      }
      missingSuffix.unshift(path.basename(current))
      current = parent
    }
  }
}

async function validatePhysicalTarget(target: PhysicalTarget): Promise<void> {
  await assertPhysicalPathMatches(target.workspacePhysicalRoot, target.physicalPath, target.physicalPath)
}

async function assertPhysicalPathMatches(workspacePhysicalRoot: string, targetPath: string, expectedPath: string): Promise<void> {
  const current = await resolvePhysicalTargetPath(workspacePhysicalRoot, targetPath)
  if (!samePhysicalPath(current, expectedPath)) {
    throw new Error(`traceability catalog target changed during operation: ${targetPath}`)
  }
}

function assertInsidePhysicalWorkspace(workspacePhysicalRoot: string, targetPath: string, logicalPath: string): void {
  if (!isInsidePath(workspacePhysicalRoot, targetPath)) {
    throw new Error(`traceability catalog target resolves outside workspace: ${logicalPath}`)
  }
}

async function ensureParentGuard(target: PhysicalTarget): Promise<ParentGuard> {
  await validatePhysicalTarget(target)
  const parentPath = path.dirname(target.physicalPath)
  await assertPhysicalPathMatches(target.workspacePhysicalRoot, parentPath, parentPath)
  await fs.mkdir(parentPath, { recursive: true })
  const physicalParent = await fs.realpath(parentPath)
  assertInsidePhysicalWorkspace(target.workspacePhysicalRoot, physicalParent, parentPath)
  if (!samePhysicalPath(physicalParent, parentPath)) {
    throw new Error(`traceability catalog parent changed during operation: ${parentPath}`)
  }
  const identity = identityFromStats(await fs.stat(parentPath, { bigint: true }))
  const guard = { workspacePhysicalRoot: target.workspacePhysicalRoot, physicalPath: parentPath, identity }
  await validateParentGuard(guard)
  return guard
}

async function validateParentGuard(guard: ParentGuard): Promise<void> {
  const physicalParent = await fs.realpath(guard.physicalPath)
  assertInsidePhysicalWorkspace(guard.workspacePhysicalRoot, physicalParent, guard.physicalPath)
  if (!samePhysicalPath(physicalParent, guard.physicalPath)) {
    throw new Error(`traceability catalog parent changed during operation: ${guard.physicalPath}`)
  }
  const currentIdentity = identityFromStats(await fs.stat(guard.physicalPath, { bigint: true }))
  if (!sameFileIdentity(currentIdentity, guard.identity)) {
    throw new Error(`traceability catalog parent identity changed during operation: ${guard.physicalPath}`)
  }
}

async function writeNewFile(filePath: string, bytes: Uint8Array, parentGuard: ParentGuard): Promise<void> {
  if (!samePhysicalPath(path.dirname(filePath), parentGuard.physicalPath)) {
    throw new Error(`traceability catalog output parent mismatch: ${filePath}`)
  }
  await validateParentGuard(parentGuard)
  let handle: FileHandle | undefined
  try {
    handle = await fs.open(filePath, "wx")
    await validateParentGuard(parentGuard)
    await assertOpenHandleIdentity(handle, filePath, parentGuard.workspacePhysicalRoot)
    await handle.writeFile(bytes)
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined)
    await removeGuardedFile(filePath, parentGuard)
    throw error
  } finally {
    if (handle) await handle.close().catch(() => undefined)
  }
}

async function removeGuardedFile(filePath: string, parentGuard: ParentGuard): Promise<void> {
  try {
    await validateParentGuard(parentGuard)
    await assertPhysicalPathMatches(parentGuard.workspacePhysicalRoot, filePath, filePath)
    await fs.rm(filePath, { force: true })
  } catch {
    // Never follow an unverified cleanup path after a failed guarded write.
  }
}

async function assertOpenHandleIdentity(handle: FileHandle, filePath: string, workspacePhysicalRoot: string): Promise<void> {
  const physicalPath = await fs.realpath(filePath)
  assertInsidePhysicalWorkspace(workspacePhysicalRoot, physicalPath, filePath)
  if (!samePhysicalPath(physicalPath, filePath)) {
    throw new Error(`traceability catalog target changed during open: ${filePath}`)
  }
  const [handleIdentity, pathIdentity] = await Promise.all([
    handle.stat({ bigint: true }).then(identityFromStats),
    fs.stat(filePath, { bigint: true }).then(identityFromStats)
  ])
  if (!sameFileIdentity(handleIdentity, pathIdentity)) {
    throw new Error(`traceability catalog target identity changed during open: ${filePath}`)
  }
}

function identityFromStats(stats: { dev: bigint; ino: bigint }): FileIdentity {
  return { dev: stats.dev, ino: stats.ino }
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function samePhysicalPath(left: string, right: string): boolean {
  return normalizeLockKey(left) === normalizeLockKey(right)
}

function normalizeLockKey(value: string): string {
  const normalized = path.normalize(value)
  return process.platform === "win32" ? normalized.toLocaleLowerCase() : normalized
}

function staleCatalogWrite(
  catalogPath: string,
  expectedRevision: string | null,
  currentRevision: string | null
): WriteTraceabilityCatalogResult {
  return {
    status: "error",
    code: "stale_revision",
    catalogPath,
    errors: [staleRevisionMessage(expectedRevision, currentRevision)]
  }
}

function staleRevisionMessage(expectedRevision: string | null, currentRevision: string | null): string {
  return `traceability catalog stale revision (expected ${expectedRevision ?? "missing"}, current ${currentRevision ?? "missing"}); refresh and retry`
}
