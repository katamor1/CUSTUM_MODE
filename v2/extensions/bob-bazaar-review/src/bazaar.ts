import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export interface BazaarCommandResult {
  stdout: string
  stderr: string
  command: string
  args: string[]
  cwd: string
}

export interface BazaarOptions {
  bzrPath: string
  maxBuffer?: number
}

export class BazaarError extends Error {
  constructor(message: string, readonly details?: unknown) {
    super(message)
    this.name = "BazaarError"
  }
}

export class BazaarClient {
  private readonly bzrPath: string
  private readonly maxBuffer: number

  constructor(options: BazaarOptions) {
    this.bzrPath = options.bzrPath || "bzr"
    this.maxBuffer = options.maxBuffer ?? 10 * 1024 * 1024
  }

  async root(cwd: string): Promise<string> {
    const result = await this.run(cwd, ["root"])
    return result.stdout.trim()
  }

  async revno(cwd: string): Promise<string> {
    const result = await this.run(cwd, ["revno"])
    return result.stdout.trim()
  }

  async log(cwd: string, revision?: string): Promise<BazaarCommandResult> {
    const args = revision ? ["log", "-r", validateRevision(revision)] : ["log", "--limit", "20"]
    return this.run(cwd, args)
  }

  async diffRevision(cwd: string, revision: string): Promise<BazaarCommandResult> {
    return this.run(cwd, ["diff", "-c", validateRevision(revision)])
  }

  async diffRange(cwd: string, baseRevision: string, targetRevision: string): Promise<BazaarCommandResult> {
    const range = `${validateRevision(baseRevision)}..${validateRevision(targetRevision)}`
    return this.run(cwd, ["diff", "-r", range])
  }

  async diffWorkingTree(cwd: string, baseRevision?: string): Promise<BazaarCommandResult> {
    const args = baseRevision ? ["diff", "-r", validateRevision(baseRevision)] : ["diff"]
    return this.run(cwd, args)
  }

  async cat(cwd: string, revision: string, relativePath: string): Promise<BazaarCommandResult> {
    return this.run(cwd, ["cat", "-r", validateRevision(revision), validateRelativePath(relativePath)])
  }

  async status(cwd: string): Promise<BazaarCommandResult> {
    return this.run(cwd, ["status"])
  }

  async run(cwd: string, args: string[]): Promise<BazaarCommandResult> {
    if (!cwd || cwd.includes("\0")) {
      throw new BazaarError("Invalid Bazaar working directory")
    }

    try {
      const result = await execFileAsync(this.bzrPath, args, {
        cwd,
        shell: false,
        windowsHide: true,
        maxBuffer: this.maxBuffer,
        env: {
          ...process.env,
          BZR_PROGRESS_BAR: "none"
        }
      })

      return {
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        command: this.bzrPath,
        args,
        cwd
      }
    } catch (error: any) {
      const stdout = typeof error?.stdout === "string" ? error.stdout : ""
      const stderr = typeof error?.stderr === "string" ? error.stderr : ""
      const message = stderr.trim() || stdout.trim() || String(error?.message ?? error)
      throw new BazaarError(`bzr ${args.join(" ")} failed: ${message}`, {
        cwd,
        args,
        stdout,
        stderr,
        code: error?.code
      })
    }
  }
}

export function validateRevision(revision: string): string {
  const trimmed = revision.trim()
  if (!trimmed) {
    throw new BazaarError("Revision must not be empty")
  }

  // Supports revno such as 1234, dotted revno such as 1.2.3,
  // date:, tag:, revid:, submit:, before:, ancestor: style revision specs.
  if (!/^[A-Za-z0-9_.:+@/=-]+$/.test(trimmed)) {
    throw new BazaarError(`Unsafe Bazaar revision: ${revision}`)
  }

  return trimmed
}

export function validateRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/").trim()
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) {
    throw new BazaarError(`Unsafe Bazaar path: ${relativePath}`)
  }
  if (normalized.split("/").includes("..")) {
    throw new BazaarError(`Parent path segments are not allowed: ${relativePath}`)
  }
  return normalized
}
