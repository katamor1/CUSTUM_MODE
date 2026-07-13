import { randomUUID } from "crypto"
import { constants } from "fs"
import * as fs from "fs/promises"
import * as path from "path"
import { assertSafeWorkflowRunId } from "./runStatePath"

export type RunDurabilityFileName = "events.ndjson" | "run-state.journal.json" | "run.lock.json"
export type RunMaterializedFileName = "run.json" | "control.json"

export interface RunDurabilityFileSnapshot {
  bytes: Buffer
  filePath: string
  mtimeMs: number
}

type FileIdentity = {
  dev: bigint
  ino: bigint
}

type DirectDirectory = FileIdentity & {
  path: string
}

const RUNS_ROOT_SEGMENTS = [".bob", "workflows", "runs"] as const
const DURABILITY_FILE_NAMES = new Set<RunDurabilityFileName>([
  "events.ndjson",
  "run-state.journal.json",
  "run.lock.json"
])

export async function readRunDurabilityFile(
  workspaceRoot: string,
  runId: string,
  fileName: RunDurabilityFileName
): Promise<RunDurabilityFileSnapshot | undefined> {
  assertRunDurabilityFileName(fileName)
  assertSafeWorkflowRunId(runId)
  const root = await canonicalWorkspaceRoot(workspaceRoot)
  let runDirectory: DirectDirectory
  try {
    runDirectory = await directDirectoryChain(root, [...RUNS_ROOT_SEGMENTS, runId], false)
  } catch (error) {
    if (isMissingPathError(error)) return undefined
    throw error
  }
  const filePath = path.join(runDirectory.path, fileName)
  const identity = await optionalDirectRegularFile(filePath, root, durabilityLabel(runId, fileName))
  if (!identity) return undefined
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0
  const handle = await fs.open(filePath, constants.O_RDONLY | noFollow)
  try {
    const handleStat = await handle.stat({ bigint: true })
    const current = await directRegularFile(filePath, root, durabilityLabel(runId, fileName))
    if (!handleStat.isFile() || !sameIdentity(identity, handleStat) || !sameIdentity(handleStat, current)) {
      throw new Error(`${durabilityLabel(runId, fileName)} changed while it was being read.`)
    }
    const numericStat = await handle.stat()
    return { bytes: await handle.readFile(), filePath, mtimeMs: numericStat.mtimeMs }
  } finally {
    await handle.close()
  }
}

export async function replaceRunDurabilityFile(
  workspaceRoot: string,
  runId: string,
  fileName: RunDurabilityFileName,
  content: string,
  expectedBytes?: Buffer
): Promise<void> {
  assertRunDurabilityFileName(fileName)
  assertSafeWorkflowRunId(runId)
  if (expectedBytes) {
    const expectedSnapshot = await readRunDurabilityFile(workspaceRoot, runId, fileName)
    if (!expectedSnapshot || !expectedSnapshot.bytes.equals(expectedBytes)) {
      throw new Error(`${durabilityLabel(runId, fileName)} changed before replacement.`)
    }
  }
  const root = await canonicalWorkspaceRoot(workspaceRoot)
  const runDirectory = await directDirectoryChain(root, [...RUNS_ROOT_SEGMENTS, runId], true)
  const filePath = path.join(runDirectory.path, fileName)
  const original = await optionalDirectRegularFile(filePath, root, durabilityLabel(runId, fileName))
  const tempPath = path.join(runDirectory.path, `.${fileName}.${process.pid}.${randomUUID()}.tmp`)
  let tempIdentity: FileIdentity | undefined
  try {
    await assertDirectoryIdentity(runDirectory, `Workflow run '${runId}' directory`)
    const handle = await fs.open(tempPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
    try {
      await handle.writeFile(content, { encoding: "utf8" })
      await handle.sync()
      const stat = await handle.stat({ bigint: true })
      if (!stat.isFile()) throw new Error(`${durabilityLabel(runId, fileName)} temporary path is not a regular file.`)
      tempIdentity = { dev: stat.dev, ino: stat.ino }
    } finally {
      await handle.close()
    }
    await assertTargetUnchanged(root, runDirectory, filePath, original, runId, fileName)
    await renameWithRetry(tempPath, filePath, async () => {
      await assertTargetUnchanged(root, runDirectory, filePath, original, runId, fileName)
      const currentTemp = await directRegularFile(tempPath, root, `${durabilityLabel(runId, fileName)} temporary file`)
      if (!sameIdentity(tempIdentity!, currentTemp)) {
        throw new Error(`${durabilityLabel(runId, fileName)} temporary file changed before rename.`)
      }
    })
    const written = await directRegularFile(filePath, root, durabilityLabel(runId, fileName))
    if (!sameIdentity(tempIdentity, written)) throw new Error(`${durabilityLabel(runId, fileName)} changed during atomic replacement.`)
    await syncDirectFile(filePath, root, durabilityLabel(runId, fileName))
    await syncDirectory(runDirectory.path)
  } finally {
    if (await directoryStillMatches(runDirectory)) await fs.rm(tempPath, { force: true }).catch(() => undefined)
  }
}

export async function createRunDurabilityFile(
  workspaceRoot: string,
  runId: string,
  fileName: RunDurabilityFileName,
  content: string
): Promise<boolean> {
  assertRunDurabilityFileName(fileName)
  assertSafeWorkflowRunId(runId)
  const root = await canonicalWorkspaceRoot(workspaceRoot)
  const runDirectory = await directDirectoryChain(root, [...RUNS_ROOT_SEGMENTS, runId], true)
  const filePath = path.join(runDirectory.path, fileName)
  await assertDirectoryIdentity(runDirectory, `Workflow run '${runId}' directory`)
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0
  let handle: Awaited<ReturnType<typeof fs.open>>
  try {
    handle = await fs.open(filePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      await directRegularFile(filePath, root, durabilityLabel(runId, fileName))
      return false
    }
    throw error
  }
  try {
    await handle.writeFile(content, { encoding: "utf8" })
    await handle.sync()
    const handleStat = await handle.stat({ bigint: true })
    const target = await directRegularFile(filePath, root, durabilityLabel(runId, fileName))
    if (!handleStat.isFile() || !sameIdentity(handleStat, target)) {
      throw new Error(`${durabilityLabel(runId, fileName)} changed during exclusive creation.`)
    }
  } finally {
    await handle.close()
  }
  await syncDirectory(runDirectory.path)
  return true
}

export async function appendRunDurabilityFile(
  workspaceRoot: string,
  runId: string,
  fileName: Extract<RunDurabilityFileName, "events.ndjson">,
  content: string
): Promise<void> {
  if (!content.endsWith("\n")) throw new Error("Workflow run event append must end with a newline.")
  assertSafeWorkflowRunId(runId)
  const root = await canonicalWorkspaceRoot(workspaceRoot)
  const runDirectory = await directDirectoryChain(root, [...RUNS_ROOT_SEGMENTS, runId], true)
  const filePath = path.join(runDirectory.path, fileName)
  const existing = await optionalDirectRegularFile(filePath, root, durabilityLabel(runId, fileName))
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0
  const handle = await fs.open(filePath, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | noFollow, 0o600)
  try {
    const handleStat = await handle.stat({ bigint: true })
    const target = await directRegularFile(filePath, root, durabilityLabel(runId, fileName))
    if (!handleStat.isFile() || !sameIdentity(handleStat, target)) {
      throw new Error(`${durabilityLabel(runId, fileName)} changed while it was opened for append.`)
    }
    if (existing && !sameIdentity(existing, target)) {
      throw new Error(`${durabilityLabel(runId, fileName)} changed before append.`)
    }
    await handle.write(content, undefined, "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }
  await assertDirectoryIdentity(runDirectory, `Workflow run '${runId}' directory`)
  await syncDirectory(runDirectory.path)
}

export async function removeRunDurabilityFile(
  workspaceRoot: string,
  runId: string,
  fileName: RunDurabilityFileName,
  expectedBytes?: Buffer
): Promise<boolean> {
  const snapshot = await readRunDurabilityFile(workspaceRoot, runId, fileName)
  if (!snapshot) return false
  if (expectedBytes && !snapshot.bytes.equals(expectedBytes)) return false
  const root = await canonicalWorkspaceRoot(workspaceRoot)
  const runDirectory = await directDirectoryChain(root, [...RUNS_ROOT_SEGMENTS, runId], false)
  const before = await directRegularFile(snapshot.filePath, root, durabilityLabel(runId, fileName))
  const reread = await readRunDurabilityFile(workspaceRoot, runId, fileName)
  if (!reread) return false
  if (expectedBytes && !reread.bytes.equals(expectedBytes)) return false
  const current = await directRegularFile(snapshot.filePath, root, durabilityLabel(runId, fileName))
  if (!sameIdentity(before, current)) return false
  await fs.rm(snapshot.filePath)
  await assertDirectoryIdentity(runDirectory, `Workflow run '${runId}' directory`)
  await syncDirectory(runDirectory.path)
  return true
}

export async function syncRunMaterializedFile(
  workspaceRoot: string,
  runId: string,
  fileName: RunMaterializedFileName = "run.json"
): Promise<void> {
  assertSafeWorkflowRunId(runId)
  const root = await canonicalWorkspaceRoot(workspaceRoot)
  const runDirectory = await directDirectoryChain(root, [...RUNS_ROOT_SEGMENTS, runId], false)
  const filePath = path.join(runDirectory.path, fileName)
  await syncDirectFile(filePath, root, `Workflow run '${runId}' ${fileName}`)
  await syncDirectory(runDirectory.path)
}

function assertRunDurabilityFileName(fileName: string): asserts fileName is RunDurabilityFileName {
  if (!DURABILITY_FILE_NAMES.has(fileName as RunDurabilityFileName)) {
    throw new Error(`Workflow run durability file name is not supported: ${fileName}`)
  }
}

async function canonicalWorkspaceRoot(workspaceRoot: string): Promise<string> {
  if (!workspaceRoot.trim()) throw new Error("Workflow workspace root is empty.")
  return fs.realpath(path.resolve(workspaceRoot))
}

async function directDirectoryChain(root: string, segments: readonly string[], create: boolean): Promise<DirectDirectory> {
  let current = root
  let identity = await directDirectory(current, root, "Workflow workspace root")
  for (const segment of segments) {
    current = path.join(current, segment)
    if (create) {
      try {
        await fs.mkdir(current)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      }
    }
    identity = await directDirectory(current, root, `Workflow run directory '${segment}'`)
  }
  return identity
}

async function directDirectory(filePath: string, root: string, label: string): Promise<DirectDirectory> {
  const before = await fs.lstat(filePath, { bigint: true })
  if (before.isSymbolicLink() || !before.isDirectory()) {
    throw new Error(`${label} must be a direct directory and not a symlink or junction.`)
  }
  const physical = await fs.realpath(filePath)
  assertPhysicalContainment(root, physical, label)
  if (!sameCanonicalPath(filePath, physical)) throw new Error(`${label} must not use an alias or junction.`)
  const after = await fs.lstat(filePath, { bigint: true })
  if (!after.isDirectory() || !sameIdentity(before, after)) throw new Error(`${label} changed while its path was being verified.`)
  return { path: filePath, dev: after.dev, ino: after.ino }
}

async function directRegularFile(filePath: string, root: string, label: string): Promise<FileIdentity> {
  const before = await fs.lstat(filePath, { bigint: true })
  if (before.isSymbolicLink() || !before.isFile()) throw new Error(`${label} must be a direct regular file and not a symlink.`)
  const physical = await fs.realpath(filePath)
  assertPhysicalContainment(root, physical, label)
  if (!sameCanonicalPath(filePath, physical)) throw new Error(`${label} must not use a file alias.`)
  const after = await fs.lstat(filePath, { bigint: true })
  if (!after.isFile() || !sameIdentity(before, after)) throw new Error(`${label} changed while its path was being verified.`)
  return { dev: after.dev, ino: after.ino }
}

async function optionalDirectRegularFile(filePath: string, root: string, label: string): Promise<FileIdentity | undefined> {
  try {
    return await directRegularFile(filePath, root, label)
  } catch (error) {
    if (isMissingPathError(error)) return undefined
    throw error
  }
}

async function assertDirectoryIdentity(directory: DirectDirectory, label: string): Promise<void> {
  const current = await fs.lstat(directory.path, { bigint: true })
  if (current.isSymbolicLink() || !current.isDirectory() || !sameIdentity(directory, current)) {
    throw new Error(`${label} changed identity during workflow durability I/O.`)
  }
  const physical = await fs.realpath(directory.path)
  if (!sameCanonicalPath(directory.path, physical)) {
    throw new Error(`${label} changed to an alias or junction during workflow durability I/O.`)
  }
}

async function assertTargetUnchanged(
  root: string,
  directory: DirectDirectory,
  filePath: string,
  original: FileIdentity | undefined,
  runId: string,
  fileName: string
): Promise<void> {
  await assertDirectoryIdentity(directory, `Workflow run '${runId}' directory`)
  const current = await optionalDirectRegularFile(filePath, root, durabilityLabel(runId, fileName))
  if (Boolean(original) !== Boolean(current)) throw new Error(`${durabilityLabel(runId, fileName)} target changed before rename.`)
  if (original && current && !sameIdentity(original, current)) throw new Error(`${durabilityLabel(runId, fileName)} target changed before rename.`)
}

async function syncDirectFile(filePath: string, root: string, label: string): Promise<void> {
  await directRegularFile(filePath, root, label)
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0
  const handle = await fs.open(filePath, constants.O_RDWR | noFollow)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function syncDirectory(directoryPath: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined
  try {
    handle = await fs.open(directoryPath, constants.O_RDONLY)
    await handle.sync()
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (!code || !["EINVAL", "EPERM", "EISDIR", "ENOTSUP"].includes(code)) throw error
  } finally {
    await handle?.close()
  }
}

async function renameWithRetry(source: string, target: string, beforeRename: () => Promise<void>): Promise<void> {
  const delays = [10, 50, 100]
  for (let attempt = 0; ; attempt += 1) {
    await beforeRename()
    try {
      await fs.rename(source, target)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (!code || !["EPERM", "EACCES", "EBUSY"].includes(code) || attempt >= delays.length) throw error
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]))
    }
  }
}

async function directoryStillMatches(directory: DirectDirectory): Promise<boolean> {
  try {
    await assertDirectoryIdentity(directory, "Workflow run directory")
    return true
  } catch {
    return false
  }
}

function durabilityLabel(runId: string, fileName: string): string {
  return `Workflow run '${runId}' durability file '${fileName}'`
}

function assertPhysicalContainment(root: string, target: string, label: string): void {
  const relative = path.relative(root, target)
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${label} resolves outside the workflow workspace.`)
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function sameCanonicalPath(left: string, right: string): boolean {
  const a = path.resolve(left)
  const b = path.resolve(right)
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b
}

function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === "ENOENT" || code === "ENOTDIR"
}
