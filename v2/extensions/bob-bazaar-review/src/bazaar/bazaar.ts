import { execFile } from "node:child_process"
import { decodeTextBuffer } from "./textEncoding"
import { clampExecBufferBytes } from "./reviewLimits"

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
  textEncoding?: string
}

interface RunOptions {
  allowedExitCodes?: Array<number | string>
}

const REQUIRED_BZR_GLOBAL_OPTION = "--no-aliases"
const MAX_REVISION_SPEC_LENGTH = 128

export class BazaarError extends Error {
  constructor(message: string, readonly details?: unknown) {
    super(message)
    this.name = "BazaarError"
  }
}

export class BazaarClient {
  private readonly bzrPath: string
  private readonly maxBuffer: number
  private readonly textEncoding: string

  constructor(options: BazaarOptions) {
    this.bzrPath = options.bzrPath || "bzr"
    this.maxBuffer = clampExecBufferBytes(options.maxBuffer)
    this.textEncoding = options.textEncoding ?? "auto"
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
    return this.run(cwd, ["diff", "-c", validateRevision(revision)], { allowedExitCodes: [0, 1] })
  }

  async diffRange(cwd: string, baseRevision: string, targetRevision: string): Promise<BazaarCommandResult> {
    const range = `${validateRevision(baseRevision)}..${validateRevision(targetRevision)}`
    return this.run(cwd, ["diff", "-r", range], { allowedExitCodes: [0, 1] })
  }

  async diffWorkingTree(cwd: string, baseRevision?: string): Promise<BazaarCommandResult> {
    const args = baseRevision ? ["diff", "-r", validateRevision(baseRevision)] : ["diff"]
    return this.run(cwd, args, { allowedExitCodes: [0, 1] })
  }

  async cat(cwd: string, revision: string, relativePath: string): Promise<BazaarCommandResult> {
    return this.run(cwd, ["cat", "-r", validateRevision(revision), "--", validateRelativePath(relativePath)])
  }

  async status(cwd: string): Promise<BazaarCommandResult> {
    return this.run(cwd, ["status"])
  }

  async run(cwd: string, args: string[], options: RunOptions = {}): Promise<BazaarCommandResult> {
    if (!cwd || cwd.includes("\0")) {
      throw new BazaarError("Bazaar の作業ディレクトリが不正です。")
    }

    const commandArgs = withRequiredGlobalOption(args)
    const allowedExitCodes = options.allowedExitCodes ?? [0]

    try {
      const result = await this.exec(cwd, commandArgs)
      return {
        stdout: decodeTextBuffer(result.stdout, this.textEncoding),
        stderr: decodeTextBuffer(result.stderr, this.textEncoding),
        command: this.bzrPath,
        args: commandArgs,
        cwd
      }
    } catch (error: any) {
      const stdout = decodeTextBuffer(toBuffer(error?.stdout), this.textEncoding)
      const stderr = decodeTextBuffer(toBuffer(error?.stderr), this.textEncoding)
      const code = error?.code

      if (allowedExitCodes.includes(code)) {
        return {
          stdout,
          stderr,
          command: this.bzrPath,
          args: commandArgs,
          cwd
        }
      }

      const message = stderr.trim() || stdout.trim() || String(error?.message ?? error)
      throw new BazaarError(`bzr ${commandArgs.join(" ")} が失敗しました: ${message}`, {
        cwd,
        args: commandArgs,
        stdout,
        stderr,
        code
      })
    }
  }

  private exec(cwd: string, args: string[]): Promise<{ stdout: Buffer; stderr: Buffer }> {
    return new Promise((resolve, reject) => {
      execFile(this.bzrPath, args, {
        cwd,
        shell: false,
        windowsHide: true,
        maxBuffer: this.maxBuffer,
        encoding: "buffer",
        env: {
          ...process.env,
          BZR_PROGRESS_BAR: "none"
        }
      } as any, (error, stdout, stderr) => {
        if (error) {
          ;(error as any).stdout = toBuffer(stdout)
          ;(error as any).stderr = toBuffer(stderr)
          reject(error)
          return
        }
        resolve({ stdout: toBuffer(stdout), stderr: toBuffer(stderr) })
      })
    })
  }
}

function withRequiredGlobalOption(args: string[]): string[] {
  return args.includes(REQUIRED_BZR_GLOBAL_OPTION) ? [...args] : [REQUIRED_BZR_GLOBAL_OPTION, ...args]
}

function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value
  if (typeof value === "string") return Buffer.from(value, "utf8")
  return Buffer.alloc(0)
}

export function validateRevision(revision: string): string {
  const trimmed = revision.trim()
  if (!trimmed) {
    throw new BazaarError("リビジョンを入力してください。")
  }
  if (trimmed.length > MAX_REVISION_SPEC_LENGTH) {
    throw new BazaarError(`Bazaar リビジョン指定が長すぎます: ${revision}`)
  }
  if (trimmed.startsWith("-") || trimmed.includes("..")) {
    throw new BazaarError(`安全でない Bazaar リビジョン指定です: ${revision}`)
  }

  // Supports revno such as 1234, dotted revno such as 1.2.3,
  // date:, tag:, revid:, submit:, before:, ancestor: style revision specs.
  if (!/^[A-Za-z0-9_.:+@/=-]+$/.test(trimmed)) {
    throw new BazaarError(`安全でない Bazaar リビジョン指定です: ${revision}`)
  }

  return trimmed
}

export function validateRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/").trim()
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) {
    throw new BazaarError(`安全でない Bazaar パスです: ${relativePath}`)
  }
  if (normalized.split("/").includes("..")) {
    throw new BazaarError(`親ディレクトリ参照は許可しません: ${relativePath}`)
  }
  return normalized
}
