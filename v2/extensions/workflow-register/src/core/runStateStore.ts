import * as fs from "fs/promises"
import * as path from "path"
import { CoreWorkflowDefinition, WorkflowRunState } from "./model"

export interface RunStateStore {
  readonly workspaceRoot?: string
  createRun: (workflow: CoreWorkflowDefinition, inputs: Record<string, unknown>) => Promise<WorkflowRunState>
  saveRun: (run: WorkflowRunState) => Promise<void>
  loadRun: (runId: string) => Promise<WorkflowRunState | undefined>
  listRuns: () => Promise<WorkflowRunState[]>
}

export interface FileRunStateStoreOptions {
  workspaceRoot: string
  now?: () => string
  engineVersion?: string
}

export class FileRunStateStore implements RunStateStore {
  readonly workspaceRoot: string
  private readonly now: () => string
  private readonly engineVersion?: string

  constructor(options: FileRunStateStoreOptions) {
    this.workspaceRoot = options.workspaceRoot
    this.now = options.now ?? (() => new Date().toISOString())
    this.engineVersion = options.engineVersion
  }

  async createRun(workflow: CoreWorkflowDefinition, inputs: Record<string, unknown>): Promise<WorkflowRunState> {
    const createdAt = this.now()
    const runId = await this.nextRunId(workflow.name, createdAt)
    return {
      runId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      workflowSchemaVersion: workflow.schemaVersion,
      workflowDefinitionHash: workflow.definitionHash,
      workflowFile: workflow.filePath,
      engineVersion: this.engineVersion,
      status: "running",
      currentStep: workflow.engineSteps[0]?.id,
      inputs,
      state: {},
      steps: workflow.engineSteps.map((step) => ({
        id: step.id,
        title: step.title,
        type: step.type,
        status: "pending"
      })),
      createdAt,
      updatedAt: createdAt
    }
  }

  async saveRun(run: WorkflowRunState): Promise<void> {
    run.updatedAt = this.now()
    const file = this.runFile(run.runId)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, `${JSON.stringify(run, null, 2)}\n`, "utf8")
  }

  async loadRun(runId: string): Promise<WorkflowRunState | undefined> {
    try {
      return JSON.parse(await fs.readFile(this.runFile(runId), "utf8")) as WorkflowRunState
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === "ENOENT") return undefined
      throw error
    }
  }

  async listRuns(): Promise<WorkflowRunState[]> {
    const root = this.runsRoot()
    let entries: string[]
    try {
      entries = await fs.readdir(root)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === "ENOENT") return []
      throw error
    }
    const runs = await Promise.all(entries.map((entry) => this.loadRun(entry)))
    return runs
      .filter((run): run is WorkflowRunState => Boolean(run))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  private async nextRunId(workflowName: string, createdAt: string): Promise<string> {
    const stamp = createdAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace(/[^\dTZ]/g, "")
    const base = `${stamp}-${sanitize(workflowName)}`
    for (let index = 1; ; index += 1) {
      const candidate = index === 1 ? base : `${base}-${index}`
      if (!await exists(this.runFile(candidate))) return candidate
    }
  }

  private runsRoot(): string {
    return path.join(this.workspaceRoot, ".bob", "workflows", "runs")
  }

  private runFile(runId: string): string {
    return path.join(this.runsRoot(), runId, "run.json")
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workflow"
}
