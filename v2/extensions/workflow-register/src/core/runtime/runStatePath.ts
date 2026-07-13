import { randomUUID } from "crypto"
import { constants } from "fs"
import * as fs from "fs/promises"
import * as path from "path"

export interface ContainedRunFileSnapshot {
  bytes: Buffer
  filePath: string
}

export type ContainedRunFileName = "run.json" | "control.json"

type FileIdentity = {
  dev: bigint
  ino: bigint
}

type DirectDirectory = FileIdentity & {
  path: string
}

class RunPathChangedError extends Error {}

const WINDOWS_RESERVED_RUN_IDS = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
])
const RUNS_ROOT_SEGMENTS = [".bob", "workflows", "runs"] as const

export function assertSafeWorkflowRunId(runId: string): void {
  const reservedBase = runId.split(".")[0]?.toUpperCase()
  if (
    !runId
    || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)
    || /[. ]$/.test(runId)
    || (reservedBase && WINDOWS_RESERVED_RUN_IDS.has(reservedBase))
  ) {
    throw new Error(`Workflow run id contains unsupported or reserved path characters: ${runId || "(empty)"}`)
  }
}

export async function readContainedRunFile(
  workspaceRoot: string,
  runId: string,
  fileName: ContainedRunFileName = "run.json"
): Promise<ContainedRunFileSnapshot> {
  assertContainedRunFileName(fileName)
  return readContainedRunPath(workspaceRoot, runId, [], fileName, `Workflow run '${runId}' ${fileName}`)
}

export async function readContainedTaskSnapshotFile(
  workspaceRoot: string,
  runId: string,
  fileName: string
): Promise<ContainedRunFileSnapshot> {
  assertSafeTaskSnapshotFileName(fileName)
  return readContainedRunPath(
    workspaceRoot,
    runId,
    ["task-snapshots"],
    fileName,
    `Workflow run '${runId}' task snapshot '${fileName}'`
  )
}

export async function readContainedRunArtifactManifest(
  workspaceRoot: string,
  runId: string
): Promise<ContainedRunFileSnapshot> {
  return readContainedRunPath(
    workspaceRoot,
    runId,
    ["artifacts"],
    "manifest.json",
    `Workflow run '${runId}' artifact manifest`
  )
}

async function readContainedRunPath(
  workspaceRoot: string,
  runId: string,
  relativeDirectorySegments: readonly string[],
  fileName: string,
  label: string
): Promise<ContainedRunFileSnapshot> {
  assertSafeWorkflowRunId(runId)
  const root = await canonicalWorkspaceRoot(workspaceRoot)
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined
    try {
      const runDirectory = await directDirectoryChain(root, [...RUNS_ROOT_SEGMENTS, runId, ...relativeDirectorySegments], false)
      const runFile = path.join(runDirectory.path, fileName)
      const preOpen = await directRegularFile(runFile, root, label)
      handle = await fs.open(runFile, constants.O_RDONLY | noFollow)
      const handleStat = await handle.stat({ bigint: true })
      const postOpen = await directRegularFile(runFile, root, label)
      if (!handleStat.isFile() || !sameIdentity(preOpen, handleStat) || !sameIdentity(handleStat, postOpen)) {
        throw new RunPathChangedError(`Workflow run '${runId}' changed while its path was being verified.`)
      }
      return { bytes: await handle.readFile(), filePath: runFile }
    } catch (error) {
      if (attempt < 4 && (error instanceof RunPathChangedError || isMissingPathError(error))) {
        await new Promise((resolve) => setTimeout(resolve, 5))
        continue
      }
      if (error instanceof RunPathChangedError) {
        throw new Error(`Workflow run '${runId}' kept changing while its path was being verified.`)
      }
      throw error
    } finally {
      await handle?.close()
    }
  }
  throw new Error(`Workflow run '${runId}' could not be read from a stable path.`)
}

export async function listContainedRunIds(workspaceRoot: string): Promise<string[]> {
  const root = await canonicalWorkspaceRoot(workspaceRoot)
  let runsRoot: DirectDirectory
  try {
    runsRoot = await directDirectoryChain(root, [...RUNS_ROOT_SEGMENTS], false)
  } catch (error) {
    if (isMissingPathError(error)) return []
    throw error
  }
  const directory = await fs.opendir(runsRoot.path)
  try {
    await assertDirectoryIdentity(runsRoot, "Workflow runs directory")
    const entries: string[] = []
    while (true) {
      const entry = await directory.read()
      if (!entry) break
      if (entry.isFile() && isOwnedRunTempFile(entry.name)) continue
      assertSafeWorkflowRunId(entry.name)
      entries.push(entry.name)
    }
    await assertDirectoryIdentity(runsRoot, "Workflow runs directory")
    return entries
  } finally {
    await directory.close().catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ERR_DIR_CLOSED") throw error
    })
  }
}

export async function writeContainedRunFile(
  workspaceRoot: string,
  runId: string,
  content: string,
  fileName: ContainedRunFileName = "run.json"
): Promise<void> {
  assertContainedRunFileName(fileName)
  return writeContainedRunPath(workspaceRoot, runId, [], fileName, content)
}

export async function writeContainedTaskSnapshotFile(
  workspaceRoot: string,
  runId: string,
  fileName: string,
  content: string
): Promise<void> {
  assertSafeTaskSnapshotFileName(fileName)
  return writeContainedRunPath(workspaceRoot, runId, ["task-snapshots"], fileName, content)
}

export async function listContainedTaskSnapshotFiles(
  workspaceRoot: string,
  runId: string
): Promise<string[]> {
  assertSafeWorkflowRunId(runId)
  const root = await canonicalWorkspaceRoot(workspaceRoot)
  const directory = await directDirectoryChain(root, [...RUNS_ROOT_SEGMENTS, runId, "task-snapshots"], false)
  return listDirectDirectoryEntries(directory, `Workflow run '${runId}' task snapshot directory`)
}

export async function removeContainedTaskSnapshotFile(
  workspaceRoot: string,
  runId: string,
  fileName: string
): Promise<void> {
  assertSafeWorkflowRunId(runId)
  assertSafeTaskSnapshotFileName(fileName)
  const root = await canonicalWorkspaceRoot(workspaceRoot)
  const directory = await directDirectoryChain(root, [...RUNS_ROOT_SEGMENTS, runId, "task-snapshots"], false)
  const file = path.join(directory.path, fileName)
  const original = await optionalDirectRegularFile(file, root, `Workflow run '${runId}' task snapshot '${fileName}'`)
  if (!original) return
  await assertDirectoryIdentity(directory, `Workflow run '${runId}' task snapshot directory`)
  const current = await directRegularFile(file, root, `Workflow run '${runId}' task snapshot '${fileName}'`)
  if (!sameIdentity(original, current)) throw new Error(`Workflow run '${runId}' task snapshot changed before removal.`)
  await fs.rm(file)
  await assertDirectoryIdentity(directory, `Workflow run '${runId}' task snapshot directory`)
}

async function writeContainedRunPath(
  workspaceRoot: string,
  runId: string,
  relativeDirectorySegments: readonly string[],
  fileName: string,
  content: string
): Promise<void> {
  assertSafeWorkflowRunId(runId)
  const root = await canonicalWorkspaceRoot(workspaceRoot)
  const runsRoot = await directDirectoryChain(root, [...RUNS_ROOT_SEGMENTS], true)
  const runDirectory = await directDirectoryChain(root, [...RUNS_ROOT_SEGMENTS, runId, ...relativeDirectorySegments], true)
  const runFile = path.join(runDirectory.path, fileName)
  const originalTarget = await optionalDirectRegularFile(runFile, root, `Workflow run '${runId}' ${fileName}`)
  const tempFile = path.join(runsRoot.path, `.${runId}.${process.pid}.${randomUUID()}.tmp`)
  let tempIdentity: FileIdentity | undefined
  try {
    await assertDirectoryIdentity(runsRoot, "Workflow runs directory")
    await assertDirectoryIdentity(runDirectory, `Workflow run '${runId}' directory`)
    await fs.writeFile(tempFile, content, { encoding: "utf8", flag: "wx" })
    tempIdentity = await directRegularFile(tempFile, root, `Workflow run '${runId}' ${fileName} temporary file`)
    await assertWriteDestinationUnchanged(root, runsRoot, runDirectory, runFile, originalTarget, runId, fileName)
    await renameWithTransientRetry(tempFile, runFile, async () => {
      await assertWriteDestinationUnchanged(root, runsRoot, runDirectory, runFile, originalTarget, runId, fileName)
      const currentTemp = await directRegularFile(tempFile, root, `Workflow run '${runId}' ${fileName} temporary file`)
      if (!sameIdentity(tempIdentity!, currentTemp)) {
        throw new Error(`Workflow run '${runId}' temporary file changed before rename.`)
      }
    })
    await assertDirectoryIdentity(runsRoot, "Workflow runs directory")
    await assertDirectoryIdentity(runDirectory, `Workflow run '${runId}' directory`)
    const writtenTarget = await directRegularFile(runFile, root, `Workflow run '${runId}' ${fileName}`)
    if (!sameIdentity(tempIdentity, writtenTarget)) {
      throw new Error(`Workflow run '${runId}' changed during atomic replacement.`)
    }
  } catch (error) {
    if (await directoryStillMatches(runsRoot)) await fs.rm(tempFile, { force: true }).catch(() => undefined)
    throw error
  }
}

async function assertWriteDestinationUnchanged(
  root: string,
  runsRoot: DirectDirectory,
  runDirectory: DirectDirectory,
  runFile: string,
  originalTarget: FileIdentity | undefined,
  runId: string,
  fileName: string
): Promise<void> {
  await assertDirectoryIdentity(runsRoot, "Workflow runs directory")
  await assertDirectoryIdentity(runDirectory, `Workflow run '${runId}' directory`)
  const currentTarget = await optionalDirectRegularFile(runFile, root, `Workflow run '${runId}' ${fileName}`)
  if (Boolean(originalTarget) !== Boolean(currentTarget)) {
    throw new Error(`Workflow run '${runId}' target changed before rename.`)
  }
  if (originalTarget && currentTarget && !sameIdentity(originalTarget, currentTarget)) {
    throw new Error(`Workflow run '${runId}' target changed before rename.`)
  }
}

async function directDirectoryChain(
  root: string,
  segments: readonly string[],
  create: boolean
): Promise<DirectDirectory> {
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
  const physicalPath = await fs.realpath(filePath)
  assertPhysicalContainment(root, physicalPath, label)
  if (!sameCanonicalPath(filePath, physicalPath)) {
    throw new Error(`${label} must not use an alias or junction.`)
  }
  const after = await fs.lstat(filePath, { bigint: true })
  if (!after.isDirectory() || !sameIdentity(before, after)) {
    throw new Error(`${label} changed while its path was being verified.`)
  }
  return { path: filePath, dev: after.dev, ino: after.ino }
}

async function directRegularFile(filePath: string, root: string, label: string): Promise<FileIdentity> {
  const before = await fs.lstat(filePath, { bigint: true })
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error(`${label} must be a direct regular file and not a symlink.`)
  }
  const physicalPath = await fs.realpath(filePath)
  assertPhysicalContainment(root, physicalPath, label)
  if (!sameCanonicalPath(filePath, physicalPath)) {
    throw new Error(`${label} must not use a file alias.`)
  }
  const after = await fs.lstat(filePath, { bigint: true })
  if (!after.isFile() || !sameIdentity(before, after)) {
    throw new RunPathChangedError(`${label} changed while its path was being verified.`)
  }
  return { dev: after.dev, ino: after.ino }
}

async function optionalDirectRegularFile(
  filePath: string,
  root: string,
  label: string
): Promise<FileIdentity | undefined> {
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
    throw new Error(`${label} changed identity during workflow run I/O.`)
  }
  const physicalPath = await fs.realpath(directory.path)
  if (!sameCanonicalPath(directory.path, physicalPath)) {
    throw new Error(`${label} changed to an alias or junction during workflow run I/O.`)
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

async function listDirectDirectoryEntries(directory: DirectDirectory, label: string): Promise<string[]> {
  const handle = await fs.opendir(directory.path)
  try {
    await assertDirectoryIdentity(directory, label)
    const entries: string[] = []
    while (true) {
      const entry = await handle.read()
      if (!entry) break
      entries.push(entry.name)
    }
    await assertDirectoryIdentity(directory, label)
    return entries
  } finally {
    await handle.close().catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ERR_DIR_CLOSED") throw error
    })
  }
}

async function canonicalWorkspaceRoot(workspaceRoot: string): Promise<string> {
  if (!workspaceRoot.trim()) throw new Error("Workflow workspace root is empty.")
  return fs.realpath(path.resolve(workspaceRoot))
}

async function renameWithTransientRetry(
  source: string,
  target: string,
  beforeRename: () => Promise<void>
): Promise<void> {
  const delaysMs = [10, 50, 100]
  for (let attempt = 0; ; attempt += 1) {
    await beforeRename()
    try {
      await fs.rename(source, target)
      return
    } catch (error) {
      if (!isTransientRenameError(error) || attempt >= delaysMs.length) throw error
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]))
    }
  }
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function sameCanonicalPath(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left)
  const resolvedRight = path.resolve(right)
  return process.platform === "win32"
    ? resolvedLeft.toLocaleLowerCase() === resolvedRight.toLocaleLowerCase()
    : resolvedLeft === resolvedRight
}

function assertPhysicalContainment(root: string, target: string, label: string): void {
  const relative = path.relative(root, target)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} resolves outside the workflow workspace.`)
  }
}

function isTransientRenameError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === "EPERM" || code === "EACCES" || code === "EBUSY"
}

function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === "ENOENT" || code === "ENOTDIR"
}

function isOwnedRunTempFile(fileName: string): boolean {
  return /^\.[A-Za-z0-9][A-Za-z0-9._-]*\.\d+\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/i.test(fileName)
}

function assertContainedRunFileName(fileName: string): asserts fileName is ContainedRunFileName {
  if (fileName !== "run.json" && fileName !== "control.json") {
    throw new Error(`Workflow run file name is not supported: ${fileName}`)
  }
}

function assertSafeTaskSnapshotFileName(fileName: string): void {
  const reservedBase = fileName.split(".")[0]?.toUpperCase()
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(fileName)
    || /[. ]$/.test(fileName)
    || (reservedBase && WINDOWS_RESERVED_RUN_IDS.has(reservedBase))
  ) {
    throw new Error(`Workflow task snapshot file name is unsupported or reserved: ${fileName || "(empty)"}`)
  }
}
