import type { BobWorkflowTask } from "./bobWorkflowTypes"

export class ReviewTaskRegistry {
  private readonly tasksByStep = new Map<string, BobWorkflowTask>()
  private readonly tasksByRun = new Map<string, BobWorkflowTask>()
  private readonly completedSteps = new Set<string>()

  register(runId: string | undefined, stepId: string | undefined, task: BobWorkflowTask): boolean {
    if (!runId || !stepId || typeof task.setStepComplete !== "function") return false
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
}

export const reviewTaskRegistry = new ReviewTaskRegistry()

function reviewTaskKey(runId: string, stepId: string): string {
  return `${runId}:${stepId}`
}
