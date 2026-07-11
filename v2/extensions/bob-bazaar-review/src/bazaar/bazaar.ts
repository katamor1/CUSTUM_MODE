import * as path from "node:path"
import { decodeTextBuffer } from "./textEncoding"
import { clampExecBufferBytes } from "./reviewLimits"
import {
  ExternalProcessError,
  runExternalProcess,
  type ExternalProcessResult,
  type ExternalProcessOptions
} from "./externalProcessRunner"

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
  timeoutMs?: number
  signal?: AbortSignal
  processRunner?: (options: ExternalProcessOptions) => Promise<ExternalProcessResult>
}

interface RunOptions {
  allowedExitCodes?: Array<number | string>
}

const REQUIRED_BZR_GLOBAL_OPTION = "--no-aliases"
const MAX_REVISION_SPEC_LENGTH = 128
const DEFAULT_BAZAAR_TIMEOUT_MS = 120_000
const MIN_BAZAAR_TIMEOUT_MS = 1_000
const MAX_BAZAAR_TIMEOUT_MS = 600_000

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
  private readonly timeoutMs: number
  private readonly signal?: AbortSignal
  private readonly processRunner: (options: ExternalProcessOptions) => Promise<ExternalProcessResult>

  constructor(options: BazaarOptions) {
    this.bzrPath = options.bzrPath || "bzr"
    this.maxBuffer = clampExecBufferBytes(options.maxBuffer)
    this.textEncoding = options.textEncoding ?? "auto"
    this.timeoutMs = positiveTimeout(options.timeoutMs)
    this.signal = options.signal
    this.processRunner = options.processRunner ?? runExternalProcess
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

    // Bazaar はユーザー環境の alias で出力や副作用が変わり得るため、全呼び出しで bzr --no-aliases を強制する。
    const commandArgs = withRequiredGlobalOption(args)
    const allowedExitCodes = (options.allowedExitCodes ?? [0]).map((code) => Number(code))

    try {
      const result = await this.exec(cwd, commandArgs, allowedExitCodes)
      return {
        stdout: decodeTextBuffer(result.stdout, this.textEncoding),
        stderr: decodeTextBuffer(result.stderr, this.textEncoding),
        command: this.bzrPath,
        args: commandArgs,
        cwd
      }
    } catch (error) {
      const stdout = error instanceof ExternalProcessError
        ? decodeTextBuffer(error.stdout, this.textEncoding)
        : ""
      const stderr = error instanceof ExternalProcessError
        ? decodeTextBuffer(error.stderr, this.textEncoding)
        : ""
      const code = error instanceof ExternalProcessError ? error.exitCode : undefined
      const kind = error instanceof ExternalProcessError ? error.kind : "spawnFailure"
      const message = stderr.trim() || stdout.trim() || (error instanceof Error ? error.message : String(error))
      throw new BazaarError(`bzr ${commandArgs.join(" ")} が失敗しました: ${message}`, {
        cwd,
        args: commandArgs,
        stdout,
        stderr,
        code,
        kind
      })
    }
  }

  private exec(cwd: string, args: string[], allowedExitCodes: number[] = [0]): Promise<ExternalProcessResult> {
    return this.processRunner({
      command: this.bzrPath,
      args,
      cwd,
      maxBufferBytes: this.maxBuffer,
      timeoutMs: this.timeoutMs,
      allowedExitCodes,
      signal: this.signal,
      env: {
        ...process.env,
        BZR_PROGRESS_BAR: "none"
      }
    })
  }
}

function withRequiredGlobalOption(args: string[]): string[] {
  return args.includes(REQUIRED_BZR_GLOBAL_OPTION) ? [...args] : [REQUIRED_BZR_GLOBAL_OPTION, ...args]
}

function positiveTimeout(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return DEFAULT_BAZAAR_TIMEOUT_MS
  return Math.max(MIN_BAZAAR_TIMEOUT_MS, Math.min(MAX_BAZAAR_TIMEOUT_MS, Math.floor(value)))
}

export function validateRevision(revision: string): string {
  const trimmed = revision.trim()
  if (/[\0-\x1F\x7F]/u.test(revision)) {
    throw new BazaarError(`安全でない Bazaar リビジョン指定です: ${revision}`)
  }
  if (!trimmed) {
    throw new BazaarError("リビジョンを入力してください。")
  }
  if (trimmed.length > MAX_REVISION_SPEC_LENGTH) {
    throw new BazaarError(`Bazaar リビジョン指定が長すぎます: ${revision}`)
  }
  if (trimmed.startsWith("-") || trimmed.includes("..")) {
    throw new BazaarError(`安全でない Bazaar リビジョン指定です: ${revision}`)
  }

  // Bazaar の revision spec は名前付き指定を許すが、argv 上の別引数や範囲指定へ広がる形はここで止める。
  if (!/^[A-Za-z0-9_.:+@/=-]+$/.test(trimmed)) {
    throw new BazaarError(`安全でない Bazaar リビジョン指定です: ${revision}`)
  }

  return trimmed
}

export function validateRelativePath(relativePath: string): string {
  const trimmed = relativePath.trim()
  const normalized = trimmed.replace(/\\/g, "/")
  if (
    !trimmed ||
    trimmed !== relativePath ||
    /[\0-\x1F\x7F]/u.test(relativePath) ||
    path.win32.isAbsolute(trimmed) ||
    path.posix.isAbsolute(normalized) ||
    /^[A-Za-z]:/.test(trimmed)
  ) {
    throw new BazaarError(`安全でない Bazaar パスです: ${relativePath}`)
  }

  const segments = normalized.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new BazaarError(`安全でない Bazaar パスです: ${relativePath}`)
  }
  return normalized
}
