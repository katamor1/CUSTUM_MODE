import * as vscode from "vscode"
import { buildWorkflowAgentExecutionPrompt, extractSubagentResult } from "./agentStep"
import type {
  BobWorkflowRunnerInputCollector,
  BobWorkflowTask,
  ActiveStep,
  WorkflowDefinition,
  WorkflowStateEntry,
  WorkflowTodoItem
} from "./bobWorkflowTypes"
import {
  buildCommandResultMessage,
  buildStepMessage,
  buildWorkflowControlBlock,
  buildWorkflowStartMessage,
  shouldIncludeCommandResult
} from "./bobWorkflowMessages"
import { bobTaskSyncRegistry } from "./bobTaskSync"
import { isObject } from "./bobTaskInputs"
import { getTaskMessageCount, StepRuntime } from "./bobStepRuntime"
import type { ActionRegistry } from "./core/actionRegistry"
import { WorkflowEngine } from "./core/engine"
import type { WorkflowEngineOptions, WorkflowExecutionHooks } from "./core/engine"
import type {
  AgentProvider,
  CoreWorkflowDefinition,
  EngineStep,
  ResultSinkDefinition,
  WorkflowRunState
} from "./core/model"
import type { ResultSinkRegistry } from "./core/resultSinkRegistry"
import type { RunStateStore } from "./core/runStateStore"
import {
  createBobTaskSnapshotProvider
} from "./core/taskSnapshots"
import type {
  TaskSnapshotProvider,
  TaskSnapshotReason,
  TaskSnapshotStore
} from "./core/taskSnapshots"
import { extractLastAssistantText } from "./resultHandoff"
import { reviewTaskRegistry } from "./reviewTaskRegistry"
import { resolveWorkspaceRootIdentity } from "./workspaceRootIdentity"

export { createBobWorkflow } from "./bobWorkflowFactory"
export { extractTaskWorkflowInputs } from "./bobTaskInputs"
export { StepRuntime } from "./bobStepRuntime"
export { recoverResultTextFromSnapshots } from "./taskSnapshotRecovery"
import { recoverResultTextFromSnapshots } from "./taskSnapshotRecovery"
import type { BobWorkflowGateRegistry } from "./bobWorkflowGateRegistry"

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
  gateRegistry: BobWorkflowGateRegistry
  onManualStepHeld?: (input: { workflow: CoreWorkflowDefinition; run: WorkflowRunState; step: EngineStep; active: ActiveStep }) => Promise<void> | void
}

interface BobGateWait {
  promise?: Promise<boolean>
  runId?: string
  stepId?: string
  ownerStepId?: string
  status?: WorkflowRunState["status"]
}

export class BobWorkflowEngineRunner {
  private readonly taskInputs = new WeakMap<object, Record<string, unknown>>()

  constructor(private readonly options: BobWorkflowEngineRunnerOptions) {}

  async runSingleWorkflowStep(task: BobWorkflowTask): Promise<boolean> {
    return this.runEngine(task, { executionMode: "full" })
  }

  async runTodoStep(todo: WorkflowTodoItem, index: number, task: BobWorkflowTask): Promise<boolean> {
    return this.runEngine(task, {
      executionMode: "singleStep",
      stepId: todo.id,
      allowOutOfOrder: this.options.definition.stepExecution.allowOutOfOrder
    })
  }

  async runEngineStep(stepId: string, index: number, task: BobWorkflowTask): Promise<boolean> {
    return this.runEngine(task, {
      executionMode: "singleStep",
      stepId,
      allowOutOfOrder: this.options.definition.stepExecution.allowOutOfOrder
    })
  }

  private async runEngine(
    task: BobWorkflowTask,
    request: { executionMode: "full" | "singleStep"; stepId?: string; allowOutOfOrder?: boolean }
  ): Promise<boolean> {
    const workspaceRoot = this.options.definition.workflowRoot
    if (!workspaceRoot) {
      await vscode.window.showErrorMessage("Bob workflow workspace root is not available.")
      return false
    }
    const registryWorkspaceRoot = resolveWorkspaceRootIdentity(workspaceRoot)
    const inputs = await this.inputsForTask(task)
    if (!inputs) {
      await vscode.window.showErrorMessage("Bob workflow input failed: Workflow input was cancelled.")
      return false
    }
    const snapshotStore = this.options.taskSnapshotStore(workspaceRoot)
    const snapshotProvider = createBobTaskSnapshotProvider(task)
    const runStore = this.options.runStore(workspaceRoot)
    const manuallyCompleted = new Set<string>()
    const messageStartIndexes = new Map<string, number>()
    const gateWait: BobGateWait = {}
    const engine = new WorkflowEngine({
      actions: this.options.actionRegistry,
      resultSinks: this.options.resultSinks(workspaceRoot),
      runStore,
      agentProvider: this.createAgentProvider(task),
      preflightChecks: this.options.preflightChecks(workspaceRoot),
      hooks: this.createHooks(
        task,
        snapshotProvider,
        snapshotStore,
        runStore,
        manuallyCompleted,
        messageStartIndexes,
        gateWait,
        registryWorkspaceRoot,
        request.stepId,
        request.executionMode
      ),
      manualCompletion: async ({ run, step }) => {
        const result = await this.options.stepRuntime.hold(
          this.options.definition,
          { id: step.id, title: step.title },
          task,
          {
            runId: run.runId,
            stepDefinition: this.options.definition.stepsById[step.id],
            coreStep: step,
            actionRegistry: this.options.actionRegistry,
            inputs: run.inputs,
            state: run.state,
            messageStartIndex: messageStartIndexes.get(stepKey(run.runId, step.id)),
            completeBobTask: request.executionMode !== "full",
            onHeldStep: (active) => this.options.onManualStepHeld?.({ workflow: this.options.coreWorkflow, run, step, active })
          }
        )
        if (result.completed) manuallyCompleted.add(stepKey(run.runId, step.id))
        return result
      },
      recoverResultText: async ({ workflow, run, step, reason }) => {
        if (reason === "retry-agent-result") return undefined
        const messageStartIndex = messageStartIndexes.get(stepKey(run.runId, step.id)) ?? 0
        const currentTaskText = extractLastAssistantText(task.getMessages?.() ?? [], messageStartIndex)
        if (currentTaskText) return currentTaskText
        return snapshotStore
          ? recoverResultTextFromSnapshots(snapshotStore, workflow, run, step)
          : undefined
      }
    })
    let run = await this.executeEngineOperation(
      () => engine.runWorkflow(this.options.coreWorkflow, inputs, {
        executionMode: request.executionMode,
        stepId: request.stepId,
        allowOutOfOrder: request.allowOutOfOrder
      }),
      gateWait,
      registryWorkspaceRoot
    )
    if (!run) return false

    if (request.executionMode === "full") {
      while (true) {
        if (run.status === "failed") {
          await vscode.window.showErrorMessage(`Bob workflow run failed: ${run.error ?? run.runId}`)
          return false
        }
        if (run.status === "completed") return true
        if (isBobHumanGate(run.status)) {
          if ((run.status === "reviewing" || run.status === "held") && run.error) {
            await vscode.window.showWarningMessage("ワークフローはユーザー操作待ちです。Operation Hub を開きました。")
          }
          if (!run.currentStep) throw new Error(`Gated workflow run has no current step: ${run.runId} (${run.status})`)
          const accepted = await (gateWait.promise ?? this.beginGateWait(
            gateWait,
            registryWorkspaceRoot,
            run,
            run.currentStep,
            run.currentStep,
            request.executionMode
          ))
          if (!accepted) return false

          const acceptedRun = await runStore.loadRun(run.runId)
          if (!acceptedRun) throw new Error(`Workflow run not found after gate acceptance: ${run.runId}`)
          this.resetGateWait(gateWait)
          run = acceptedRun
          continue
        }
        if (run.status === "running" && run.currentStep) {
          const resumed = await this.executeEngineOperation(
            () => engine.resumeRun(run!.runId, {
              workflow: this.options.coreWorkflow,
              executionMode: "full"
            }),
            gateWait,
            registryWorkspaceRoot
          )
          if (!resumed) return false
          run = resumed
          continue
        }

        await vscode.window.showErrorMessage(
          `Bob workflow run stopped before completion: ${run.runId} (${run.status}; currentStep=${run.currentStep ?? "none"})`
        )
        return false
      }
    }

    if (run.status === "failed") {
      await vscode.window.showErrorMessage(`Bob workflow run failed: ${run.error ?? run.runId}`)
    }
    if ((run.status === "reviewing" || run.status === "held") && run.error) {
      await vscode.window.showWarningMessage("ワークフローはユーザー操作待ちです。Operation Hub を開きました。")
    }
    if (isBobHumanGate(run.status)) {
      if (!run.currentStep) throw new Error(`Gated workflow run has no current step: ${run.runId} (${run.status})`)
      return gateWait.promise ?? this.beginGateWait(
        gateWait,
        registryWorkspaceRoot,
        run,
        run.currentStep,
        request.stepId ?? run.currentStep,
        request.executionMode
      )
    }
    return run.status === "completed" || run.status === "running"
  }

  private async executeEngineOperation(
    operation: () => Promise<WorkflowRunState>,
    gateWait: BobGateWait,
    registryWorkspaceRoot: string
  ): Promise<WorkflowRunState | undefined> {
    try {
      return await operation()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (gateWait.runId && (gateWait.ownerStepId || gateWait.stepId)) {
        this.options.gateRegistry.abort(registryWorkspaceRoot, gateWait.runId, gateWait.ownerStepId ?? gateWait.stepId!, message)
      }
      await vscode.window.showErrorMessage(`Bob workflow execution failed: ${message}`)
      return undefined
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
          const value = await task.startSubagent(buildWorkflowAgentExecutionPrompt({
            execution: input,
            workflowName: this.options.definition.name,
            workflowRoot: this.options.definition.workflowRoot,
            workflowFile: this.options.definition.workflowFile,
            workflowFolderName: this.options.definition.workflowFolderName,
            stepIndex: todoContext.index,
            stepTitle: todoContext.todo?.text ?? stepDefinition?.id ?? input.stepId,
            workflowInstructions: this.options.definition.promptWithoutTodo,
            includeState: stepDefinition?.includeState ?? []
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
    runStore: RunStateStore,
    manuallyCompleted: Set<string>,
    messageStartIndexes: Map<string, number>,
    gateWait: BobGateWait,
    registryWorkspaceRoot: string,
    ownerStepId: string | undefined,
    executionMode: "full" | "singleStep"
  ): WorkflowExecutionHooks {
    const snapshot = async (
      reason: TaskSnapshotReason,
      input: {
        workflow: CoreWorkflowDefinition
        run: WorkflowRunState
        step?: EngineStep
        agentText?: string
        error?: string
      }
    ) => {
      if (!snapshotStore) return
      const payload = await Promise.resolve(snapshotProvider.exportTask({
        reason,
        workflow: input.workflow,
        run: input.run,
        step: input.step,
        lastAssistantText: input.agentText,
        handoff: input.error
          ? { resultCommand: resultCommandForStep(input.step), error: input.error }
          : undefined
      }))
      if (payload) await snapshotStore.saveSnapshot(payload)
    }
    const sendControlBlock = async (run: WorkflowRunState, step?: EngineStep, includeResume = false) => {
      await task.sendMessage?.(buildWorkflowControlBlock({
        runId: run.runId,
        stepId: step?.id,
        status: run.status,
        currentStep: run.currentStep,
        includeResume
      }), "user")
    }
    const reconcileBobTodo = async (workflow: CoreWorkflowDefinition, run: WorkflowRunState, step: EngineStep | undefined, alreadyApplied: boolean) => {
      if (!step) return
      if (executionMode === "full") return
      const sync = await bobTaskSyncRegistry.reconcileRun(registryWorkspaceRoot, run, workflow, {
        reason: alreadyApplied ? "manual-completed" : "bob-runner-step-completed",
        task,
        alreadyApplied
      })
      if (sync.status !== "synced") console.warn(sync.message)
      await runStore.saveRun(run)
    }
    return {
      onWorkflowStart: async ({ workflow, run }) => snapshot("workflow-start", { workflow, run }),
      onStepStart: async ({ workflow, run, step }) => {
        if (!step) return
        bobTaskSyncRegistry.registerTask(registryWorkspaceRoot, run.runId, step.id, task)
        messageStartIndexes.set(stepKey(run.runId, step.id), getTaskMessageCount(task))
        const context = this.todoContext(step.id)
        const stepDefinition = this.options.definition.stepsById[step.id]
        const stateEntries = stateEntriesFromRecord(run.state, stepDefinition?.includeState ?? [])
        const message = context.todo
          ? buildStepMessage(
            this.options.definition,
            context.todo,
            context.index,
            stepDefinition,
            undefined,
            stateEntries
          )
          : buildWorkflowStartMessage(
            this.options.definition,
            undefined,
            0,
            stepDefinition,
            undefined,
            stateEntries
          )
        if (message) await task.sendMessage?.(message, "user")
        await sendControlBlock(run, step)
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
          ? buildCommandResultMessage(
            this.options.definition,
            context.todo,
            context.index,
            commandResult,
            stateEntries
          )
          : undefined
        if (message) await task.sendMessage?.(message, "user")
      },
      onAgentOutput: async ({ workflow, run, step, agentText }) => {
        if (agentText) await task.sendMessage?.(agentText, "assistant")
        await snapshot("agent-output", { workflow, run, step, agentText })
      },
      onHandoffFailed: async ({ workflow, run, step, agentText, error }) => {
        await snapshot("handoff-failed", { workflow, run, step, agentText, error })
      },
      onStepHeld: async ({ workflow, run, step, error }) => {
        if (step) {
          this.beginGateWait(gateWait, registryWorkspaceRoot, run, step.id, ownerStepId ?? step.id, executionMode)
          bobTaskSyncRegistry.registerTask(registryWorkspaceRoot, run.runId, step.id, task)
        }
        await this.openOperationHubForRun(run, step, "stepGate")
        await snapshot("held", { workflow, run, step, error })
      },
      onStepFailed: async ({ workflow, run, step, error }) => {
        await snapshot("failed", { workflow, run, step, error })
      },
      onStepCompleted: async ({ workflow, run, step }) => {
        await reconcileBobTodo(workflow, run, step, Boolean(step && manuallyCompleted.has(stepKey(run.runId, step.id))))
        await snapshot("completed", { workflow, run, step })
      },
      onStepReviewRequired: async ({ workflow, run, step }) => {
        if (step) {
          this.beginGateWait(gateWait, registryWorkspaceRoot, run, step.id, ownerStepId ?? step.id, executionMode)
          reviewTaskRegistry.register(registryWorkspaceRoot, run.runId, step.id, task)
          bobTaskSyncRegistry.registerTask(registryWorkspaceRoot, run.runId, step.id, task)
          await sendControlBlock(run, step)
        }
        await this.openOperationHubForRun(run, step, "stepGate")
        await snapshot("review-required", { workflow, run, step })
      },
      onRunPaused: async ({ workflow, run, step }) => {
        if (step) {
          const pauseOwnerStepId = ownerStepId
            ?? (executionMode === "full" ? latestCompletedStepId(run) : undefined)
            ?? step.id
          this.beginGateWait(gateWait, registryWorkspaceRoot, run, step.id, pauseOwnerStepId, executionMode)
          bobTaskSyncRegistry.registerTask(registryWorkspaceRoot, run.runId, step.id, task)
        }
        await task.sendMessage?.([
          "Workflow run paused.",
          "",
          `- runId: ${run.runId}`,
          `- currentStep: ${run.currentStep ?? "none"}`,
          "- pause mode: graceful; no in-flight AI response was force-cancelled."
        ].join("\n"), "user")
        await sendControlBlock(run, step, true)
        await this.openOperationHubForRun(run, step, "paused")
        await snapshot("paused", { workflow, run, step })
      },
      onWorkflowCompleted: async ({ workflow, run }) => snapshot("completed", { workflow, run })
    }
  }

  private beginGateWait(
    gateWait: BobGateWait,
    registryWorkspaceRoot: string,
    run: WorkflowRunState,
    stepId: string,
    ownerStepId: string,
    executionMode: "full" | "singleStep"
  ): Promise<boolean> {
    if (gateWait.promise) return gateWait.promise
    gateWait.runId = run.runId
    gateWait.stepId = stepId
    gateWait.ownerStepId = ownerStepId
    gateWait.status = run.status
    gateWait.promise = this.options.gateRegistry.waitForDecision({
      workspaceRoot: registryWorkspaceRoot,
      runId: run.runId,
      stepId,
      ownerStepId,
      status: run.status,
      executionMode
    })
    void gateWait.promise.catch(() => undefined)
    return gateWait.promise
  }

  private resetGateWait(gateWait: BobGateWait): void {
    delete gateWait.promise
    delete gateWait.runId
    delete gateWait.stepId
    delete gateWait.ownerStepId
    delete gateWait.status
  }

  private async openOperationHubForRun(run: WorkflowRunState, step: EngineStep | undefined, reason: "stepGate" | "paused"): Promise<void> {
    try {
      await vscode.commands.executeCommand("workflowRegister.openOperationHub", { runId: run.runId, stepId: step?.id, reason })
    } catch {
      await vscode.window.showWarningMessage("Operation Hub を自動表示できませんでした。Explorer から Bob Operation Hub を開いてください。")
    }
  }

  private todoContext(stepId: string): { todo?: WorkflowTodoItem; index: number } {
    const index = this.options.definition.todos.findIndex((todo) => todo.id === stepId)
    return {
      todo: index >= 0 ? this.options.definition.todos[index] : undefined,
      index: Math.max(0, index)
    }
  }
}

function stepKey(runId: string, stepId: string): string {
  return `${runId}:${stepId}`
}

function isBobHumanGate(status: WorkflowRunState["status"]): boolean {
  return status === "reviewing" || status === "held" || status === "checkpoint" || status === "paused"
}

function latestCompletedStepId(run: WorkflowRunState): string | undefined {
  return [...run.steps].reverse().find((step) => step.status === "completed")?.id
}

function stateEntriesFromRecord(state: Record<string, string>, keys: string[]): WorkflowStateEntry[] {
  return keys.flatMap((key) => state[key] === undefined ? [] : [{ key, value: state[key] }])
}

function resultCommandForStep(step: EngineStep | undefined): string | undefined {
  if (!step || !("result" in step)) return undefined
  return step.result?.sinks.find(
    (sink): sink is Extract<ResultSinkDefinition, { type: "command" }> => sink.type === "command"
  )?.command
}
