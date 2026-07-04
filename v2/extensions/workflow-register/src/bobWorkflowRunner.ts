import * as vscode from "vscode"
import { buildWorkflowAgentPrompt, extractSubagentResult } from "./agentStep"
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

export { createBobWorkflow } from "./bobWorkflowFactory"
export { extractTaskWorkflowInputs } from "./bobTaskInputs"
export { StepRuntime } from "./bobStepRuntime"
export { recoverResultTextFromSnapshots } from "./taskSnapshotRecovery"
import { recoverResultTextFromSnapshots } from "./taskSnapshotRecovery"

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
  onManualStepHeld?: (input: { workflow: CoreWorkflowDefinition; run: WorkflowRunState; step: EngineStep; active: ActiveStep }) => Promise<void> | void
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
      hooks: this.createHooks(
        task,
        snapshotProvider,
        snapshotStore,
        manuallyCompleted,
        messageStartIndexes
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
    try {
      const run = await engine.runWorkflow(this.options.coreWorkflow, inputs, {
        executionMode: request.executionMode,
        stepId: request.stepId,
        allowOutOfOrder: request.allowOutOfOrder
      })
      if (run.status === "failed") {
        await vscode.window.showErrorMessage(`Bob workflow run failed: ${run.error ?? run.runId}`)
      }
      return run.status === "completed" || run.status === "running" || run.status === "paused" || run.status === "reviewing" || run.status === "checkpoint"
    } catch (error) {
      await vscode.window.showErrorMessage(
        `Bob workflow execution failed: ${error instanceof Error ? error.message : String(error)}`
      )
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
    return {
      onWorkflowStart: async ({ workflow, run }) => snapshot("workflow-start", { workflow, run }),
      onStepStart: async ({ workflow, run, step }) => {
        if (!step) return
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
        await snapshot("held", { workflow, run, step, error })
      },
      onStepFailed: async ({ workflow, run, step, error }) => {
        await snapshot("failed", { workflow, run, step, error })
      },
      onStepCompleted: async ({ workflow, run, step }) => {
        if (step && !manuallyCompleted.has(stepKey(run.runId, step.id))) task.setStepComplete?.()
        await snapshot("completed", { workflow, run, step })
      },
      onStepReviewRequired: async ({ workflow, run, step }) => {
        if (step) await sendControlBlock(run, step)
        await snapshot("review-required", { workflow, run, step })
      },
      onRunPaused: async ({ workflow, run, step }) => {
        await task.sendMessage?.([
          "Workflow run paused.",
          "",
          `- runId: ${run.runId}`,
          `- currentStep: ${run.currentStep ?? "none"}`,
          "- pause mode: graceful; no in-flight AI response was force-cancelled."
        ].join("\n"), "user")
        await sendControlBlock(run, step, true)
        await snapshot("paused", { workflow, run, step })
      },
      onWorkflowCompleted: async ({ workflow, run }) => snapshot("completed", { workflow, run })
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

function stateEntriesFromRecord(state: Record<string, string>, keys: string[]): WorkflowStateEntry[] {
  return keys.flatMap((key) => state[key] === undefined ? [] : [{ key, value: state[key] }])
}

function resultCommandForStep(step: EngineStep | undefined): string | undefined {
  if (!step || !("result" in step)) return undefined
  return step.result?.sinks.find(
    (sink): sink is Extract<ResultSinkDefinition, { type: "command" }> => sink.type === "command"
  )?.command
}
