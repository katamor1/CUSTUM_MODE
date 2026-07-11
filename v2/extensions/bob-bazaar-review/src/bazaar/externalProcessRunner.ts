import { spawn, type ChildProcessByStdio } from "node:child_process"
import type { Readable } from "node:stream"

type ExternalProcessChild = ChildProcessByStdio<null, Readable, Readable>

export type ExternalProcessErrorKind =
  | "timeout"
  | "cancelled"
  | "bufferExceeded"
  | "spawnFailure"
  | "nonZeroExit"

export interface ExternalProcessOptions {
  command: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  maxBufferBytes: number
  timeoutMs: number
  allowedExitCodes?: number[]
  signal?: AbortSignal
}

export interface ExternalProcessResult {
  stdout: Buffer
  stderr: Buffer
  exitCode: number
}

export class ExternalProcessError extends Error {
  constructor(
    message: string,
    readonly kind: ExternalProcessErrorKind,
    readonly command: string,
    readonly args: string[],
    readonly cwd: string,
    readonly stdout: Buffer = Buffer.alloc(0),
    readonly stderr: Buffer = Buffer.alloc(0),
    readonly exitCode?: number
  ) {
    super(message)
    this.name = "ExternalProcessError"
  }
}

const MIN_EXTERNAL_PROCESS_TIMEOUT_MS = 1_000
const MAX_EXTERNAL_PROCESS_TIMEOUT_MS = 600_000
const PROCESS_TERMINATION_WAIT_MS = 2_000

export function runExternalProcess(options: ExternalProcessOptions): Promise<ExternalProcessResult> {
  const maxBufferBytes = positiveInteger(options.maxBufferBytes, "maxBufferBytes")
  const timeoutMs = boundedTimeout(options.timeoutMs)
  const allowedExitCodes = new Set(options.allowedExitCodes ?? [0])

  if (options.signal?.aborted) {
    return Promise.reject(new ExternalProcessError(
      `Command cancelled before start: ${options.command}`,
      "cancelled",
      options.command,
      [...options.args],
      options.cwd
    ))
  }

  return new Promise((resolve, reject) => {
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let bufferedBytes = 0
    let settled = false
    let child: ExternalProcessChild

    const stdout = (): Buffer => Buffer.concat(stdoutChunks)
    const stderr = (): Buffer => Buffer.concat(stderrChunks)

    const cleanup = (): void => {
      clearTimeout(timeout)
      options.signal?.removeEventListener("abort", onAbort)
    }

    const fail = (kind: ExternalProcessErrorKind, message: string, exitCode?: number): void => {
      if (settled) return
      settled = true
      cleanup()
      const error = new ExternalProcessError(
        message,
        kind,
        options.command,
        [...options.args],
        options.cwd,
        stdout(),
        stderr(),
        exitCode
      )
      void terminateProcessTree(child).then(
        () => reject(error),
        () => reject(error)
      )
    }

    const onAbort = (): void => fail("cancelled", `Command cancelled: ${options.command}`)
    const timeout = setTimeout(
      () => fail("timeout", `Command timed out after ${timeoutMs} ms: ${options.command}`),
      timeoutMs
    )

    try {
      child = spawn(options.command, options.args, {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"]
      })
    } catch (error) {
      settled = true
      cleanup()
      reject(new ExternalProcessError(
        `Failed to start command ${options.command}: ${error instanceof Error ? error.message : String(error)}`,
        "spawnFailure",
        options.command,
        [...options.args],
        options.cwd
      ))
      return
    }

    const collect = (target: Buffer[], chunk: Buffer | string): void => {
      if (settled) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      const remainingBytes = maxBufferBytes - bufferedBytes
      const retainedBytes = Math.min(buffer.length, Math.max(0, remainingBytes))
      if (retainedBytes > 0) {
        target.push(buffer.subarray(0, retainedBytes))
        bufferedBytes += retainedBytes
      }
      if (retainedBytes < buffer.length) {
        fail(
          "bufferExceeded",
          `Command output exceeded ${maxBufferBytes} bytes: ${options.command}`
        )
      }
    }

    child.stdout.on("data", (chunk) => collect(stdoutChunks, chunk))
    child.stderr.on("data", (chunk) => collect(stderrChunks, chunk))
    child.on("error", (error) => {
      fail(
        "spawnFailure",
        `Command failed to start ${options.command}: ${error.message}`
      )
    })
    child.on("close", (code) => {
      if (settled) return
      settled = true
      cleanup()
      const exitCode = typeof code === "number" ? code : -1
      const result = { stdout: stdout(), stderr: stderr(), exitCode }
      if (allowedExitCodes.has(exitCode)) {
        resolve(result)
        return
      }
      reject(new ExternalProcessError(
        `Command exited with code ${exitCode}: ${options.command}`,
        "nonZeroExit",
        options.command,
        [...options.args],
        options.cwd,
        result.stdout,
        result.stderr,
        exitCode
      ))
    })

    options.signal?.addEventListener("abort", onAbort, { once: true })
    if (options.signal?.aborted) onAbort()
  })
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive finite number.`)
  return Math.floor(value)
}

function boundedTimeout(value: number): number {
  const timeout = positiveInteger(value, "timeoutMs")
  return Math.max(MIN_EXTERNAL_PROCESS_TIMEOUT_MS, Math.min(MAX_EXTERNAL_PROCESS_TIMEOUT_MS, timeout))
}

function terminateProcessTree(child: ExternalProcessChild): Promise<void> {
  return new Promise((resolve) => {
    let finished = false
    let timeout: ReturnType<typeof setTimeout>

    const finish = (): void => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      child.removeListener("exit", finish)
      child.removeListener("close", finish)
      resolve()
    }

    const fallbackKill = (): void => {
      try {
        child.kill("SIGKILL")
      } catch {
        // Best effort: the process may already be gone.
      }
    }

    timeout = setTimeout(() => {
      fallbackKill()
      finish()
    }, PROCESS_TERMINATION_WAIT_MS)

    child.once("exit", finish)
    child.once("close", finish)

    if (child.exitCode !== null || child.signalCode !== null) {
      finish()
      return
    }

    const pid = child.pid
    if (!pid) {
      fallbackKill()
      return
    }

    if (process.platform === "win32") {
      try {
        const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore"
        })
        killer.once("error", fallbackKill)
        killer.once("close", (code) => {
          if (code !== 0) fallbackKill()
          if (child.exitCode !== null || child.signalCode !== null) finish()
        })
      } catch {
        fallbackKill()
      }
      return
    }

    try {
      process.kill(-pid, "SIGKILL")
    } catch {
      fallbackKill()
    }
  })
}
