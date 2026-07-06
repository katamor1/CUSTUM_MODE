import { buildWorkflowAgentPrompt, extractSubagentResult } from "./agentStep"
import type { BobWorkflowTask } from "./bobWorkflowTypes"
import type { AgentProvider, CoreWorkflowDefinition } from "./core/model"
import type { WorkflowStateEntry } from "./workflowPromptContext"

export class ReviewTaskRegistry {
  private readonly tasksByStep = new Map<string, BobWorkflowTask>()
  private readonly tasksByRun = new Map<string, BobWorkflowTask>()
  private readonly completedSteps = new Set<string>()

  register(runId: string | undefined, stepId: string | undefined, task: BobWorkflowTask): boolean {
    if (!runId || !stepId) return false
    if (typeof task.setStepComplete !== "function" && typeof task.startSubagent !== "function") return false
    const key = reviewTaskKey(runId, stepId)
    this.tasksByStep.set(key, task)
    this.tasksByRun.set(runId, task)
    this.completedSteps.delete(key)
    return true
  }

  complete(runId: string | undefined, stepId: string | undefined): boolean {
    if (!runId || !stepId) return false
    const key = reviewTaskKey(runId, stepId)
    if (this.completedSteps.has(key)) return false
    const task = this.tasksByStep.get(key) ?? this.tasksByRun.get(runId)
    this.tasksByStep.delete(key)
    if (typeof task?.setStepComplete !== "function") return false
    try {
      task.setStepComplete()
      this.completedSteps.add(key)
      return true
    } catch (error) {
      console.warn("Failed to mark Bob review task complete", error)
      return false
    }
  }

  agentProviderForRun(runId: string | undefined, workflow: CoreWorkflowDefinition): AgentProvider | undefined {
    const task = runId ? this.tasksByRun.get(runId) : undefined
    if (typeof task?.startSubagent !== "function") return undefined
    const startSubagent = task.startSubagent.bind(task)
    return {
      run: async (input) => {
        const stepIndex = workflow.engineSteps.findIndex((candidate) => candidate.id === input.stepId)
        const step = stepIndex >= 0 ? workflow.engineSteps[stepIndex] : undefined
        const value = await startSubagent(buildWorkflowAgentPrompt({
          workflowId: workflow.id,
          workflowName: workflow.name,
          workflowRoot: input.workflowRoot ?? workflow.workflowRoot,
          workflowFile: input.workflowFile ?? workflow.workflowFile,
          workflowFolderName: input.workflowFolderName ?? workflow.workflowFolderName,
          stepIndex: Math.max(0, stepIndex),
          stepId: input.stepId,
          stepTitle: step?.title ?? input.stepId,
          stepPrompt: step?.prompt ?? input.prompt,
          workflowInstructions: workflow.promptWithoutTodo,
          stateEntries: stateEntriesFromRecord(input.state, step?.includeState ?? [])
        }))
        const result = extractSubagentResult(value)
        if (!result) throw new Error("Bob subagent returned no result.")
        return result
      }
    }
  }
}

export const reviewTaskRegistry = new ReviewTaskRegistry()

function reviewTaskKey(runId: string, stepId: string): string {
  return `${runId}:${stepId}`
}

function stateEntriesFromRecord(state: Record<string, string>, keys: string[]): WorkflowStateEntry[] {
  return keys.flatMap((key) => state[key] === undefined ? [] : [{ key, value: state[key] }])
}
