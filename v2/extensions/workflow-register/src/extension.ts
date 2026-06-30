import * as path from "path"
import { createHash } from "crypto"
import * as vscode from "vscode"
import { buildWorkflowAgentPrompt, extractSubagentResult } from "./agentStep"
import { ActionProvider, ActionRegistry, createDefaultActionRegistry } from "./core/actionRegistry"
import { createCommandAgentProvider } from "./core/agentProvider"
import { WorkflowEngine, WorkflowEngineOptions, WorkflowExecutionHooks } from "./core/engine"
import { validateCommandGuardrails } from "./core/guardrails"
import { collectWorkflowInputsWithResolver } from "./core/inputCollector"
import { AgentProvider, CoreWorkflowDefinition, EngineStep, ResultSinkDefinition, WorkflowGuardrailsDefinition, WorkflowInputDefinition, WorkflowRunState } from "./core/model"
import { parseWorkflowMarkdown } from "./core/parser"
import { createDefaultResultSinkRegistry, ResultSinkRegistry } from "./core/resultSinkRegistry"
import { FileRunStateStore, RunStateStore } from "./core/runStateStore"
import { createBobTaskSnapshotProvider, FileTaskSnapshotStore, snapshotMatchesRun, TaskSnapshotProvider, TaskSnapshotReason, TaskSnapshotStore } from "./core/taskSnapshots"
import { fallbackWorkspaceRootCandidates, findMarkerRoots, findWorkflowRootCandidates, MarkerRootCandidate, relativePathFromRoot, rootHasMarker } from "./core/workspaceRoots"
import { executeResultHandoff, extractLastAssistantText, resultSourceForStep, ResultSource } from "./resultHandoff"
import { appendWorkflowContext } from "./workflowPromptContext"

const BOB_EXTENSION_ID = "IBM.bob-code"
const WORKFLOW_GLOB = "**/.bob/workflows/*/WORKFLOW.md"
const DEFAULT_MAX_RESULT_BYTES = 20_000

type StepCompletionMode = "auto" | "manual"
type StepMessageMode = "full" | "current" | "silent" | "step"

interface BobWorkflowApi {
  registerSource?: (id: string, name?: string) => unknown
}

interface BobWorkflowTask {
  sendMessage?: (...args: unknown[]) => Promise<unknown> | Thenable<unknown> | unknown
  setStepComplete?: () => unknown
  startSubagent?: (prompt: string, preset?: unknown, mask?: unknown) => Promise<unknown> | Thenable<unknown> | unknown
  getMessages?: () => unknown[]
  getAllMetadata?: () => Record<string, unknown>
  toSerializable?: () => unknown
}

interface BobWorkflowStep {
  id: string
  title: string
  execution: (task: BobWorkflowTask) => Promise<boolean>
}

interface BobWorkflow {
  hidden?: boolean
  getId: () => string
  getLabel: () => string
  getMenuLabel: () => string
  getDescription: () => string
  getMode?: () => string
  isEnabled: (env?: { workspace?: string }) => Promise<boolean>
  getSteps: () => BobWorkflowStep[]
  getApprovalConfig: () => { allowed_permissions: string[]; autoApprovalEnabled: boolean }
}

interface BobSourceLike {
  registerWorkflow?: (workflow: BobWorkflow) => unknown
  log?: (message: string) => unknown
  deactivate?: () => unknown
}

interface WorkflowTodoItem {
  id: string
  text: string
  raw: string
}

interface WorkflowStepDefinition {
  id: string
  prompt: string
  command?: string
  commandArgs: unknown[]
  sendResult: boolean
  required: boolean
  completeOnSuccess: boolean
  runAgent: boolean
  resultKey?: string
  includeState: string[]
  maxResultBytes: number
  stateRequired: boolean
  captureResult: boolean
  resultSource?: ResultSource
  resultCommand?: string
  resultCommandArgs: unknown[]
}

interface WorkflowStepCommandResult {
  command: string
  ok: boolean
  value?: unknown
  error?: string
}

interface WorkflowStateEntry {
  key: string
  value: string
}

interface WorkflowDefinition {
  id: string
  logicalWorkflowId?: string
  name: string
  label: string
  menuLabel: string
  description: string
  prompt: string
  promptWithoutTodo: string
  command?: string
  commandArgs: unknown[]
  mode: string
  permissions: string[]
  autoApprovalEnabled: boolean
  workspaceRequired: boolean
  hidden: boolean
  todoEnabled: boolean
  todoRequired: boolean
  todoSource: string
  todoAsSteps: boolean
  stepCompletion: StepCompletionMode
  stepMessage: StepMessageMode
  stepsById: Record<string, WorkflowStepDefinition>
  todos: WorkflowTodoItem[]
  inputs: Record<string, WorkflowInputDefinition>
  guardrails: WorkflowGuardrailsDefinition
  workflowRoot?: string
  workflowFile?: string
  workflowFolderName?: string
  file: vscode.Uri
  core: CoreWorkflowDefinition
}

interface LoadResult {
  workflows: WorkflowDefinition[]
  coreWorkflows: CoreWorkflowDefinition[]
  diagnostics: string[]
}

interface RunSelection {
  root: string
  runId: string
  run?: Awaited<ReturnType<RunStateStore["loadRun"]>>
}

interface RegistrationResult {
  summary: string
  lines: string[]
}

interface ActiveStep {
  key: string
  workflowId: string
  workflowLabel: string
  runId: string
  stepId: string
  title: string
  task: BobWorkflowTask
  stepDefinition?: WorkflowStepDefinition
  guardrails: WorkflowGuardrailsDefinition
  actionRegistry?: ActionRegistry
  inputs?: Record<string, unknown>
  state?: Record<string, string>
  messageStartIndex: number
  resolve: (value: boolean) => void
}

interface StepCompletionOptions {
  silent?: boolean
}

type BobWorkflowRunnerInputCollector = (task: BobWorkflowTask, provided: Record<string, unknown>) => Promise<Record<string, unknown> | undefined>

interface TaskSnapshotSettings {
  enabled: boolean
  maxBytes: number
  maxPerRun: number
  includeMessages: boolean
  pruneOnSave: boolean
}

export interface WorkflowRegisterApi {
  registerActionProvider: (provider: ActionProvider) => void
  registerAgentProvider: (provider: AgentProvider) => void
  registerResultSink: (type: string, handler: Parameters<ResultSinkRegistry["register"]>[1]) => void
  listWorkflows: () => CoreWorkflowDefinition[]
  runWorkflow: (workflowId?: string, inputs?: Record<string, unknown>) => Promise<unknown>
}

export function activate(context: vscode.ExtensionContext): WorkflowRegisterApi {
  const service = new WorkflowRegisterService(String(context.extension.packageJSON.version ?? "unknown"))
  context.subscriptions.push(service)
  context.subscriptions.push(
    vscode.commands.registerCommand("workflowRegister.reload", () => service.reload({ showReport: true })),
    vscode.commands.registerCommand("workflowRegister.inspect", () => service.inspect()),
    vscode.commands.registerCommand("workflowRegister.completeCurrentStep", (options?: StepCompletionOptions) => service.completeCurrentStep(options)),
    vscode.commands.registerCommand("workflowRegister.completeStep", (options?: StepCompletionOptions) => service.completeCurrentStep(options)),
    vscode.commands.registerCommand("workflowRegister.inspectActiveSteps", () => service.inspectActiveSteps()),
    vscode.commands.registerCommand("workflowRegister.runWorkflow", (workflowId?: string, inputs?: Record<string, unknown>) => service.runWorkflow(workflowId, inputs)),
    vscode.commands.registerCommand("workflowRegister.inspectRuns", () => service.inspectRuns()),
    vscode.commands.registerCommand("workflowRegister.resumeRun", (runId?: string) => service.resumeRun(runId)),
    vscode.commands.registerCommand("workflowRegister.retryCurrentStep", (runId?: string) => service.retryCurrentStep(runId))
  )
  service.reload({ showReport: false }).catch((error) => console.warn("Bob workflow registration failed", error))
  const retryDelaysMs = [3000, 10000]
  for (const delayMs of retryDelaysMs) {
    const timer = setTimeout(() => service.reload({ showReport: false }).catch((error) => console.warn("Bob workflow registration retry failed", error)), delayMs)
    context.subscriptions.push({ dispose: () => clearTimeout(timer) })
  }
  return {
    registerActionProvider: (provider) => service.registerActionProvider(provider),
    registerAgentProvider: (provider) => service.registerAgentProvider(provider),
    registerResultSink: (type, handler) => service.registerResultSink(type, handler),
    listWorkflows: () => service.listCoreWorkflows(),
    runWorkflow: (workflowId, inputs) => service.runWorkflow(workflowId, inputs)
  }
}

export function deactivate(): void {
  // Nothing to dispose beyond context subscriptions.
}

class StepRuntime {
  private readonly activeSteps = new Map<string, ActiveStep>()
  private sequence = 0

  hold(
    workflow: WorkflowDefinition,
    step: { id: string; title: string },
    task: BobWorkflowTask,
    context: { runId: string; stepDefinition?: WorkflowStepDefinition; actionRegistry?: ActionRegistry; inputs?: Record<string, unknown>; state?: Record<string, string>; messageStartIndex?: number }
  ): Promise<boolean> {
    const key = `${++this.sequence}:${workflow.id}:${step.id}`
    return new Promise<boolean>((resolve) => {
      this.activeSteps.set(key, {
        key,
        workflowId: workflow.id,
        workflowLabel: workflow.label,
        runId: context.runId,
        stepId: step.id,
        title: step.title,
        task,
        stepDefinition: context.stepDefinition,
        guardrails: workflow.guardrails,
        actionRegistry: context.actionRegistry,
        inputs: context.inputs,
        state: context.state,
        messageStartIndex: context.messageStartIndex ?? getTaskMessageCount(task),
        resolve
      })
    })
  }

  list(): ActiveStep[] {
    return Array.from(this.activeSteps.values())
  }

  async completeCurrentStep(): Promise<string> {
    const active = await this.pickActiveStep()
    if (!active) return "No active Bob workflow step."
    const handoff = await captureHeldStepResult(active)
    if (!handoff.ok) {
      const message = `Could not capture Bob workflow step result: ${handoff.error}`
      await vscode.window.showErrorMessage(message)
      return message
    }
    active.task.setStepComplete?.()
    active.resolve(true)
    this.activeSteps.delete(active.key)
    return `Completed: ${active.workflowLabel} / ${active.title}`
  }

  private async pickActiveStep(): Promise<ActiveStep | undefined> {
    const steps = this.list()
    if (steps.length === 0) return undefined
    if (steps.length === 1) return steps[0]
    const picked = await vscode.window.showQuickPick(
      steps.map((step) => ({
        label: step.title,
        description: step.workflowLabel,
        detail: `${step.workflowId} / ${step.stepId} / ${step.key}`,
        step
      })),
      { placeHolder: "Select the Bob workflow step to complete" }
    )
    return picked?.step
  }
}

async function captureHeldStepResult(active: ActiveStep): Promise<{ ok: boolean; error?: string }> {
  const step = active.stepDefinition
  if (!step?.captureResult) return { ok: true }
  if (step.resultCommand) {
    const guardrail = validateCommandGuardrails({ guardrails: active.guardrails }, step.resultCommand)
    if (guardrail) return { ok: false, error: guardrail }
  }
  const messages = active.task.getMessages?.()
  const resultText = resultSourceForStep(step) === "lastAssistant" && Array.isArray(messages)
    ? extractLastAssistantText(messages, active.messageStartIndex)
    : undefined
  return executeResultHandoff(step, resultText, {
    actions: active.actionRegistry,
    executeCommand: active.actionRegistry ? undefined : (command, ...args) => vscode.commands.executeCommand(command, ...args),
    inputs: active.inputs,
    state: active.state,
    workflowId: active.workflowId,
    runId: active.runId,
    stepId: active.stepId
  })
}

function getTaskMessageCount(task: BobWorkflowTask): number {
  const messages = task.getMessages?.()
  return Array.isArray(messages) ? messages.length : 0
}

class WorkflowRegisterService implements vscode.Disposable {
  private readonly registeredIds = new Set<string>()
  private readonly watcher = vscode.workspace.createFileSystemWatcher(WORKFLOW_GLOB)
  private readonly stepRuntime = new StepRuntime()
  private readonly coreWorkflows = new Map<string, CoreWorkflowDefinition>()
  private readonly actionRegistry = createDefaultActionRegistry({
    executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args)
  })
  private readonly customResultSinks: Array<{ type: string; handler: Parameters<ResultSinkRegistry["register"]>[1] }> = []
  private agentProvider?: AgentProvider
  private registeredSource?: BobSourceLike
  private lastResult: RegistrationResult = { summary: "No workflow registration has run yet.", lines: [] }

  constructor(private readonly engineVersion: string) {
    this.watcher.onDidCreate(() => this.reload({ showReport: false }))
    this.watcher.onDidChange(() => this.reload({ showReport: false }))
    this.watcher.onDidDelete(() => this.reload({ showReport: false }))
  }

  dispose(): void {
    this.watcher.dispose()
    void this.deactivateRegisteredSource()
  }

  async inspect(): Promise<void> {
    await showMarkdownReport("Bob Workflow Register", this.lastResult.summary, this.lastResult.lines)
  }

  async inspectActiveSteps(): Promise<void> {
    const steps = this.stepRuntime.list()
    const lines = steps.length === 0
      ? ["- No active Bob workflow steps."]
      : steps.map((step) => `- key=${step.key}; workflowId=${step.workflowId}; workflowTitle=${step.workflowLabel}; stepId=${step.stepId}; stepTitle=${step.title}`)
    await showMarkdownReport("Active Bob Workflow Steps", `${steps.length} active step(s).`, lines)
  }

  async completeCurrentStep(options: StepCompletionOptions = {}): Promise<string> {
    const message = await this.stepRuntime.completeCurrentStep()
    if (!options.silent) await vscode.window.showInformationMessage(message)
    return message
  }

  registerActionProvider(provider: ActionProvider): void {
    this.actionRegistry.register(provider)
  }

  registerAgentProvider(provider: AgentProvider): void {
    this.agentProvider = provider
  }

  registerResultSink(type: string, handler: Parameters<ResultSinkRegistry["register"]>[1]): void {
    this.customResultSinks.push({ type, handler })
  }

  listCoreWorkflows(): CoreWorkflowDefinition[] {
    return Array.from(this.coreWorkflows.values()).sort((a, b) => a.label.localeCompare(b.label))
  }

  async runWorkflow(workflowId?: string, inputs: Record<string, unknown> = {}): Promise<unknown> {
    if (this.coreWorkflows.size === 0) await this.reload({ showReport: false })
    const workflow = workflowId
      ? this.coreWorkflows.get(workflowId)
      : await this.pickCoreWorkflow()
    if (!workflow) return "No workflow selected."
    const root = workflow.workflowRoot ?? await this.pickWorkflowRoot("Select workflow workspace")
    if (!root) {
      const message = "No workspace folder is open."
      await vscode.window.showErrorMessage(message)
      return message
    }
    const resolvedInputs = await this.collectWorkflowInputs(workflow, inputs)
    if (!resolvedInputs) return "Workflow input was cancelled."
    const engine = this.createEngine(root)
    const run = await engine.runWorkflow(workflow, resolvedInputs)
    await vscode.window.showInformationMessage(`Workflow run ${run.status}: ${run.runId}`)
    return run
  }

  async inspectRuns(): Promise<void> {
    const roots = await this.workflowRootCandidates()
    if (roots.length === 0) {
      await vscode.window.showErrorMessage("No workspace folder is open.")
      return
    }
    const runsByRoot = (await Promise.all(roots.map(async (candidate) => ({
      candidate,
      runs: await this.createRunStore(candidate.root).listRuns()
    })))).flatMap(({ candidate, runs }) => runs.map((run) => ({ candidate, run })))
    const lines = runsByRoot.length === 0
      ? ["- No workflow runs were found."]
      : runsByRoot.map(({ candidate, run }) => `- ${run.runId}: ${run.status}; workflow=${run.workflowId}; root=${candidate.root}; currentStep=${run.currentStep ?? "none"}; updatedAt=${run.updatedAt}`)
    await showMarkdownReport("Workflow Runs", `${runsByRoot.length} run(s).`, lines)
  }

  async resumeRun(runId?: string): Promise<unknown> {
    return this.resumeOrRetryRun("resume", runId)
  }

  async retryCurrentStep(runId?: string): Promise<unknown> {
    return this.resumeOrRetryRun("retry", runId)
  }

  private async resumeOrRetryRun(mode: "resume" | "retry", runId?: string): Promise<unknown> {
    if (this.coreWorkflows.size === 0) await this.reload({ showReport: false })
    const selection = runId ? await this.findRunSelection(runId) : await this.pickRunSelection()
    if (!selection) {
      const message = "No workspace folder is open."
      if (!runId) return "No workflow run selected."
      await vscode.window.showErrorMessage(`Workflow run not found: ${runId}`)
      return message
    }
    const runStore = this.createRunStore(selection.root)
    const targetRunId = selection.runId
    const run = selection.run ?? await runStore.loadRun(targetRunId)
    if (!run) throw new Error(`Workflow run not found: ${targetRunId}`)
    const workflow = this.coreWorkflows.get(run.workflowId)
    if (!workflow) throw new Error(`Workflow definition is not loaded: ${run.workflowId}`)
    const engine = this.createEngine(selection.root)
    const result = mode === "resume"
      ? await engine.resumeRun(targetRunId, { workflow, completeHeldStep: true })
      : await engine.retryCurrentStep(targetRunId, workflow)
    await vscode.window.showInformationMessage(`Workflow run ${result.status}: ${result.runId}`)
    return result
  }

  private createEngine(workspaceRoot: string): WorkflowEngine {
    const snapshotStore = this.createTaskSnapshotStore(workspaceRoot)
    return new WorkflowEngine({
      actions: this.actionRegistry,
      resultSinks: this.createResultSinks(workspaceRoot),
      runStore: this.createRunStore(workspaceRoot),
      agentProvider: this.agentProvider ?? this.createCommandAgentProvider(),
      preflightChecks: this.createPreflightChecks(workspaceRoot),
      recoverResultText: snapshotStore
        ? (input) => recoverResultTextFromSnapshots(snapshotStore, input.workflow, input.run, input.step)
        : undefined
    })
  }

  private createBobWorkflowRunner(workflow: WorkflowDefinition): BobWorkflowEngineRunner {
    return new BobWorkflowEngineRunner({
      definition: workflow,
      coreWorkflow: workflow.core,
      actionRegistry: this.actionRegistry,
      resultSinks: (workspaceRoot) => this.createResultSinks(workspaceRoot),
      runStore: (workspaceRoot) => this.createRunStore(workspaceRoot),
      taskSnapshotStore: (workspaceRoot) => this.createTaskSnapshotStore(workspaceRoot),
      preflightChecks: (workspaceRoot) => this.createPreflightChecks(workspaceRoot),
      agentProvider: this.agentProvider ?? this.createCommandAgentProvider(),
      stepRuntime: this.stepRuntime,
      inputsProvider: (task, provided) => this.collectBobWorkflowInputs(workflow, {
        ...extractTaskWorkflowInputs(workflow, task),
        ...provided
      })
    })
  }

  private createCommandAgentProvider(): AgentProvider | undefined {
    const config = vscode.workspace.getConfiguration("workflowRegister")
    return createCommandAgentProvider({
      command: config.get<string>("agentCommand", ""),
      executeCommand: (command, input) => vscode.commands.executeCommand(command, input)
    })
  }

  private createResultSinks(workspaceRoot: string): ResultSinkRegistry {
    const registry = createDefaultResultSinkRegistry({
      workspaceRoot,
      executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args)
    })
    for (const sink of this.customResultSinks) registry.register(sink.type, sink.handler)
    return registry
  }

  private createRunStore(workspaceRoot: string): RunStateStore {
    return new FileRunStateStore({ workspaceRoot, engineVersion: this.engineVersion })
  }

  private createTaskSnapshotStore(workspaceRoot: string): TaskSnapshotStore | undefined {
    const settings = this.taskSnapshotSettings()
    if (!settings.enabled) return undefined
    return new FileTaskSnapshotStore({
      workspaceRoot,
      maxBytes: settings.maxBytes,
      maxPerRun: settings.maxPerRun,
      includeMessages: settings.includeMessages,
      pruneOnSave: settings.pruneOnSave
    })
  }

  private createPreflightChecks(workspaceRoot: string): NonNullable<WorkflowEngineOptions["preflightChecks"]> {
    return {
      bazaarRepository: () => this.bazaarRepositoryAvailable(workspaceRoot)
    }
  }

  private async bazaarRepositoryAvailable(workspaceRoot: string): Promise<boolean> {
    if (await rootHasMarker(workspaceRoot, ".bzr")) return true
    const folders = vscode.workspace.workspaceFolders ?? []
    if (folders.length === 0) return false
    const candidates = await findMarkerRoots(folders, ".bzr")
    return candidates.length > 0
  }

  private taskSnapshotSettings(): TaskSnapshotSettings {
    const config = vscode.workspace.getConfiguration("workflowRegister")
    return {
      enabled: config.get<boolean>("taskSnapshots.enabled", true),
      maxBytes: config.get<number>("taskSnapshots.maxBytes", 262_144),
      maxPerRun: config.get<number>("taskSnapshots.maxPerRun", 50),
      includeMessages: config.get<boolean>("taskSnapshots.includeMessages", true),
      pruneOnSave: config.get<boolean>("taskSnapshots.pruneOnSave", true)
    }
  }

  private async workflowRootCandidates(): Promise<MarkerRootCandidate[]> {
    const folders = vscode.workspace.workspaceFolders ?? []
    if (folders.length === 0) return []
    const markerRoots = await findWorkflowRootCandidates(folders)
    return markerRoots.length > 0 ? markerRoots : fallbackWorkspaceRootCandidates(folders)
  }

  private async pickWorkflowRoot(title: string): Promise<string | undefined> {
    const candidates = await this.workflowRootCandidates()
    if (candidates.length === 0) return undefined
    if (candidates.length === 1) return candidates[0].root
    const picked = await vscode.window.showQuickPick(candidates.map((candidate) => ({
      label: candidate.name,
      description: candidate.root,
      detail: `${candidate.marker}; ${candidate.depth}; workspace=${candidate.workspaceFolderName}`,
      candidate
    })), { title })
    return picked?.candidate.root
  }

  private async pickCoreWorkflow(): Promise<CoreWorkflowDefinition | undefined> {
    const workflows = this.listCoreWorkflows()
    if (workflows.length === 0) return undefined
    if (workflows.length === 1) return workflows[0]
    const picked = await vscode.window.showQuickPick(workflows.map((workflow) => ({
      label: workflow.label,
      description: workflow.name,
      detail: workflow.description,
      workflow
    })), { title: "Run Workflow" })
    return picked?.workflow
  }

  private async pickRunSelection(): Promise<RunSelection | undefined> {
    const selections = await this.listRunSelections()
    if (selections.length === 0) return undefined
    const picked = await vscode.window.showQuickPick(selections.map((selection) => ({
      label: selection.runId,
      description: selection.run?.status,
      detail: `${selection.run?.workflowId}; root=${selection.root}; currentStep=${selection.run?.currentStep ?? "none"}`,
      selection
    })), { title: "Workflow Run" })
    return picked?.selection
  }

  private async findRunSelection(runId: string): Promise<RunSelection | undefined> {
    return (await this.listRunSelections()).find((selection) => selection.runId === runId)
  }

  private async listRunSelections(): Promise<RunSelection[]> {
    const roots = await this.workflowRootCandidates()
    const nested = await Promise.all(roots.map(async (candidate) => {
      const runStore = this.createRunStore(candidate.root)
      const runs = await runStore.listRuns()
      return runs.map((run) => ({ root: candidate.root, runId: run.runId, run }))
    }))
    return nested.flat().sort((a, b) => (b.run?.updatedAt ?? "").localeCompare(a.run?.updatedAt ?? ""))
  }

  private async pickRunId(runStore: RunStateStore): Promise<string | undefined> {
    const runs = await runStore.listRuns()
    if (runs.length === 0) return undefined
    const picked = await vscode.window.showQuickPick(runs.map((run) => ({
      label: run.runId,
      description: run.status,
      detail: `${run.workflowId}; currentStep=${run.currentStep ?? "none"}`,
      runId: run.runId
    })), { title: "Workflow Run" })
    return picked?.runId
  }

  private async collectWorkflowInputs(workflow: CoreWorkflowDefinition, provided: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    return collectWorkflowInputsWithResolver({
      inputs: workflow.inputs,
      provided,
      prompt: (key, definition, required) => this.promptForInput(key, definition, required)
    })
  }

  private async collectBobWorkflowInputs(workflow: WorkflowDefinition, provided: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    return collectWorkflowInputsWithResolver({
      inputs: workflow.inputs,
      provided,
      prompt: (key, definition, required) => this.promptForInput(key, definition, required)
    })
  }

  private async promptForInput(key: string, definition: WorkflowInputDefinition, required: boolean): Promise<unknown> {
    const title = definition.title ?? key
    if (definition.type === "boolean") {
      const picked = await vscode.window.showQuickPick(["true", "false"], { title })
      if (picked === undefined && required) return undefined
      return picked === undefined ? undefined : picked === "true"
    }
    if (definition.type === "select") {
      return vscode.window.showQuickPick(definition.options ?? [], { title })
    }
    const value = await vscode.window.showInputBox({ title, value: definition.default === undefined ? undefined : String(definition.default) })
    if (value === undefined) return undefined
    if (definition.type === "number") return Number(value)
    return value
  }

  async reload(options: { showReport: boolean }): Promise<void> {
    const result = await this.registerWorkflows()
    this.lastResult = result
    if (options.showReport) await showMarkdownReport("Bob Workflow Register", result.summary, result.lines)
  }

  private async registerWorkflows(): Promise<RegistrationResult> {
    const config = vscode.workspace.getConfiguration("workflowRegister")
    const sourceId = config.get<string>("sourceId", "workflow-register")
    const sourceName = config.get<string>("sourceName", "Workflow Register")
    const lines: string[] = []
    const loaded = await loadWorkspaceWorkflows(sourceId)
    lines.push(...loaded.diagnostics)
    this.coreWorkflows.clear()
    for (const workflow of loaded.coreWorkflows) this.coreWorkflows.set(workflow.id, workflow)
    if (loaded.workflows.length === 0) {
      await this.deactivateRegisteredSource(lines)
      this.registeredIds.clear()
      await vscode.commands.executeCommand("setContext", "bob-code.hasWorkflows", false)
      return { summary: "No .bob workflows were found.", lines }
    }

    const bob = await loadBobApi()
    lines.push(`- Bob extension found: ${bob.found}`)
    lines.push(`- Bob extension active: ${bob.active}`)
    lines.push(`- Bob activation error: ${bob.activationError}`)
    const api = bob.exportsValue as BobWorkflowApi | undefined
    if (typeof api?.registerSource !== "function") {
      lines.push("- fail: IBM Bob registerSource API is not available.")
      return { summary: "Bob workflow registration API is unavailable.", lines }
    }

    await this.deactivateRegisteredSource(lines)
    const sourceResult = await runAttempt("registerSource(sourceId, sourceName)", () => api.registerSource?.(sourceId, sourceName))
    lines.push(formatAttempt(sourceResult))
    const source = asSource(sourceResult.value)
    lines.push(`- returned source keys: ${source ? Object.keys(source as Record<string, unknown>).join(",") || "none" : "none"}`)
    lines.push(`- typeof source.registerWorkflow: ${typeof source?.registerWorkflow}`)
    if (!source?.registerWorkflow) return { summary: "Bob accepted the source request, but workflows cannot be registered.", lines }
    this.registeredSource = source

    let registeredCount = 0
    const registeredIds = new Set<string>()
    for (const workflow of loaded.workflows) {
      const attempt = await runAttempt(`source.registerWorkflow(${workflow.id})`, () => source.registerWorkflow?.(createBobWorkflow(workflow, this.createBobWorkflowRunner(workflow))))
      lines.push(formatAttempt(attempt))
      if (attempt.ok) {
        registeredIds.add(workflow.id)
        registeredCount += 1
        source.log?.(`Workflow registered from ${workflow.file.fsPath}: ${workflow.id}`)
      }
    }
    this.registeredIds.clear()
    for (const id of registeredIds) this.registeredIds.add(id)
    await vscode.commands.executeCommand("setContext", "bob-code.hasWorkflows", this.registeredIds.size > 0)
    return { summary: `Registered ${registeredCount} workflow(s); ${this.registeredIds.size} workflow(s) are registered in this session.`, lines }
  }

  private async deactivateRegisteredSource(lines?: string[]): Promise<void> {
    const source = this.registeredSource
    this.registeredSource = undefined
    if (!source?.deactivate) return
    const attempt = await runAttempt("previousSource.deactivate()", () => source.deactivate?.())
    lines?.push(formatAttempt(attempt))
  }
}

async function loadWorkspaceWorkflows(sourceId: string): Promise<LoadResult> {
  const diagnostics: string[] = []
  const workflows: WorkflowDefinition[] = []
  const coreWorkflows: CoreWorkflowDefinition[] = []
  const folders = vscode.workspace.workspaceFolders ?? []
  const roots = await findWorkflowRootCandidates(folders)
  const searchRoots = roots.length > 0 ? roots : fallbackWorkspaceRootCandidates(folders)
  for (const root of searchRoots) {
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(root.root, ".bob/workflows/*/WORKFLOW.md"))
    diagnostics.push(`- workspace: ${root.workspaceFolderName}; workflowRoot=${root.root}; marker=${root.marker}; depth=${root.depth}; workflow files: ${files.length}`)
    for (const file of files) {
      const result = await loadWorkflowFile(sourceId, file, root)
      diagnostics.push(...result.diagnostics)
      if (result.workflow) workflows.push(result.workflow)
      if (result.coreWorkflow) coreWorkflows.push(result.coreWorkflow)
    }
  }
  qualifyDuplicateWorkflowIds(workflows, coreWorkflows)
  return { workflows, coreWorkflows, diagnostics }
}

async function loadWorkflowFile(sourceId: string, file: vscode.Uri, root: MarkerRootCandidate): Promise<{ workflow?: WorkflowDefinition; coreWorkflow?: CoreWorkflowDefinition; diagnostics: string[] }> {
  const relativePath = relativePathFromRoot(root.root, file.fsPath)
  const diagnostics: string[] = []
  const folderName = path.basename(path.dirname(file.fsPath))
  const text = Buffer.from(await vscode.workspace.fs.readFile(file)).toString("utf8").replace(/^\uFEFF/, "")
  const parsed = parseWorkflowMarkdown({ sourceId, filePath: relativePath, text })
  diagnostics.push(...parsed.diagnostics)
  if (!parsed.ok) return { diagnostics }
  const coreWorkflow = {
    ...parsed.workflow,
    logicalWorkflowId: parsed.workflow.id,
    workflowRoot: root.root,
    workflowFile: file.fsPath,
    workflowFolderName: root.name
  }
  const workflow = adaptCoreWorkflowForBob(coreWorkflow, file)
  if (folderName !== parsed.workflow.name) diagnostics.push(`- warn: ${relativePath}: folder name '${folderName}' differs from workflow name '${parsed.workflow.name}'.`)
  if (workflow.todoRequired && workflow.todos.length === 0) return { diagnostics: [`- fail: ${relativePath}: todoRequired is true but no todo items were found.`] }
  if (workflow.stepMessage === "step") for (const todo of workflow.todos) if (!workflow.stepsById[todo.id]?.prompt) diagnostics.push(`- warn: ${relativePath}: missing prompt for workflow step '${todo.id}'.`)

  const stepCount = workflow.todoEnabled && workflow.todoAsSteps && workflow.todos.length > 0 ? workflow.todos.length : 1
  const stepPromptCount = Object.values(workflow.stepsById).filter((step) => step.prompt.length > 0).length
  const stepCommandCount = Object.values(workflow.stepsById).filter((step) => step.command).length
  const agentStepCount = Object.values(workflow.stepsById).filter((step) => step.runAgent).length
  const stateKeyCount = Object.values(workflow.stepsById).filter((step) => step.resultKey).length
  const includeStateCount = Object.values(workflow.stepsById).filter((step) => step.includeState.length > 0).length
  const captureResultCount = Object.values(workflow.stepsById).filter((step) => step.captureResult).length
  diagnostics.push(`- ok: ${relativePath}: ${workflow.id}; todos=${workflow.todos.length}; todo=${workflow.todoEnabled}; steps=${stepCount}; stepCompletion=${workflow.stepCompletion}; stepMessage=${workflow.stepMessage}; stepPrompts=${stepPromptCount}; stepCommands=${stepCommandCount}; agentSteps=${agentStepCount}; stateKeys=${stateKeyCount}; includeState=${includeStateCount}; captureResults=${captureResultCount}`)
  for (const step of Object.values(workflow.stepsById).filter((candidate) => candidate.command)) diagnostics.push(`- step command: ${step.id} -> ${step.command}; sendResult=${step.sendResult}; required=${step.required}; completeOnSuccess=${step.completeOnSuccess}`)
  for (const step of Object.values(workflow.stepsById).filter((candidate) => candidate.runAgent)) diagnostics.push(`- agent step: ${step.id}; resultKey=${step.resultKey ?? "none"}; maxResultBytes=${step.maxResultBytes}`)
  for (const step of Object.values(workflow.stepsById).filter((candidate) => candidate.resultKey || candidate.includeState.length > 0)) {
    const savePart = step.resultKey ? `resultKey=${step.resultKey}` : "resultKey=none"
    const includePart = step.includeState.length > 0 ? `includeState=${step.includeState.join(",")}` : "includeState=none"
    diagnostics.push(`- step state: ${step.id}; ${savePart}; ${includePart}; stateRequired=${step.stateRequired}; maxResultBytes=${step.maxResultBytes}`)
  }
  for (const step of Object.values(workflow.stepsById).filter((candidate) => candidate.captureResult)) {
    diagnostics.push(`- step capture: ${step.id}; resultSource=${resultSourceForStep(step)}; resultCommand=${step.resultCommand ?? "none"}`)
  }
  return { workflow, coreWorkflow, diagnostics }
}

function adaptCoreWorkflowForBob(core: CoreWorkflowDefinition, file: vscode.Uri): WorkflowDefinition {
  const todos = core.todos.map((todo, index) => ({
    id: todo.id,
    text: todo.title,
    raw: todo.raw ?? `${todo.id}: ${todo.title || `Step ${index + 1}`}`
  }))
  return {
    id: core.id,
    logicalWorkflowId: core.logicalWorkflowId ?? core.id,
    name: core.name,
    label: core.label,
    menuLabel: core.menuLabel ?? core.label,
    description: core.description,
    prompt: core.prompt,
    promptWithoutTodo: core.promptWithoutTodo,
    command: core.command,
    commandArgs: core.commandArgs,
    mode: core.mode,
    permissions: [...core.permissions],
    autoApprovalEnabled: core.autoApprovalEnabled,
    workspaceRequired: core.workspaceRequired,
    hidden: core.hidden,
    todoEnabled: core.todoEnabled,
    todoRequired: core.todoRequired,
    todoSource: "core",
    todoAsSteps: core.todoAsSteps,
    stepCompletion: core.stepCompletion,
    stepMessage: core.stepMessage,
    stepsById: Object.fromEntries(core.engineSteps.map((step) => [step.id, workflowStepDefinitionFromEngineStep(step)])),
    todos,
    inputs: core.inputs,
    guardrails: core.guardrails,
    workflowRoot: core.workflowRoot,
    workflowFile: core.workflowFile,
    workflowFolderName: core.workflowFolderName,
    file,
    core
  }
}

function qualifyDuplicateWorkflowIds(workflows: WorkflowDefinition[], coreWorkflows: CoreWorkflowDefinition[]): void {
  const counts = new Map<string, number>()
  for (const workflow of coreWorkflows) counts.set(workflow.id, (counts.get(workflow.id) ?? 0) + 1)
  for (const workflow of coreWorkflows) {
    const logicalId = workflow.logicalWorkflowId ?? workflow.id
    workflow.logicalWorkflowId = logicalId
    if ((counts.get(logicalId) ?? 0) > 1) workflow.id = qualifiedWorkflowId(logicalId, workflow.workflowRoot)
  }
  for (const workflow of workflows) {
    const logicalId = workflow.logicalWorkflowId ?? workflow.id
    workflow.logicalWorkflowId = logicalId
    if ((counts.get(logicalId) ?? 0) > 1) workflow.id = qualifiedWorkflowId(logicalId, workflow.workflowRoot)
  }
}

function qualifiedWorkflowId(logicalId: string, workflowRoot: string | undefined): string {
  const root = workflowRoot ?? "unknown"
  const slug = path.basename(root).replace(/[^A-Za-z0-9_-]+/g, "-") || "workspace"
  const hash = createHash("sha1").update(root).digest("hex").slice(0, 8)
  return `${logicalId}.${slug}-${hash}`
}

function workflowStepDefinitionFromEngineStep(step: EngineStep): WorkflowStepDefinition {
  const commandSink = commandResultSink(step)
  return {
    id: step.id,
    prompt: step.prompt?.trim() ?? "",
    command: step.type === "command" ? step.action.provider : undefined,
    commandArgs: step.type === "command" ? argumentList(step.action.args) : [],
    sendResult: step.sendResult ?? false,
    required: step.required !== false,
    completeOnSuccess: step.completeOnSuccess ?? false,
    runAgent: step.type === "agent",
    resultKey: "resultKey" in step ? step.resultKey : undefined,
    includeState: step.includeState ?? [],
    maxResultBytes: step.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES,
    stateRequired: step.stateRequired !== false,
    captureResult: Boolean(commandSink),
    resultSource: step.type === "agent" && step.result?.source === "agent" ? "agent" : undefined,
    resultCommand: commandSink?.command,
    resultCommandArgs: commandSink?.args ?? []
  }
}

function commandResultSink(step: EngineStep): Extract<ResultSinkDefinition, { type: "command" }> | undefined {
  const result = "result" in step ? step.result : undefined
  return result?.sinks.find((sink): sink is Extract<ResultSinkDefinition, { type: "command" }> => sink.type === "command")
}

function argumentList(value: unknown): unknown[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

interface BobWorkflowEngineRunnerOptions {
  definition: WorkflowDefinition
  coreWorkflow: CoreWorkflowDefinition
  actionRegistry: ActionRegistry
  resultSinks: (workspaceRoot: string) => ResultSinkRegistry
  runStore: (workspaceRoot: string) => RunStateStore
  taskSnapshotStore: (workspaceRoot: string) => TaskSnapshotStore | undefined
  preflightChecks: (workspaceRoot: string) => NonNullable<WorkflowEngineOptions["preflightChecks"]>
  agentProvider?: AgentProvider
  stepRuntime: StepRuntime
  inputsProvider: BobWorkflowRunnerInputCollector
}

class BobWorkflowEngineRunner {
  private readonly taskInputs = new WeakMap<object, Record<string, unknown>>()

  constructor(private readonly options: BobWorkflowEngineRunnerOptions) {}

  async runSingleWorkflowStep(task: BobWorkflowTask): Promise<boolean> {
    return this.runEngine(task, { executionMode: "full" })
  }

  async runTodoStep(todo: WorkflowTodoItem, index: number, task: BobWorkflowTask): Promise<boolean> {
    return this.runEngine(task, { executionMode: "singleStep", stepId: todo.id })
  }

  private async runEngine(task: BobWorkflowTask, request: { executionMode: "full" | "singleStep"; stepId?: string }): Promise<boolean> {
    const workspaceRoot = this.options.definition.workflowRoot
    if (!workspaceRoot) {
      await vscode.window.showErrorMessage("Bob workflow workspace root is not available.")
      return false
    }
    const inputs = await this.inputsForTask(task)
    if (!inputs) {
      await vscode.window.showErrorMessage("Bob workflow input failed: Workflow input was cancelled.")
      return false
    }
    const snapshotStore = this.options.taskSnapshotStore(workspaceRoot)
    const snapshotProvider = createBobTaskSnapshotProvider(task)
    const manuallyCompleted = new Set<string>()
    const messageStartIndexes = new Map<string, number>()
    const engine = new WorkflowEngine({
      actions: this.options.actionRegistry,
      resultSinks: this.options.resultSinks(workspaceRoot),
      runStore: this.options.runStore(workspaceRoot),
      agentProvider: this.createAgentProvider(task),
      preflightChecks: this.options.preflightChecks(workspaceRoot),
      hooks: this.createHooks(task, snapshotProvider, snapshotStore, manuallyCompleted, messageStartIndexes),
      manualCompletion: async ({ run, step }) => {
        const completed = await this.options.stepRuntime.hold(this.options.definition, { id: step.id, title: step.title }, task, {
          runId: run.runId,
          stepDefinition: this.options.definition.stepsById[step.id],
          actionRegistry: this.options.actionRegistry,
          inputs: run.inputs,
          state: run.state,
          messageStartIndex: messageStartIndexes.get(stepKey(run.runId, step.id))
        })
        if (completed) manuallyCompleted.add(stepKey(run.runId, step.id))
        return { completed }
      },
      recoverResultText: async ({ workflow, run, step }) => {
        const currentTaskText = extractLastAssistantText(task.getMessages?.() ?? [], 0)
        if (currentTaskText) return currentTaskText
        return snapshotStore ? recoverResultTextFromSnapshots(snapshotStore, workflow, run, step) : undefined
      }
    })
    try {
      const run = await engine.runWorkflow(this.options.coreWorkflow, inputs, {
        executionMode: request.executionMode,
        stepId: request.stepId
      })
      if (run.status === "failed") await vscode.window.showErrorMessage(`Bob workflow run failed: ${run.error ?? run.runId}`)
      return run.status === "completed" || run.status === "running"
    } catch (error) {
      await vscode.window.showErrorMessage(`Bob workflow execution failed: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  private async inputsForTask(task: BobWorkflowTask): Promise<Record<string, unknown> | undefined> {
    if (isObject(task)) {
      const existing = this.taskInputs.get(task)
      if (existing) return existing
    }
    const resolved = await this.options.inputsProvider(task, {})
    if (resolved && isObject(task)) this.taskInputs.set(task, resolved)
    return resolved
  }

  private createAgentProvider(task: BobWorkflowTask): AgentProvider | undefined {
    return {
      run: async (input) => {
        if (typeof task.startSubagent === "function") {
          const stepDefinition = this.options.definition.stepsById[input.stepId]
          const todoContext = this.todoContext(input.stepId)
          const value = await task.startSubagent(buildWorkflowAgentPrompt({
            workflowId: this.options.definition.id,
            workflowName: this.options.definition.name,
            workflowRoot: input.workflowRoot ?? this.options.definition.workflowRoot,
            workflowFile: input.workflowFile ?? this.options.definition.workflowFile,
            workflowFolderName: input.workflowFolderName ?? this.options.definition.workflowFolderName,
            stepIndex: todoContext.index,
            stepId: input.stepId,
            stepTitle: todoContext.todo?.text ?? stepDefinition?.id ?? input.stepId,
            stepPrompt: stepDefinition?.prompt ?? input.prompt,
            workflowInstructions: this.options.definition.promptWithoutTodo,
            stateEntries: stateEntriesFromRecord(input.state, stepDefinition?.includeState ?? [])
          }))
          const result = extractSubagentResult(value)
          if (!result) throw new Error("Bob subagent returned no result.")
          return result
        }
        if (this.options.agentProvider) return this.options.agentProvider.run(input)
        throw new Error("Bob startSubagent API is not available.")
      }
    }
  }

  private createHooks(
    task: BobWorkflowTask,
    snapshotProvider: TaskSnapshotProvider,
    snapshotStore: TaskSnapshotStore | undefined,
    manuallyCompleted: Set<string>,
    messageStartIndexes: Map<string, number>
  ): WorkflowExecutionHooks {
    const snapshot = async (
      reason: TaskSnapshotReason,
      input: { workflow: CoreWorkflowDefinition; run: WorkflowRunState; step?: EngineStep; agentText?: string; error?: string }
    ) => {
      if (!snapshotStore) return
      const payload = await Promise.resolve(snapshotProvider.exportTask({
        reason,
        workflow: input.workflow,
        run: input.run,
        step: input.step,
        lastAssistantText: input.agentText,
        handoff: input.error ? { resultCommand: resultCommandForStep(input.step), error: input.error } : undefined
      }))
      if (payload) await snapshotStore.saveSnapshot(payload)
    }
    return {
      onWorkflowStart: async ({ workflow, run }) => snapshot("workflow-start", { workflow, run }),
      onStepStart: async ({ workflow, run, step }) => {
        if (!step) return
        messageStartIndexes.set(stepKey(run.runId, step.id), getTaskMessageCount(task))
        const context = this.todoContext(step.id)
        const stepDefinition = this.options.definition.stepsById[step.id]
        const stateEntries = stateEntriesFromRecord(run.state, stepDefinition?.includeState ?? [])
        const message = context.todo
          ? buildStepMessage(this.options.definition, context.todo, context.index, stepDefinition, undefined, stateEntries)
          : buildWorkflowStartMessage(this.options.definition, undefined, 0, stepDefinition, undefined, stateEntries)
        if (message) await task.sendMessage?.(message, "user")
        await snapshot("step-start", { workflow, run, step })
      },
      onCommandResult: async ({ run, step, commandValue }) => {
        if (!step || step.type !== "command") return
        const context = this.todoContext(step.id)
        if (!context.todo) return
        const stepDefinition = this.options.definition.stepsById[step.id]
        const commandResult = { command: step.action.provider, ok: true, value: commandValue }
        const stateEntries = stateEntriesFromRecord(run.state, stepDefinition?.includeState ?? [])
        const message = shouldIncludeCommandResult(stepDefinition, commandResult) || stateEntries.length > 0
          ? buildCommandResultMessage(this.options.definition, context.todo, context.index, commandResult, stateEntries)
          : undefined
        if (message) await task.sendMessage?.(message, "user")
      },
      onAgentOutput: async ({ workflow, run, step, agentText }) => {
        if (agentText) await task.sendMessage?.(agentText, "assistant")
        await snapshot("agent-output", { workflow, run, step, agentText })
      },
      onHandoffFailed: async ({ workflow, run, step, agentText, error }) => snapshot("handoff-failed", { workflow, run, step, agentText, error }),
      onStepHeld: async ({ workflow, run, step, error }) => snapshot("held", { workflow, run, step, error }),
      onStepFailed: async ({ workflow, run, step, error }) => snapshot("failed", { workflow, run, step, error }),
      onStepCompleted: async ({ workflow, run, step }) => {
        if (step && !manuallyCompleted.has(stepKey(run.runId, step.id))) task.setStepComplete?.()
        await snapshot("completed", { workflow, run, step })
      },
      onWorkflowCompleted: async ({ workflow, run }) => snapshot("completed", { workflow, run })
    }
  }

  private todoContext(stepId: string): { todo?: WorkflowTodoItem; index: number } {
    const index = this.options.definition.todos.findIndex((todo) => todo.id === stepId)
    return { todo: index >= 0 ? this.options.definition.todos[index] : undefined, index: Math.max(0, index) }
  }
}

function createBobWorkflow(definition: WorkflowDefinition, runner: BobWorkflowEngineRunner): BobWorkflow {
  const steps = buildWorkflowSteps(definition, runner)
  return {
    hidden: definition.hidden,
    getId: () => definition.id,
    getLabel: () => definition.label,
    getMenuLabel: () => definition.menuLabel,
    getDescription: () => definition.description,
    getMode: () => definition.mode,
    isEnabled: async (env) => !definition.workspaceRequired || Boolean(env?.workspace),
    getSteps: () => steps,
    getApprovalConfig: () => ({ allowed_permissions: definition.permissions, autoApprovalEnabled: definition.autoApprovalEnabled })
  }
}

function buildWorkflowSteps(definition: WorkflowDefinition, runner: BobWorkflowEngineRunner): BobWorkflowStep[] {
  if (definition.todoEnabled && definition.todoAsSteps && definition.todos.length > 0) {
    return definition.todos.map((todo, index) => ({ id: todo.id, title: todo.text, execution: async (task) => runner.runTodoStep(todo, index, task) }))
  }
  return [{ id: "runWorkflow", title: definition.label, execution: async (task) => runner.runSingleWorkflowStep(task) }]
}

function extractTaskWorkflowInputs(definition: WorkflowDefinition, task: BobWorkflowTask): Record<string, unknown> {
  const inputs: Record<string, unknown> = {}
  const metadata = recordValue(task.getAllMetadata?.())
  mergeKnownWorkflowInputs(definition, inputs, metadata)
  mergeKnownWorkflowInputs(definition, inputs, recordValue(metadata.inputs))
  mergeKnownWorkflowInputs(definition, inputs, recordValue(metadata.workflowInputs))
  mergeKnownWorkflowInputs(definition, inputs, recordValue(metadata.meta))
  mergeKnownWorkflowInputs(definition, inputs, recordValue(recordValue(metadata.workflow).meta))
  for (const message of task.getMessages?.() ?? []) {
    const meta = recordValue(recordValue(message)._meta)
    const workflow = recordValue(meta.workflow)
    mergeKnownWorkflowInputs(definition, inputs, recordValue(workflow.meta))
    mergeKnownWorkflowInputs(definition, inputs, recordValue(workflow.inputs))
  }
  return inputs
}

function mergeKnownWorkflowInputs(definition: WorkflowDefinition, target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(definition.inputs)) {
    if (source[key] !== undefined) target[key] = source[key]
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function isObject(value: unknown): value is object {
  return Boolean(value && typeof value === "object")
}

function stepKey(runId: string, stepId: string): string {
  return `${runId}:${stepId}`
}

function stateEntriesFromRecord(state: Record<string, string>, keys: string[]): WorkflowStateEntry[] {
  return keys.flatMap((key) => state[key] === undefined ? [] : [{ key, value: state[key] }])
}

function resultCommandForStep(step: EngineStep | undefined): string | undefined {
  if (!step || !("result" in step)) return undefined
  return step.result?.sinks.find((sink): sink is Extract<ResultSinkDefinition, { type: "command" }> => sink.type === "command")?.command
}

async function recoverResultTextFromSnapshots(snapshotStore: TaskSnapshotStore, workflow: CoreWorkflowDefinition, run: WorkflowRunState, step: EngineStep): Promise<string | undefined> {
  const latest = await snapshotStore.loadLatest(run.runId)
  if (latest && snapshotMatchesRun(latest, workflow, run, step) && latest.lastAssistantText?.trim()) return latest.lastAssistantText
  const agentOutput = await snapshotStore.findLatestSnapshot(run.runId, (snapshot) => snapshot.reason === "agent-output" && snapshotMatchesRun(snapshot, workflow, run, step) && Boolean(snapshot.lastAssistantText?.trim()))
  return agentOutput?.lastAssistantText
}

function buildStepMessage(definition: WorkflowDefinition, todo: WorkflowTodoItem, index: number, stepDefinition?: WorkflowStepDefinition, commandResult?: WorkflowStepCommandResult, stateEntries: WorkflowStateEntry[] = []): string | undefined {
  if (index === 0) return buildWorkflowStartMessage(definition, todo, index, stepDefinition, commandResult, stateEntries)
  if (definition.stepMessage === "silent") return shouldIncludeCommandResult(stepDefinition, commandResult) || stateEntries.length > 0 ? buildCommandResultMessage(definition, todo, index, commandResult, stateEntries) : undefined
  if (definition.stepMessage === "full") return buildWorkflowTodoStepMessage(definition, todo, index, stepDefinition, commandResult, stateEntries)
  if (definition.stepMessage === "step") return buildStepPromptMessage(definition, todo, index, stepDefinition, commandResult, stateEntries) ?? buildCurrentTodoMessage(definition, todo, index, stepDefinition, commandResult, stateEntries)
  return buildCurrentTodoMessage(definition, todo, index, stepDefinition, commandResult, stateEntries)
}

function buildWorkflowStartMessage(definition: WorkflowDefinition, currentTodo?: WorkflowTodoItem, currentIndex = 0, stepDefinition?: WorkflowStepDefinition, commandResult?: WorkflowStepCommandResult, stateEntries: WorkflowStateEntry[] = []): string {
  const lines = ["You are starting the following Bob workflow.", "", "Workflow:", `- id: ${definition.id}`, `- name: ${definition.name}`, `- title: ${definition.label}`, `- mode: ${definition.mode}`, ""]
  appendWorkflowContext(lines, { workflowRoot: definition.workflowRoot, workflowFile: definition.workflowFile, workflowFolderName: definition.workflowFolderName, stateEntries })
  if (definition.todoEnabled) lines.push("First, create or update your Todo list using exactly the items below.", "Do not immediately mark them complete. Work through them one by one and only mark an item complete after the corresponding work is actually done.", "", "<workflow_todos>", ...definition.todos.map((todo) => `- [ ] ${todo.id}: ${todo.text}`), "</workflow_todos>", "")
  lines.push("Then follow the workflow instructions below.", "", "<workflow_instructions>", definition.promptWithoutTodo, "</workflow_instructions>")
  if (definition.stepMessage === "step" && currentTodo) {
    const stepBlock = buildStepPromptBlock(stepDefinition, currentTodo, currentIndex)
    if (stepBlock) lines.push("", "Current workflow step:", stepBlock)
  }
  appendCommandResult(lines, stepDefinition, commandResult)
  appendWorkflowState(lines, stateEntries)
  return lines.join("\n")
}

function buildCurrentTodoMessage(definition: WorkflowDefinition, todo: WorkflowTodoItem, index: number, stepDefinition?: WorkflowStepDefinition, commandResult?: WorkflowStepCommandResult, stateEntries: WorkflowStateEntry[] = []): string {
  const lines = ["Current workflow Todo item:", `<workflow_todo index=\"${index + 1}\" id=\"${todo.id}\">`, `- [ ] ${todo.id}: ${todo.text}`, "</workflow_todo>"]
  appendWorkflowContext(lines, { workflowRoot: definition.workflowRoot, workflowFile: definition.workflowFile, workflowFolderName: definition.workflowFolderName, stateEntries })
  appendCommandResult(lines, stepDefinition, commandResult)
  appendWorkflowState(lines, stateEntries)
  return lines.join("\n")
}

function buildCommandResultMessage(definition: WorkflowDefinition, todo: WorkflowTodoItem, index: number, commandResult?: WorkflowStepCommandResult, stateEntries: WorkflowStateEntry[] = []): string | undefined {
  const lines = ["Workflow step command result:", `<workflow_todo index=\"${index + 1}\" id=\"${todo.id}\">`, `- [ ] ${todo.id}: ${todo.text}`, "</workflow_todo>"]
  appendWorkflowContext(lines, { workflowRoot: definition.workflowRoot, workflowFile: definition.workflowFile, workflowFolderName: definition.workflowFolderName, stateEntries })
  if (commandResult) lines.push("", buildCommandResultBlock(commandResult))
  appendWorkflowState(lines, stateEntries)
  return lines.join("\n")
}

function buildStepPromptMessage(definition: WorkflowDefinition, todo: WorkflowTodoItem, index: number, stepDefinition?: WorkflowStepDefinition, commandResult?: WorkflowStepCommandResult, stateEntries: WorkflowStateEntry[] = []): string | undefined {
  const stepBlock = buildStepPromptBlock(stepDefinition, todo, index)
  if (!stepBlock) return undefined
  const lines = ["Continue the Bob workflow using the current Step instructions.", "", stepBlock]
  appendWorkflowContext(lines, { workflowRoot: definition.workflowRoot, workflowFile: definition.workflowFile, workflowFolderName: definition.workflowFolderName, stateEntries })
  appendCommandResult(lines, stepDefinition, commandResult)
  appendWorkflowState(lines, stateEntries)
  return lines.join("\n")
}

function buildStepPromptBlock(stepDefinition: WorkflowStepDefinition | undefined, todo: WorkflowTodoItem, index: number): string | undefined {
  const prompt = stepDefinition?.prompt.trim()
  if (!prompt) return undefined
  return [`<workflow_step index=\"${index + 1}\" id=\"${todo.id}\">`, `Title: ${todo.text}`, "", "<workflow_step_instructions>", prompt, "</workflow_step_instructions>", "</workflow_step>"].join("\n")
}

function buildWorkflowTodoStepMessage(definition: WorkflowDefinition, todo: WorkflowTodoItem, index: number, stepDefinition?: WorkflowStepDefinition, commandResult?: WorkflowStepCommandResult, stateEntries: WorkflowStateEntry[] = []): string {
  const lines = ["Continue the Bob workflow Todo list.", "", "Workflow:", `- id: ${definition.id}`, `- name: ${definition.name}`, `- title: ${definition.label}`, `- mode: ${definition.mode}`, "", "Current Todo item:", `<workflow_todo index=\"${index + 1}\" id=\"${todo.id}\">`, `- [ ] ${todo.id}: ${todo.text}`, "</workflow_todo>", "", "Work only on this Todo item now. Mark it complete only after the corresponding work is actually done."]
  appendWorkflowContext(lines, { workflowRoot: definition.workflowRoot, workflowFile: definition.workflowFile, workflowFolderName: definition.workflowFolderName, stateEntries })
  appendCommandResult(lines, stepDefinition, commandResult)
  appendWorkflowState(lines, stateEntries)
  return lines.join("\n")
}

function appendCommandResult(lines: string[], stepDefinition?: WorkflowStepDefinition, commandResult?: WorkflowStepCommandResult): void {
  if (shouldIncludeCommandResult(stepDefinition, commandResult) && commandResult) lines.push("", buildCommandResultBlock(commandResult, stepDefinition?.maxResultBytes))
}

function appendWorkflowState(lines: string[], stateEntries: WorkflowStateEntry[]): void {
  if (stateEntries.length === 0) return
  lines.push("", "<workflow_state>")
  for (const entry of stateEntries) {
    lines.push(`<state key=\"${escapeXmlAttribute(entry.key)}\">`, entry.value, "</state>", "")
  }
  if (lines[lines.length - 1] === "") lines.pop()
  lines.push("</workflow_state>")
}

function shouldIncludeCommandResult(stepDefinition?: WorkflowStepDefinition, commandResult?: WorkflowStepCommandResult): boolean {
  return Boolean(commandResult && (stepDefinition?.sendResult || !commandResult.ok))
}

function buildCommandResultBlock(commandResult: WorkflowStepCommandResult, maxBytes = DEFAULT_MAX_RESULT_BYTES): string {
  return [`<workflow_step_command_result command=\"${escapeXmlAttribute(commandResult.command)}\" ok=\"${commandResult.ok}\">`, commandResult.ok ? formatCommandResult(commandResult.value, maxBytes) : `ERROR: ${commandResult.error}`, "</workflow_step_command_result>"].join("\n")
}

function formatCommandResult(value: unknown, maxBytes = DEFAULT_MAX_RESULT_BYTES): string {
  let formatted: string
  if (value === undefined) formatted = "undefined"
  else if (typeof value === "string") formatted = value
  else {
    try { formatted = JSON.stringify(value, null, 2) } catch { formatted = String(value) }
  }
  return truncateText(formatted, maxBytes)
}

function truncateText(value: string, maxBytes: number): string {
  if (maxBytes <= 0 || Buffer.byteLength(value, "utf8") <= maxBytes) return value
  let output = value
  while (Buffer.byteLength(output, "utf8") > maxBytes && output.length > 0) output = output.slice(0, Math.max(0, output.length - 512))
  return `${output}\n... [truncated to ${maxBytes} bytes]`
}

function escapeXmlAttribute(value: string): string { return value.replace(/&/g, "&amp;").replace(/\"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;") }

async function loadBobApi(): Promise<{ found: boolean; active: boolean; activationError: string; exportsValue: unknown }> { const ext = vscode.extensions.getExtension<unknown>(BOB_EXTENSION_ID); let exportsValue: unknown; let activationError = "none"; if (ext) { try { exportsValue = ext.isActive ? ext.exports : await ext.activate() } catch (error) { activationError = error instanceof Error ? error.message : String(error) } } return { found: Boolean(ext), active: Boolean(ext?.isActive), activationError, exportsValue } }
async function runAttempt(label: string, run: () => unknown): Promise<{ label: string; ok: boolean; message: string; value?: unknown }> { try { const value = await Promise.resolve(run()); return { label, ok: value !== false, message: describeReturn(value), value } } catch (error) { return { label, ok: false, message: error instanceof Error ? error.message : String(error) } } }
function asSource(value: unknown): BobSourceLike | undefined { return typeof value === "object" && value !== null ? value as BobSourceLike : undefined }
function formatAttempt(attempt: { label: string; ok: boolean; message: string }): string { return `- ${attempt.ok ? "ok" : "fail"}: ${attempt.label} -> ${attempt.message}` }
function describeReturn(value: unknown): string { if (value === undefined) return "undefined"; if (value === null) return "null"; if (typeof value === "object") return `object(${Object.keys(value as Record<string, unknown>).slice(0, 20).join(",")})`; return String(value) }
async function showMarkdownReport(title: string, summary: string, lines: string[]): Promise<void> { const report = [`# ${title}`, "", summary, "", ...lines].join("\n"); const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: report }); await vscode.window.showTextDocument(doc, { preview: false }) }
