import * as vscode from "vscode"
import {
  BobWorkflowEngineRunner,
  extractTaskWorkflowInputs,
  recoverResultTextFromSnapshots
} from "./bobWorkflowRunner"
import { StepRuntime } from "./bobStepRuntime"
import type {
  BobWorkflowRunnerInputCollector,
  WorkflowDefinition
} from "./bobWorkflowTypes"
import type { ActionRegistry } from "./core/actionRegistry"
import { createCommandAgentProvider } from "./core/agentProvider"
import { WorkflowEngine } from "./core/engine"
import type { WorkflowEngineOptions } from "./core/engine"
import type { AgentProvider } from "./core/model"
import { createDefaultResultSinkRegistry, ResultSinkRegistry } from "./core/resultSinkRegistry"
import { FileRunStateStore, RunStateStore } from "./core/runStateStore"
import { FileTaskSnapshotStore, TaskSnapshotStore } from "./core/taskSnapshots"
import { findMarkerRoots, rootHasMarker } from "./core/workspaceRoots"

export interface TaskSnapshotSettings {
  enabled: boolean
  maxBytes: number
  maxPerRun: number
  includeMessages: boolean
  pruneOnSave: boolean
}

export interface WorkflowRuntimeFactoryOptions {
  engineVersion: string
  actionRegistry: ActionRegistry
  customResultSinks: Array<{ type: string; handler: Parameters<ResultSinkRegistry["register"]>[1] }>
  stepRuntime: StepRuntime
  agentProvider: () => AgentProvider | undefined
  inputsProvider: (workflow: WorkflowDefinition, provided: Record<string, unknown>) => ReturnType<BobWorkflowRunnerInputCollector>
}

export class WorkflowRuntimeFactory {
  constructor(private readonly options: WorkflowRuntimeFactoryOptions) {}

  createEngine(workspaceRoot: string): WorkflowEngine {
    const snapshotStore = this.createTaskSnapshotStore(workspaceRoot)
    return new WorkflowEngine({
      actions: this.options.actionRegistry,
      resultSinks: this.createResultSinks(workspaceRoot),
      runStore: this.createRunStore(workspaceRoot),
      agentProvider: this.options.agentProvider() ?? this.createCommandAgentProvider(),
      preflightChecks: this.createPreflightChecks(workspaceRoot),
      recoverResultText: snapshotStore
        ? (input) => recoverResultTextFromSnapshots(snapshotStore, input.workflow, input.run, input.step)
        : undefined
    })
  }

  createBobWorkflowRunner(workflow: WorkflowDefinition): BobWorkflowEngineRunner {
    return new BobWorkflowEngineRunner({
      definition: workflow,
      coreWorkflow: workflow.core,
      actionRegistry: this.options.actionRegistry,
      resultSinks: (workspaceRoot) => this.createResultSinks(workspaceRoot),
      runStore: (workspaceRoot) => this.createRunStore(workspaceRoot),
      taskSnapshotStore: (workspaceRoot) => this.createTaskSnapshotStore(workspaceRoot),
      preflightChecks: (workspaceRoot) => this.createPreflightChecks(workspaceRoot),
      agentProvider: this.options.agentProvider() ?? this.createCommandAgentProvider(),
      stepRuntime: this.options.stepRuntime,
      inputsProvider: (task, provided) => this.options.inputsProvider(workflow, {
        ...extractTaskWorkflowInputs(workflow, task),
        ...provided
      })
    })
  }

  createRunStore(workspaceRoot: string): RunStateStore {
    return new FileRunStateStore({ workspaceRoot, engineVersion: this.options.engineVersion })
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
    for (const sink of this.options.customResultSinks) registry.register(sink.type, sink.handler)
    return registry
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
}
