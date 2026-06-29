import * as fs from "fs/promises"
import * as path from "path"
import { ActionRegistry } from "./actionRegistry"
import { validateCommandGuardrails } from "./guardrails"
import { validateWorkflowInputs } from "./inputResolver"
import {
  AgentProvider,
  CoreWorkflowDefinition,
  EngineStep,
  ResultSourceDefinition,
  WorkflowArtifactDefinition,
  WorkflowPreflightDefinition,
  WorkflowRunState
} from "./model"
import { reportedActionError } from "./reportedActionError"
import { ResultSinkRegistry } from "./resultSinkRegistry"
import { RunStateStore } from "./runStateStore"

export interface WorkflowPreflightCheckInput {
  workflow: CoreWorkflowDefinition
  run: WorkflowRunState
  checkId: string
}

export type WorkflowPreflightCheckResult = boolean | string | { ok: boolean; error?: string }

export interface WorkflowEngineOptions {
  actions: ActionRegistry
  resultSinks: ResultSinkRegistry
  runStore: RunStateStore
  agentProvider?: AgentProvider
  workspaceAvailable?: () => Promise<boolean> | boolean
  fileExists?: (relativePath: string) => Promise<boolean> | boolean
  preflightChecks?: Record<string, (input: WorkflowPreflightCheckInput) => Promise<WorkflowPreflightCheckResult> | WorkflowPreflightCheckResult>
  strictPreflightChecks?: boolean
}

export interface ResumeRunOptions {
  workflow: CoreWorkflowDefinition
  completeHeldStep?: boolean
}

export class WorkflowEngine {
  private readonly actions: ActionRegistry
  private readonly resultSinks: ResultSinkRegistry
  private readonly runStore: RunStateStore
  private readonly agentProvider?: AgentProvider
  private readonly workspaceAvailable?: WorkflowEngineOptions["workspaceAvailable"]
  private readonly fileExists?: WorkflowEngineOptions["fileExists"]
  private readonly preflightChecks: NonNullable<WorkflowEngineOptions["preflightChecks"]>
  private readonly strictPreflightChecks: boolean

  constructor(options: WorkflowEngineOptions) {
    this.actions = options.actions
    this.resultSinks = options.resultSinks
    this.runStore = options.runStore
    this.agentProvider = options.agentProvider
    const workspaceRoot = options.runStore.workspaceRoot
    this.workspaceAvailable = options.workspaceAvailable ?? (workspaceRoot ? (() => true) : undefined)
    this.fileExists = options.fileExists ?? (workspaceRoot ? ((relativePath) => exists(path.join(workspaceRoot, relativePath))) : undefined)
    this.preflightChecks = {
      ...createDefaultPreflightChecks(workspaceRoot),
      ...(options.preflightChecks ?? {})
    }
    this.strictPreflightChecks = options.strictPreflightChecks === true
  }

  async runWorkflow(workflow: CoreWorkflowDefinition, inputs: Record<string, unknown>): Promise<WorkflowRunState> {
    const run = await this.runStore.createRun(workflow, inputs)
    const inputProblems = validateWorkflowInputs(workflow.inputs ?? {}, inputs)
    if (inputProblems.length > 0) {
      run.status = "failed"
      run.error = inputProblems.join("; ")
      await this.runStore.saveRun(run)
      return run
    }

    const preflight = await this.evaluatePreflight(workflow, run)
    if (preflight.warnings.length > 0) run.state["workflow.preflightWarnings"] = JSON.stringify(preflight.warnings)
    if (preflight.errors.length > 0) {
      run.status = "failed"
      run.error = `Workflow preflight failed: ${preflight.errors.join("; ")}`
      await this.runStore.saveRun(run)
      return run
    }

    await this.runStore.saveRun(run)
    return this.continueRun(workflow, run, 0)
  }

  async resumeRun(runId: string, options: ResumeRunOptions): Promise<WorkflowRunState> {
    const run = await this.runStore.loadRun(runId)
    if (!run) throw new Error(`Workflow run not found: ${runId}`)
    let startIndex = options.workflow.engineSteps.findIndex((step) => step.id === run.currentStep)
    if (startIndex < 0) startIndex = nextPendingIndex(run)
    if (run.status === "held" && options.completeHeldStep && startIndex >= 0) {
      const held = run.steps[startIndex]
      held.status = "completed"
      held.completedAt = new Date().toISOString()
      run.status = "running"
      startIndex += 1
    }
    await this.runStore.saveRun(run)
    return this.continueRun(options.workflow, run, Math.max(0, startIndex))
  }

  async retryCurrentStep(runId: string, workflow: CoreWorkflowDefinition): Promise<WorkflowRunState> {
    const run = await this.runStore.loadRun(runId)
    if (!run) throw new Error(`Workflow run not found: ${runId}`)
    const index = workflow.engineSteps.findIndex((step) => step.id === run.currentStep)
    if (index < 0) throw new Error(`Current step is not part of workflow ${workflow.id}: ${run.currentStep ?? "none"}`)
    run.status = "running"
    run.error = undefined
    run.steps[index].status = "pending"
    run.steps[index].error = undefined
    await this.runStore.saveRun(run)
    return this.continueRun(workflow, run, index)
  }

  private async continueRun(workflow: CoreWorkflowDefinition, run: WorkflowRunState, startIndex: number): Promise<WorkflowRunState> {
    for (let index = startIndex; index < workflow.engineSteps.length; index += 1) {
      const step = workflow.engineSteps[index]
      const stepState = run.steps[index]
      run.currentStep = step.id
      run.status = "running"
      stepState.status = "running"
      stepState.startedAt = stepState.startedAt ?? new Date().toISOString()
      await this.runStore.saveRun(run)

      const stepResult = await this.executeStep(workflow, run, step)
      if (!stepResult.ok) {
        stepState.status = stepResult.held ? "held" : "failed"
        stepState.error = stepResult.error
        run.status = stepResult.held ? "held" : "failed"
        run.error = stepResult.error
        run.currentStep = step.id
        await this.runStore.saveRun(run)
        return run
      }

      const artifactResult = await this.writeProducedArtifacts(workflow, run, step)
      if (!artifactResult.ok) {
        stepState.status = "failed"
        stepState.error = artifactResult.error
        run.status = "failed"
        run.error = artifactResult.error
        run.currentStep = step.id
        await this.runStore.saveRun(run)
        return run
      }

      stepState.status = "completed"
      stepState.completedAt = new Date().toISOString()
      stepState.error = undefined
      await this.runStore.saveRun(run)
    }

    run.status = "completed"
    run.currentStep = undefined
    run.error = undefined
    await this.runStore.saveRun(run)
    return run
  }

  private async executeStep(workflow: CoreWorkflowDefinition, run: WorkflowRunState, step: EngineStep): Promise<{ ok: true } | { ok: false; held?: boolean; error: string }> {
    if (step.type === "manual") return { ok: false, held: true, error: "Manual workflow step is waiting for completion." }
    if (step.type === "agent") {
      if (!this.agentProvider) return { ok: false, error: "Agent provider is required for agent workflow steps." }
      try {
        const prompt = renderTemplate(step.prompt ?? "", { inputs: run.inputs, state: run.state, run, workflow, step })
        const agentText = await Promise.resolve(this.agentProvider.run({
          workflowId: workflow.id,
          logicalWorkflowId: workflow.logicalWorkflowId,
          workflowRoot: workflow.workflowRoot,
          workflowFile: workflow.workflowFile,
          workflowFolderName: workflow.workflowFolderName,
          runId: run.runId,
          stepId: step.id,
          prompt,
          inputs: run.inputs,
          state: run.state
        }))
        if (step.resultKey) run.state[step.resultKey] = agentText
        if (step.result) return this.writeResultSinks(workflow, run, step.id, step.result, agentText)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
    if (step.type === "command") {
      const guardrail = validateCommandGuardrails(workflow, step.action.provider)
      if (guardrail) return { ok: false, error: guardrail }
      const args = renderValue(step.action.args, { inputs: run.inputs, state: run.state, run, workflow, step })
      const result = await this.actions.execute(step.action.provider, {
        args,
        inputs: run.inputs,
        state: run.state,
        workflowId: workflow.id,
        logicalWorkflowId: workflow.logicalWorkflowId,
        workflowRoot: workflow.workflowRoot,
        workflowFile: workflow.workflowFile,
        workflowFolderName: workflow.workflowFolderName,
        runId: run.runId,
        stepId: step.id
      })
      if (!result.ok) return { ok: false, error: result.error ?? `Action provider failed: ${step.action.provider}` }
      const actionError = reportedActionError(result.value)
      if (actionError) return { ok: false, error: actionError }
      if (step.resultKey) run.state[step.resultKey] = formatStateValue(result.value)
      return { ok: true }
    }
    return this.writeResultSinks(workflow, run, step.id, step.result)
  }

  private async writeResultSinks(workflow: CoreWorkflowDefinition, run: WorkflowRunState, stepId: string, result: ResultSourceDefinition, agentText?: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const text = resultText(run, result, agentText)
      for (const sink of result.sinks) {
        const write = await this.resultSinks.write(sink, {
          workflowId: workflow.id,
          runId: run.runId,
          stepId,
          text
        })
        if (!write.ok) return { ok: false, error: write.error ?? `Result sink failed: ${sink.type}` }
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    return { ok: true }
  }

  private async writeProducedArtifacts(workflow: CoreWorkflowDefinition, run: WorkflowRunState, step: EngineStep): Promise<{ ok: true } | { ok: false; error: string }> {
    const artifacts = workflow.artifacts ?? []
    for (const artifact of artifacts.filter((item) => item.producedBy === step.id)) {
      const value = run.state[artifact.id]
      if (value === undefined) continue
      const path = renderArtifactPath(artifact, { inputs: run.inputs, state: run.state, run, workflow, step })
      if (path.includes("{{")) continue
      const write = await this.resultSinks.write({ type: "file", path }, {
        workflowId: workflow.id,
        runId: run.runId,
        stepId: step.id,
        text: value
      })
      if (!write.ok) return { ok: false, error: write.error ?? `Failed to write artifact: ${artifact.id}` }
    }
    return { ok: true }
  }

  private async evaluatePreflight(workflow: CoreWorkflowDefinition, run: WorkflowRunState): Promise<{ errors: string[]; warnings: string[] }> {
    const errors: string[] = []
    const warnings: string[] = []
    if (workflow.requires?.workspace && this.workspaceAvailable) {
      const available = await Promise.resolve(this.workspaceAvailable())
      if (!available) errors.push("Workspace is required but not available.")
    }
    for (const file of workflow.requires?.files ?? []) await this.checkFile(file, errors, warnings, true)
    for (const preflight of workflow.preflight ?? []) await this.evaluatePreflightEntry(workflow, run, preflight, errors, warnings)
    return { errors, warnings }
  }

  private async evaluatePreflightEntry(workflow: CoreWorkflowDefinition, run: WorkflowRunState, preflight: WorkflowPreflightDefinition, errors: string[], warnings: string[]): Promise<void> {
    const policy = preflight.failurePolicy ?? "stop"
    const required = preflight.required !== false
    const fail = (message: string) => {
      if (required && policy === "stop") errors.push(`${preflight.id}: ${message}`)
      else warnings.push(`${preflight.id}: ${message}`)
    }
    for (const file of preflight.files ?? []) await this.checkFile(file, errors, warnings, required && policy === "stop", preflight.id)
    for (const checkId of preflight.checks ?? []) {
      const check = this.preflightChecks[checkId]
      if (!check) {
        if (this.strictPreflightChecks) fail(`Unsupported preflight check: ${checkId}`)
        else warnings.push(`${preflight.id}: skipped unsupported preflight check: ${checkId}`)
        continue
      }
      const result = await Promise.resolve(check({ workflow, run, checkId }))
      const error = formatPreflightCheckFailure(result)
      if (error) fail(`${checkId}: ${error}`)
    }
  }

  private async checkFile(relativePath: string, errors: string[], warnings: string[], required: boolean, prefix?: string): Promise<void> {
    if (!this.fileExists) return
    const exists = await Promise.resolve(this.fileExists(relativePath))
    if (exists) return
    const message = `${prefix ? `${prefix}: ` : ""}Required workflow file is missing: ${relativePath}`
    if (required) errors.push(message)
    else warnings.push(message)
  }
}

function createDefaultPreflightChecks(workspaceRoot: string | undefined): NonNullable<WorkflowEngineOptions["preflightChecks"]> {
  if (!workspaceRoot) return {}
  return {
    workspaceOpen: () => true,
    bobWorkspaceInitialized: () => exists(path.join(workspaceRoot, ".bob")),
    bazaarRepository: () => exists(path.join(workspaceRoot, ".bzr"))
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

function resultText(run: WorkflowRunState, result: ResultSourceDefinition, agentText?: string): string {
  if (result.source === "literal") return result.text
  if (result.source === "agent") {
    if (agentText === undefined) throw new Error("Agent result source is not available for this step.")
    return agentText
  }
  const value = run.state[result.stateKey]
  if (value === undefined) throw new Error(`Workflow state is missing: ${result.stateKey}`)
  return value
}

function formatStateValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value)
}

function formatPreflightCheckFailure(result: WorkflowPreflightCheckResult): string | undefined {
  if (result === true) return undefined
  if (result === false) return "check returned false"
  if (typeof result === "string") return result
  return result.ok ? undefined : result.error ?? "check failed"
}

function nextPendingIndex(run: WorkflowRunState): number {
  return run.steps.findIndex((step) => step.status === "pending" || step.status === "held" || step.status === "failed")
}

function renderArtifactPath(artifact: WorkflowArtifactDefinition, context: { inputs: Record<string, unknown>; state: Record<string, string>; run: WorkflowRunState; workflow: CoreWorkflowDefinition; step: EngineStep }): string {
  return renderTemplate(artifact.path, context)
}

function renderValue(value: unknown, context: { inputs: Record<string, unknown>; state: Record<string, string>; run: WorkflowRunState; workflow: CoreWorkflowDefinition; step: EngineStep }): unknown {
  if (typeof value === "string") return renderTemplate(value, context)
  if (Array.isArray(value)) return value.map((item) => renderValue(item, context))
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) output[key] = renderValue(item, context)
    return output
  }
  return value
}

function renderTemplate(value: string, context: { inputs: Record<string, unknown>; state: Record<string, string>; run: WorkflowRunState; workflow: CoreWorkflowDefinition; step: EngineStep }): string {
  return value
    .replace(/\{\{\s*inputs\.([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, key) => String(context.inputs[key] ?? ""))
    .replace(/\{\{\s*state\.([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, key) => String(context.state[key] ?? ""))
    .replace(/\{\{\s*run\.id\s*\}\}/g, context.run.runId)
    .replace(/\{\{\s*workflow\.id\s*\}\}/g, context.workflow.id)
    .replace(/\{\{\s*step\.id\s*\}\}/g, context.step.id)
    .replace(/\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g, (match, key) => placeholderValue(key, context) ?? match)
}

function placeholderValue(key: string, context: { inputs: Record<string, unknown>; state: Record<string, string> }): string | undefined {
  if (Object.prototype.hasOwnProperty.call(context.inputs, key)) return formatTemplateValue(context.inputs[key])
  if (Object.prototype.hasOwnProperty.call(context.state, key)) return context.state[key]
  for (const value of Object.values(context.state)) {
    const parsed = parseJsonObjectFromText(value)
    if (!parsed || !Object.prototype.hasOwnProperty.call(parsed, key)) continue
    return formatTemplateValue(parsed[key])
  }
  return undefined
}

function parseJsonObjectFromText(value: string): Record<string, unknown> | undefined {
  const parsed = parseJsonObject(value)
  if (parsed) return parsed
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return fenced ? parseJsonObject(fenced[1]) : undefined
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function formatTemplateValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}
