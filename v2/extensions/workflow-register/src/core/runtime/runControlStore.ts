import * as fs from "fs/promises"
import * as path from "path"

export type RunPauseMode = "afterCurrentStep" | "beforeNextAiCall"

export interface RunControlState {
  schemaVersion: "workflow-register/run-control/v1"
  runId: string
  pauseRequestedAt?: string
  pauseReason?: string
  requestedBy?: string
  mode?: RunPauseMode
  clearedAt?: string
  resumeNote?: string
}

export interface PauseRequestInput {
  runId: string
  reason?: string
  requestedBy?: string
  mode?: RunPauseMode
}

export interface RunControlStore {
  requestPause: (input: PauseRequestInput) => Promise<RunControlState>
  clearPause: (runId: string) => Promise<RunControlState>
  loadControl: (runId: string) => Promise<RunControlState | undefined>
  isPauseRequested: (runId: string) => Promise<boolean>
  recordResumeNote?: (runId: string, note: string) => Promise<RunControlState>
}

export interface FileRunControlStoreOptions {
  workspaceRoot: string
  now?: () => string
}

export class FileRunControlStore implements RunControlStore {
  private readonly workspaceRoot: string
  private readonly now: () => string

  constructor(options: FileRunControlStoreOptions) {
    this.workspaceRoot = options.workspaceRoot
    this.now = options.now ?? (() => new Date().toISOString())
  }

  async requestPause(input: PauseRequestInput): Promise<RunControlState> {
    const existing = await this.loadControl(input.runId)
    const next: RunControlState = {
      ...(existing ?? { schemaVersion: "workflow-register/run-control/v1", runId: input.runId }),
      schemaVersion: "workflow-register/run-control/v1",
      runId: input.runId,
      pauseRequestedAt: this.now(),
      pauseReason: input.reason ?? existing?.pauseReason ?? "manual",
      requestedBy: input.requestedBy ?? existing?.requestedBy ?? "user",
      mode: input.mode ?? existing?.mode ?? "afterCurrentStep",
      clearedAt: undefined
    }
    await this.saveControl(next)
    return next
  }

  async clearPause(runId: string): Promise<RunControlState> {
    const existing = await this.loadControl(runId)
    const next: RunControlState = {
      ...(existing ?? { schemaVersion: "workflow-register/run-control/v1", runId }),
      schemaVersion: "workflow-register/run-control/v1",
      runId,
      pauseRequestedAt: undefined,
      pauseReason: undefined,
      requestedBy: undefined,
      mode: undefined,
      clearedAt: this.now()
    }
    await this.saveControl(next)
    return next
  }

  async loadControl(runId: string): Promise<RunControlState | undefined> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.controlFile(runId), "utf8")) as RunControlState
      return parsed?.schemaVersion === "workflow-register/run-control/v1" ? parsed : undefined
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
      throw error
    }
  }

  async isPauseRequested(runId: string): Promise<boolean> {
    const control = await this.loadControl(runId)
    return Boolean(control?.pauseRequestedAt && !control.clearedAt)
  }

  async recordResumeNote(runId: string, note: string): Promise<RunControlState> {
    const existing = await this.loadControl(runId)
    const next: RunControlState = {
      ...(existing ?? { schemaVersion: "workflow-register/run-control/v1", runId }),
      schemaVersion: "workflow-register/run-control/v1",
      runId,
      resumeNote: note
    }
    await this.saveControl(next)
    return next
  }

  private async saveControl(control: RunControlState): Promise<void> {
    const file = this.controlFile(control.runId)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await atomicWriteFile(file, `${JSON.stringify(control, null, 2)}\n`)
  }

  private controlFile(runId: string): string {
    return path.join(this.workspaceRoot, ".bob", "workflows", "runs", safeSegment(runId), "control.json")
  }
}

async function atomicWriteFile(file: string, content: string): Promise<void> {
  const tempFile = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  try {
    await fs.writeFile(tempFile, content, "utf8")
    await fs.rename(tempFile, file)
  } catch (error) {
    await fs.rm(tempFile, { force: true }).catch(() => undefined)
    throw error
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "run"
}
