import * as fs from "node:fs/promises"
import {
  normalizeChangedFilePathStrict,
  relativePosix,
  resolveWorkspacePathForKind
} from "../core/fileSystem"
import { writeAtomicTextFile } from "./repositoryIndexCache"

export const ARTIFACT_LEDGER_PATH = ".bob-review/artifact-ledger.json"
const LEDGER_ID = "bob-evidence-scope"
const MAX_ARTIFACT_RECORDS = 512
const MAX_DEPENDENCIES_PER_RECORD = 64
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u
const REVISION_PATTERN = /^[A-Za-z0-9._/@:+~^-]+(?:\.\.[A-Za-z0-9._/@:+~^-]+)?$/u

export type ArtifactKind = "repository-symbol-index" | "project-rule-pack" | "review-package"
export type ArtifactStatus = "fresh" | "stale" | "missing"

export type ArtifactObservation = {
  id: string
  kind: ArtifactKind
  producer: string
  path: string
  content_hash: string
  input_hash: string
  source_revision: string
  depends_on: string[]
}

export type ArtifactLedgerRecord = ArtifactObservation & {
  status: ArtifactStatus
  stale_reasons: string[]
}

export type ArtifactLedger = {
  schema_version: 1
  ledger_id: "bob-evidence-scope"
  source_revision: string
  artifacts: ArtifactLedgerRecord[]
}

export type ArtifactLedgerReconcileInput = {
  sourceRevision: string
  observations: ArtifactObservation[]
  completeKinds: ArtifactKind[]
}

export type ArtifactLedgerLoadResult = {
  ledger?: ArtifactLedger
  path: string
  warnings: string[]
}

export type ArtifactLedgerUpdateResult = {
  ledger: ArtifactLedger
  path: string
  warnings: string[]
  fresh: number
  stale: number
  missing: number
}

export function reconcileArtifactLedger(
  previous: ArtifactLedger | undefined,
  input: ArtifactLedgerReconcileInput
): ArtifactLedger {
  const sourceRevision = normalizeRevision(input.sourceRevision, "artifact ledger source revision")
  const normalizedPrevious = previous ? validateLedger(previous) : undefined
  const observations = normalizeObservations(input.observations)
  const completeKinds = new Set(input.completeKinds.map(normalizeKind))
  const observedIds = new Set(observations.map((item) => item.id))
  const previousById = new Map((normalizedPrevious?.artifacts ?? []).map((item) => [item.id, item]))
  const records = new Map<string, ArtifactLedgerRecord>()
  const changedObservedIds = new Set<string>()

  for (const previousRecord of normalizedPrevious?.artifacts ?? []) {
    records.set(previousRecord.id, cloneRecord(previousRecord))
  }

  for (const current of observations) {
    const old = previousById.get(current.id)
    if (old && artifactFingerprint(old) !== artifactFingerprint(current)) {
      changedObservedIds.add(current.id)
    }
    records.set(current.id, {
      ...current,
      status: "fresh",
      stale_reasons: []
    })
  }

  const revisionChanged = Boolean(normalizedPrevious && normalizedPrevious.source_revision !== sourceRevision)
  for (const [id, record] of records) {
    if (observedIds.has(id)) continue
    const reasons = new Set(record.stale_reasons)
    if (completeKinds.has(record.kind)) {
      record.status = "missing"
      reasons.add("artifact-missing")
    } else if (revisionChanged) {
      if (record.status !== "missing") record.status = "stale"
      reasons.add("source-revision-changed")
    }
    for (const dependencyId of record.depends_on) {
      if (changedObservedIds.has(dependencyId)) {
        if (record.status !== "missing") record.status = "stale"
        reasons.add(`upstream-changed:${dependencyId}`)
      }
    }
    record.stale_reasons = [...reasons].sort()
  }

  let changed = true
  while (changed) {
    changed = false
    for (const record of records.values()) {
      const reasons = new Set(record.stale_reasons)
      let nextStatus = record.status
      for (const dependencyId of record.depends_on) {
        const dependency = records.get(dependencyId)
        if (!dependency || dependency.status === "missing") {
          if (nextStatus !== "missing") nextStatus = "stale"
          reasons.add(`dependency-missing:${dependencyId}`)
        } else if (dependency.status === "stale") {
          if (nextStatus !== "missing") nextStatus = "stale"
          reasons.add(`dependency-stale:${dependencyId}`)
        }
      }
      const nextReasons = [...reasons].sort()
      if (nextStatus !== record.status || !sameStrings(nextReasons, record.stale_reasons)) {
        record.status = nextStatus
        record.stale_reasons = nextReasons
        changed = true
      }
    }
  }

  return {
    schema_version: 1,
    ledger_id: LEDGER_ID,
    source_revision: sourceRevision,
    artifacts: [...records.values()].map(normalizeRecord).sort((left, right) => left.id.localeCompare(right.id))
  }
}

export async function loadArtifactLedger(input: {
  workspaceRoot: string
  maxBytes: number
  ledgerPath?: string
}): Promise<ArtifactLedgerLoadResult> {
  const relativePath = input.ledgerPath ?? ARTIFACT_LEDGER_PATH
  const filePath = resolveWorkspacePathForKind(input.workspaceRoot, relativePath, "artifact-ledger")
  try {
    const raw = await readBoundedFile(filePath, input.maxBytes)
    return {
      ledger: validateLedger(JSON.parse(raw.toString("utf8")) as unknown),
      path: relativePosix(input.workspaceRoot, filePath),
      warnings: []
    }
  } catch (error) {
    if (isMissing(error)) {
      return { path: relativePosix(input.workspaceRoot, filePath), warnings: [] }
    }
    return {
      path: relativePosix(input.workspaceRoot, filePath),
      warnings: [`artifact ledger ignored: ${message(error)}`]
    }
  }
}

export async function writeArtifactLedger(input: {
  workspaceRoot: string
  ledger: ArtifactLedger
  ledgerPath?: string
}): Promise<string> {
  const relativePath = input.ledgerPath ?? ARTIFACT_LEDGER_PATH
  const filePath = resolveWorkspacePathForKind(input.workspaceRoot, relativePath, "artifact-ledger")
  const ledger = validateLedger(input.ledger)
  await writeAtomicTextFile(filePath, `${JSON.stringify(ledger, null, 2)}\n`)
  return relativePosix(input.workspaceRoot, filePath)
}

export async function updateArtifactLedger(input: {
  workspaceRoot: string
  sourceRevision: string
  observations: ArtifactObservation[]
  completeKinds: ArtifactKind[]
  maxBytes: number
  ledgerPath?: string
}): Promise<ArtifactLedgerUpdateResult> {
  const loaded = await loadArtifactLedger(input)
  const ledger = reconcileArtifactLedger(loaded.ledger, input)
  const ledgerPath = await writeArtifactLedger({
    workspaceRoot: input.workspaceRoot,
    ledger,
    ledgerPath: input.ledgerPath
  })
  return {
    ledger,
    path: ledgerPath,
    warnings: loaded.warnings,
    fresh: ledger.artifacts.filter((item) => item.status === "fresh").length,
    stale: ledger.artifacts.filter((item) => item.status === "stale").length,
    missing: ledger.artifacts.filter((item) => item.status === "missing").length
  }
}

function normalizeObservations(values: ArtifactObservation[]): ArtifactObservation[] {
  if (!Array.isArray(values)) throw new Error("artifact observations must be an array")
  if (values.length > MAX_ARTIFACT_RECORDS) {
    throw new Error(`artifact observation count exceeded maximum (${values.length} > ${MAX_ARTIFACT_RECORDS})`)
  }
  const ids = new Set<string>()
  const result = values.map((value) => {
    const observation = normalizeObservation(value)
    if (ids.has(observation.id)) throw new Error(`duplicate artifact observation id: ${observation.id}`)
    ids.add(observation.id)
    return observation
  })
  return result.sort((left, right) => left.id.localeCompare(right.id))
}

function normalizeObservation(value: ArtifactObservation): ArtifactObservation {
  if (!isRecord(value)) throw new Error("artifact observation must be an object")
  const id = normalizeText(value.id, "artifact id")
  const kind = normalizeKind(value.kind)
  const producer = normalizeText(value.producer, `artifact ${id} producer`)
  const artifactPath = normalizeChangedFilePathStrict(value.path, `artifact ${id} path`)
  const contentHash = normalizeHash(value.content_hash, `artifact ${id} content_hash`)
  const inputHash = normalizeHash(value.input_hash, `artifact ${id} input_hash`)
  const sourceRevision = normalizeRecordRevision(value.source_revision, `artifact ${id} source_revision`)
  if (!Array.isArray(value.depends_on)) throw new Error(`artifact ${id} depends_on must be an array`)
  if (value.depends_on.length > MAX_DEPENDENCIES_PER_RECORD) {
    throw new Error(`artifact ${id} dependency count exceeded maximum`)
  }
  const dependsOn = [...new Set(value.depends_on.map((item) => normalizeText(item, `artifact ${id} dependency`)))].sort()
  if (dependsOn.includes(id)) throw new Error(`artifact ${id} must not depend on itself`)
  return {
    id,
    kind,
    producer,
    path: artifactPath,
    content_hash: contentHash,
    input_hash: inputHash,
    source_revision: sourceRevision,
    depends_on: dependsOn
  }
}

function validateLedger(value: unknown): ArtifactLedger {
  if (!isRecord(value)) throw new Error("artifact ledger root must be an object")
  if (value.schema_version !== 1) throw new Error(`unsupported artifact ledger schema_version: ${String(value.schema_version)}`)
  if (value.ledger_id !== LEDGER_ID) throw new Error(`unsupported artifact ledger id: ${String(value.ledger_id)}`)
  const sourceRevision = normalizeRevision(value.source_revision, "artifact ledger source revision")
  if (!Array.isArray(value.artifacts)) throw new Error("artifact ledger artifacts must be an array")
  if (value.artifacts.length > MAX_ARTIFACT_RECORDS) {
    throw new Error(`artifact ledger record count exceeded maximum (${value.artifacts.length} > ${MAX_ARTIFACT_RECORDS})`)
  }
  const ids = new Set<string>()
  const artifacts = value.artifacts.map((item) => {
    if (!isRecord(item)) throw new Error("artifact ledger record must be an object")
    const observation = normalizeObservation(item as unknown as ArtifactObservation)
    if (ids.has(observation.id)) throw new Error(`duplicate artifact ledger id: ${observation.id}`)
    ids.add(observation.id)
    const status = normalizeStatus(item.status)
    if (!Array.isArray(item.stale_reasons)) throw new Error(`artifact ${observation.id} stale_reasons must be an array`)
    const staleReasons = [...new Set(item.stale_reasons.map((reason) => normalizeText(reason, `artifact ${observation.id} stale reason`)))].sort()
    return normalizeRecord({ ...observation, status, stale_reasons: staleReasons })
  }).sort((left, right) => left.id.localeCompare(right.id))
  return {
    schema_version: 1,
    ledger_id: LEDGER_ID,
    source_revision: sourceRevision,
    artifacts
  }
}

function normalizeRecord(value: ArtifactLedgerRecord): ArtifactLedgerRecord {
  return {
    ...normalizeObservation(value),
    status: normalizeStatus(value.status),
    stale_reasons: [...new Set(value.stale_reasons)].sort()
  }
}

async function readBoundedFile(filePath: string, maxBytes: number): Promise<Buffer> {
  const safeMaxBytes = positiveInteger(maxBytes, "artifact ledger maxBytes")
  const handle = await fs.open(filePath, "r")
  try {
    const before = await handle.stat()
    if (!before.isFile()) throw new Error(`artifact ledger path is not a file: ${filePath}`)
    if (before.size > safeMaxBytes) throw new Error(`artifact ledger exceeded maxBytes (${before.size} > ${safeMaxBytes})`)
    const buffer = Buffer.alloc(before.size)
    let offset = 0
    while (offset < buffer.length) {
      const result = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (result.bytesRead === 0) break
      offset += result.bytesRead
    }
    const after = await handle.stat()
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || offset !== before.size) {
      throw new Error("artifact ledger changed while reading")
    }
    return buffer
  } finally {
    await handle.close()
  }
}

function artifactFingerprint(value: ArtifactObservation): string {
  return JSON.stringify([
    value.kind,
    value.producer,
    value.path,
    value.content_hash,
    value.input_hash,
    value.source_revision,
    [...value.depends_on].sort()
  ])
}

function normalizeKind(value: unknown): ArtifactKind {
  if (value === "repository-symbol-index" || value === "project-rule-pack" || value === "review-package") return value
  throw new Error(`unsupported artifact kind: ${String(value)}`)
}

function normalizeStatus(value: unknown): ArtifactStatus {
  if (value === "fresh" || value === "stale" || value === "missing") return value
  throw new Error(`unsupported artifact status: ${String(value)}`)
}

function normalizeHash(value: unknown, label: string): string {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) throw new Error(`${label} is invalid`)
  return value
}

function normalizeRevision(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid`)
  const normalized = value.trim()
  if (!normalized || normalized.length > 512 || !REVISION_PATTERN.test(normalized)) {
    throw new Error(`${label} is invalid: ${value}`)
  }
  return normalized
}

function normalizeRecordRevision(value: unknown, label: string): string {
  return normalizeRevision(value, label)
}

function normalizeText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || /[\0-\x1f\x7f]/u.test(value)) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

function cloneRecord(value: ArtifactLedgerRecord): ArtifactLedgerRecord {
  return {
    ...value,
    depends_on: [...value.depends_on],
    stale_reasons: [...value.stale_reasons]
  }
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`)
  return Math.floor(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
