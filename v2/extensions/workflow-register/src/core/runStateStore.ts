import * as fs from "fs/promises"
import * as path from "path"
import { CoreWorkflowDefinition, WorkflowRunState } from "./model"

const RECOVERABLE_RUN_STATUSES = new Set(["running", "paused", "reviewing", "held"])

export interface RecoverableRunLookupOptions {
  executionMode?: "full" | "singleStep"
  stepId?: string
  allowOutOfOrder?: boolean
}

export interface RunStateStore {
  readonly workspaceRoot?: string
  createRun: (workflow: CoreWorkflowDefinition, inputs: Record<string, unknown>) => Promise<WorkflowRunState>
  saveRun: (run: WorkflowRunState) => Promise<void>
  loadRun: (runId: string) => Promise<WorkflowRunState | undefined>
  listRuns: () => Promise<WorkflowRunState[]>
  findRecoverableRun?: (workflow: CoreWorkflowDefinition, inputs: Record<string, unknown>, options?: RecoverableRunLookupOptions) => Promise<WorkflowRunState | undefined>
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
    await atomicWriteFile(file, `${JSON.stringify(run, null, 2)}\n`)
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

  async findRecoverableRun(workflow: CoreWorkflowDefinition, inputs: Record<string, unknown>, options: RecoverableRunLookupOptions = {}): Promise<WorkflowRunState | undefined> {
    const expectedInputs = stableJson(inputs)
    const runs = await this.listRuns()
    return runs.find((run) => isRecoverableRun(run, workflow, expectedInputs, options))
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

function workflowDefinitionMatches(run: WorkflowRunState, workflow: CoreWorkflowDefinition): boolean {
  if (run.workflowDefinitionHash && workflow.definitionHash && run.workflowDefinitionHash !== workflow.definitionHash) return false
  if (run.workflowFile && workflow.filePath && run.workflowFile !== workflow.filePath) return false
  return true
}

function isRecoverableRun(run: WorkflowRunState, workflow: CoreWorkflowDefinition, expectedInputs: string, options: RecoverableRunLookupOptions): boolean {
  if (run.workflowId !== workflow.id) return false
  if (!workflowDefinitionMatches(run, workflow)) return false
  if (stableJson(run.inputs) !== expectedInputs) return false
  if (RECOVERABLE_RUN_STATUSES.has(run.status)) return true
  if (run.status !== "failed" || options.executionMode !== "singleStep" || !options.stepId) return false
  if (run.currentStep !== options.stepId) return false
  const stepIndex = workflow.engineSteps.findIndex((step) => step.id === options.stepId)
  if (stepIndex < 0) return false
  if (run.steps[stepIndex]?.status !== "failed") return false
  return run.steps.slice(0, stepIndex).every((step) => step.status === "completed")
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalJson(value))
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => [key, canonicalJson((value as Record<string, unknown>)[key])])
  )
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
