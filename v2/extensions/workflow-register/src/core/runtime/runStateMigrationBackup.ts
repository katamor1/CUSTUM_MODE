import { randomUUID } from "crypto"
import { constants } from "fs"
import * as fs from "fs/promises"
import * as path from "path"
import { assertSafeWorkflowRunId } from "./runStatePath"
import type { ContainedRunFileSnapshot } from "./runStatePath"

export const RUN_STATE_V0_BACKUP_FILE_NAME = "run-state-v0.backup.json" as const

const RUNS_ROOT_SEGMENTS = [".bob", "workflows", "runs"] as const

type FileIdentity = {
  dev: bigint
  ino: bigint
}

type DirectDirectory = FileIdentity & {
  path: string
}

export async function readContainedRunStateMigrationBackup(
  workspaceRoot: string,
  runId: string
): Promise<ContainedRunFileSnapshot> {
  assertSafeWorkflowRunId(runId)
  const root = await canonicalWorkspaceRoot(workspaceRoot)
  const runDirectory = await directDirectoryChain(root, [...RUNS_ROOT_SEGMENTS, runId])
  const filePath = path.join(runDirectory.path, RUN_STATE_V0_BACKUP_FILE_NAME)
  const bytes = await readDirectRegularFile(
    root,
    filePath,
    `Workflow run '${runId}' migration backup`
  )
  return { bytes, filePath }
}

export async function ensureContainedRunStateMigrationBackup(
  workspaceRoot: string,
  runId: string,
  content: string
): Promise<void> {
  assertSafeWorkflowRunId(runId)
  const existing = await optionalReadContainedRunStateMigrationBackup(workspaceRoot, runId)
  if (existing) {
    assertMatchingBackup(runId, existing.bytes, content)
    return
  }

  const root = await canonicalWorkspaceRoot(workspaceRoot)
  const runsRoot = await directDirectoryChain(root, [...RUNS_ROOT_SEGMENTS])
  const runDirectory = await directDirectoryChain(root, [...RUNS_ROOT_SEGMENTS, runId])
  const backupPath = path.join(runDirectory.path, RUN_STATE_V0_BACKUP_FILE_NAME)
  const tempPath = path.join(runsRoot.path, `.${runId}.${process.pid}.${randomUUID()}.tmp`)
  let tempIdentity: FileIdentity | undefined

  try {
    await assertDirectoryIdentity(runsRoot, "Workflow runs directory")
    await assertDirectoryIdentity(runDirectory, `Workflow run '${runId}' directory`)
    await fs.writeFile(tempPath, content, { encoding: "utf8", flag: "wx" })
    tempIdentity = await directRegularFile(
      tempPath,
      root,
      `Workflow run '${runId}' migration backup temporary file`
    )

    const raced = await optionalDirectRegularFile(
      backupPath,
      root,
      `Workflow run '${runId}' migration backup`
    )
    if (raced) {
      const snapshot = await readContainedRunStateMigrationBackup(workspaceRoot, runId)
      assertMatchingBackup(runId, snapshot.bytes, content)
      return
    }

    await assertDirectoryIdentity(runsRoot, "Workflow runs directory")
    await assertDirectoryIdentity(runDirectory, `Workflow run '${runId}' directory`)
    try {
      await fs.link(tempPath, backupPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      const snapshot = await readContainedRunStateMigrationBackup(workspaceRoot, runId)
      assertMatchingBackup(runId, snapshot.bytes, content)
      return
    }

    const targetIdentity = await directRegularFile(
      backupPath,
      root,
      `Workflow run '${runId}' migration backup`
    )
    if (!sameIdentity(tempIdentity, targetIdentity)) {
      throw new Error(`Workflow run '${runId}' migration backup changed during create-once publication.`)
    }
    await assertDirectoryIdentity(runsRoot, "Workflow runs directory")
    await assertDirectoryIdentity(runDirectory, `Workflow run '${runId}' directory`)
  } finally {
    if (await directoryStillMatches(runsRoot)) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined)
    }
  }
}

async function optionalReadContainedRunStateMigrationBackup(
  workspaceRoot: string,
  runId: string
): Promise<ContainedRunFileSnapshot | undefined> {
  try {
    return await readContainedRunStateMigrationBackup(workspaceRoot, runId)
  } catch (error) {
    if (isMissingPathError(error)) return undefined
    throw error
  }
}

function assertMatchingBackup(runId: string, bytes: Buffer, content: string): void {
  if (bytes.toString("utf8") !== content) {
    throw new Error(`Workflow run '${runId}' migration backup conflicts with the current unversioned run.`)
  }
}

async function readDirectRegularFile(root: string, filePath: string, label: string): Promise<Buffer> {
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0
  const before = await directRegularFile(filePath, root, label)
  const handle = await fs.open(filePath, constants.O_RDONLY | noFollow)
  try {
    const handleStat = await handle.stat({ bigint: true })
    const after = await directRegularFile(filePath, root, label)
    if (!handleStat.isFile() || !sameIdentity(before, handleStat) || !sameIdentity(handleStat, after)) {
      throw new Error(`${label} changed while it was being read.`)
    }
    return await handle.readFile()
  } finally {
    await handle.close()
  }
}

async function directDirectoryChain(root: string, segments: readonly string[]): Promise<DirectDirectory> {
  let current = root
  let identity = await directDirectory(current, root, "Workflow workspace root")
  for (const segment of segments) {
    current = path.join(current, segment)
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
    throw new Error(`${label} changed while its path was being verified.`)
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
    throw new Error(`${label} changed identity during workflow run migration I/O.`)
  }
  const physicalPath = await fs.realpath(directory.path)
  if (!sameCanonicalPath(directory.path, physicalPath)) {
    throw new Error(`${label} changed to an alias or junction during workflow run migration I/O.`)
  }
}

async function directoryStillMatches(directory: DirectDirectory): Promise<boolean> {
  try {
    await assertDirectoryIdentity(directory, "Workflow runs directory")
    return true
  } catch {
    return false
  }
}

async function canonicalWorkspaceRoot(workspaceRoot: string): Promise<string> {
  if (!workspaceRoot.trim()) throw new Error("Workflow workspace root is empty.")
  return fs.realpath(path.resolve(workspaceRoot))
}

function assertPhysicalContainment(root: string, target: string, label: string): void {
  const relative = path.relative(root, target)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} resolves outside the workflow workspace.`)
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

function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === "ENOENT" || code === "ENOTDIR"
}
