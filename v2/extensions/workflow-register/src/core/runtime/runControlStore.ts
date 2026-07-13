import { assertWorkflowRunStateWritable } from "./runStateCodec"
import { FileRunStateStore } from "./runStateStore"
import { readContainedRunFile, writeContainedRunFile } from "./runStatePath"
import { syncRunMaterializedFile } from "./runDurabilityPath"

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
    await this.requireWritableRun(input.runId)
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
    await this.requireWritableRun(runId)
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
      const snapshot = await readContainedRunFile(this.workspaceRoot, runId, "control.json")
      const parsed = JSON.parse(snapshot.bytes.toString("utf8")) as RunControlState
      if (parsed?.schemaVersion !== "workflow-register/run-control/v1") return undefined
      if (parsed.runId !== runId) {
        throw new Error(`Workflow run control id mismatch: expected '${runId}', got '${parsed.runId}'.`)
      }
      return parsed
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
    await this.requireWritableRun(runId)
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

  private async requireWritableRun(runId: string): Promise<void> {
    const run = await new FileRunStateStore({ workspaceRoot: this.workspaceRoot }).loadRun(runId)
    if (!run) throw new Error(`Workflow run not found: ${runId}`)
    assertWorkflowRunStateWritable(run)
  }

  private async saveControl(control: RunControlState): Promise<void> {
    await writeContainedRunFile(
      this.workspaceRoot,
      control.runId,
      `${JSON.stringify(control, null, 2)}\n`,
      "control.json"
    )
    await syncRunMaterializedFile(this.workspaceRoot, control.runId, "control.json")
  }
}
