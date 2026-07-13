import { randomUUID } from "crypto"
import * as fs from "fs/promises"
import * as path from "path"

export interface WorkspaceFileTransactionWrite {
  relativePath: string
  text: string | Buffer
  encoding?: BufferEncoding
}

interface VerifiedPhysicalDirectory {
  path: string
  dev: bigint
  ino: bigint
}

interface StagedWorkspaceWrite {
  relativePath: string
  parent: VerifiedPhysicalDirectory
  target: string
  temporary: string
  backup: string
  backupCreated: boolean
  committed: boolean
}

const workspaceTransactionTails = new Map<string, Promise<void>>()

export async function writeWorkspaceFilesAtomically(
  workspaceRoot: string,
  writes: WorkspaceFileTransactionWrite[],
  commitState: () => Promise<void> | void = () => undefined
): Promise<void> {
  if (writes.length === 0) return
  const root = path.resolve(workspaceRoot)
  const physicalRoot = await fs.realpath(root)
  await withPhysicalRootTransactionLock(physicalRoot, () => writeWorkspaceFilesTransaction(
    root,
    physicalRoot,
    writes,
    commitState
  ))
}

async function writeWorkspaceFilesTransaction(
  root: string,
  physicalRoot: string,
  writes: WorkspaceFileTransactionWrite[],
  commitState: () => Promise<void> | void
): Promise<void> {
  const transactionId = randomUUID().replace(/-/g, "")
  const stagingDirectory = await verifiedPhysicalDirectory(
    root,
    physicalRoot,
    path.join(root, ".bob", ".workflow-file-transactions")
  )
  const targets = new Set<string>()
  const staged: StagedWorkspaceWrite[] = []

  try {
    for (const [index, write] of writes.entries()) {
      const lexicalTarget = containedTarget(root, write.relativePath)
      const parent = await verifiedPhysicalDirectory(root, physicalRoot, path.dirname(lexicalTarget))
      const target = path.join(parent.path, path.basename(lexicalTarget))
      assertPhysicalContainment(physicalRoot, target, write.relativePath)
      await rejectSymbolicFileTarget(target, write.relativePath)
      const targetKey = normalizedPhysicalPath(target)
      if (targets.has(targetKey)) throw new Error(`Workspace file transaction has duplicate physical target: ${write.relativePath}`)
      targets.add(targetKey)
      const marker = `.workflow-txn-${transactionId}-${index}`
      const temporary = path.join(stagingDirectory.path, `${marker}.tmp`)
      const backup = path.join(stagingDirectory.path, `${marker}.bak`)
      const stagedWrite = {
        relativePath: write.relativePath,
        parent,
        target,
        temporary,
        backup,
        backupCreated: false,
        committed: false
      }
      staged.push(stagedWrite)
      await assertStableWriteDirectories(physicalRoot, stagingDirectory, stagedWrite)
      if (typeof write.text === "string") {
        await fs.writeFile(temporary, write.text, { encoding: write.encoding ?? "utf8", flag: "wx" })
      } else {
        await fs.writeFile(temporary, write.text, { flag: "wx" })
      }
      await assertStableWriteDirectories(physicalRoot, stagingDirectory, stagedWrite)
      await requireRegularFile(temporary, `transaction staging file for ${write.relativePath}`)
    }

    for (const write of staged) {
      await assertStableWriteDirectories(physicalRoot, stagingDirectory, write)
      await rejectSymbolicFileTarget(write.target, write.relativePath)
      try {
        await fs.rename(write.target, write.backup)
        write.backupCreated = true
      } catch (error) {
        if (!isMissingPathError(error)) throw error
      }
      await assertStableWriteDirectories(physicalRoot, stagingDirectory, write)
      if (write.backupCreated) {
        await requireRegularFile(write.backup, `transaction backup for ${write.relativePath}`)
      }
      await assertMissingPath(write.target, write.relativePath)
      await requireRegularFile(write.temporary, `transaction staging file for ${write.relativePath}`)
      await fs.rename(write.temporary, write.target)
      write.committed = true
      await assertStableWriteDirectories(physicalRoot, stagingDirectory, write)
      await rejectSymbolicFileTarget(write.target, write.relativePath)
    }
    for (const write of staged) {
      await assertStableWriteDirectories(physicalRoot, stagingDirectory, write)
      await rejectSymbolicFileTarget(write.target, write.relativePath)
    }
    await Promise.resolve(commitState())
  } catch (error) {
    const rollbackErrors = await rollbackWorkspaceWrites(physicalRoot, stagingDirectory, staged)
    if (rollbackErrors.length > 0) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`${message}; rollback failed: ${rollbackErrors.join("; ")}`, { cause: error })
    }
    throw error
  }

  await cleanupWorkspaceWrites(physicalRoot, stagingDirectory, staged)
}

async function rollbackWorkspaceWrites(
  physicalRoot: string,
  stagingDirectory: VerifiedPhysicalDirectory,
  staged: StagedWorkspaceWrite[]
): Promise<string[]> {
  const errors: string[] = []
  for (const write of [...staged].reverse()) {
    if (write.committed || write.backupCreated) {
      try {
        await assertStableWriteDirectories(physicalRoot, stagingDirectory, write)
        if (write.committed) {
          await rejectSymbolicFileTarget(write.target, write.relativePath)
          await fs.rm(write.target, { force: true })
          write.committed = false
          await assertStableWriteDirectories(physicalRoot, stagingDirectory, write)
        }
        if (write.backupCreated) {
          await requireRegularFile(write.backup, `transaction backup for ${write.relativePath}`)
          await assertMissingPath(write.target, write.relativePath)
          await fs.rename(write.backup, write.target)
          write.backupCreated = false
          await assertStableWriteDirectories(physicalRoot, stagingDirectory, write)
          await rejectSymbolicFileTarget(write.target, write.relativePath)
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }
    for (const stagingPath of [write.temporary, write.backup]) {
      try {
        await removeStagingPath(physicalRoot, stagingDirectory, stagingPath)
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }
  }
  return errors
}

async function cleanupWorkspaceWrites(
  physicalRoot: string,
  stagingDirectory: VerifiedPhysicalDirectory,
  staged: StagedWorkspaceWrite[]
): Promise<void> {
  await Promise.all(staged.flatMap((write) => [write.temporary, write.backup].map(async (stagingPath) => {
    await removeStagingPath(physicalRoot, stagingDirectory, stagingPath).catch(() => undefined)
  })))
}

async function removeStagingPath(
  physicalRoot: string,
  stagingDirectory: VerifiedPhysicalDirectory,
  stagingPath: string
): Promise<void> {
  await assertVerifiedDirectory(physicalRoot, stagingDirectory, "transaction staging directory")
  assertPhysicalContainment(stagingDirectory.path, stagingPath, stagingPath)
  await fs.rm(stagingPath, { force: true })
}

async function assertStableWriteDirectories(
  physicalRoot: string,
  stagingDirectory: VerifiedPhysicalDirectory,
  write: StagedWorkspaceWrite
): Promise<void> {
  // Node has no openat-style path operations. Rechecking both directory identities
  // around every write/rename narrows, but cannot eliminate, a hostile same-user swap window.
  await assertVerifiedDirectory(physicalRoot, stagingDirectory, "transaction staging directory")
  await assertVerifiedDirectory(physicalRoot, write.parent, `parent for ${write.relativePath}`)
}

async function withPhysicalRootTransactionLock<T>(
  physicalRoot: string,
  operation: () => Promise<T>
): Promise<T> {
  const key = normalizedPhysicalPath(physicalRoot)
  const predecessor = workspaceTransactionTails.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  const tail = predecessor.then(() => current, () => current)
  workspaceTransactionTails.set(key, tail)
  await predecessor.catch(() => undefined)
  try {
    return await operation()
  } finally {
    release()
    if (workspaceTransactionTails.get(key) === tail) workspaceTransactionTails.delete(key)
  }
}

function containedTarget(root: string, relativePath: string): string {
  if (!relativePath.trim()) throw new Error("Workspace file transaction path is required.")
  const target = path.resolve(root, relativePath)
  const relative = path.relative(root, target)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Workspace file transaction path escapes workspace root: ${relativePath}`)
  }
  return target
}

async function verifiedPhysicalDirectory(
  root: string,
  physicalRoot: string,
  directory: string
): Promise<VerifiedPhysicalDirectory> {
  const relative = path.relative(root, directory)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Workspace file transaction directory escapes workspace root: ${directory}`)
  }
  let physical = physicalRoot
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    const current = await fs.realpath(physical)
    assertPhysicalContainment(physicalRoot, current, directory)
    if (normalizedPhysicalPath(current) !== normalizedPhysicalPath(physical)) {
      throw new Error(`Workspace file transaction directory changed during verification: ${directory}`)
    }
    const next = path.join(physical, segment)
    try {
      await fs.lstat(next)
    } catch (error) {
      if (!isMissingPathError(error)) throw error
      try {
        await fs.mkdir(next)
      } catch (mkdirError) {
        if (!isAlreadyExistsError(mkdirError)) throw mkdirError
      }
    }
    physical = await fs.realpath(next)
    assertPhysicalContainment(physicalRoot, physical, directory)
    const stat = await fs.stat(physical, { bigint: true })
    if (!stat.isDirectory()) throw new Error(`Workspace file transaction parent is not a directory: ${directory}`)
  }
  const stat = await fs.stat(physical, { bigint: true })
  if (!stat.isDirectory()) throw new Error(`Workspace file transaction parent is not a directory: ${directory}`)
  return { path: physical, dev: stat.dev, ino: stat.ino }
}

async function assertVerifiedDirectory(
  physicalRoot: string,
  directory: VerifiedPhysicalDirectory,
  label: string
): Promise<void> {
  let resolved: string
  try {
    resolved = await fs.realpath(directory.path)
  } catch (error) {
    throw new Error(`Workspace file transaction directory changed: ${label}`, { cause: error })
  }
  assertPhysicalContainment(physicalRoot, resolved, label)
  if (normalizedPhysicalPath(resolved) !== normalizedPhysicalPath(directory.path)) {
    throw new Error(`Workspace file transaction directory changed: ${label}`)
  }
  const stat = await fs.stat(resolved, { bigint: true })
  if (!stat.isDirectory() || stat.dev !== directory.dev || stat.ino !== directory.ino) {
    throw new Error(`Workspace file transaction directory changed: ${label}`)
  }
}

async function rejectSymbolicFileTarget(target: string, relativePath: string): Promise<void> {
  try {
    const stat = await fs.lstat(target)
    if (stat.isSymbolicLink()) {
      throw new Error(`Workspace file transaction target is a symbolic link: ${relativePath}`)
    }
    if (!stat.isFile()) throw new Error(`Workspace file transaction target is not a file: ${relativePath}`)
  } catch (error) {
    if (isMissingPathError(error)) return
    throw error
  }
}

async function requireRegularFile(target: string, label: string): Promise<void> {
  const stat = await fs.lstat(target)
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Workspace file transaction file changed: ${label}`)
  }
}

async function assertMissingPath(target: string, label: string): Promise<void> {
  try {
    await fs.lstat(target)
  } catch (error) {
    if (isMissingPathError(error)) return
    throw error
  }
  throw new Error(`Workspace file transaction target changed while committing: ${label}`)
}

function assertPhysicalContainment(physicalRoot: string, target: string, label: string): void {
  const relative = path.relative(physicalRoot, target)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Workspace file transaction path escapes the physical workspace root: ${label}`)
  }
}

function normalizedPhysicalPath(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

function isMissingPathError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT"
}

function isAlreadyExistsError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "EEXIST"
}
