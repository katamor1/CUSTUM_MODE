import type {
  BobWorkflow,
  BobWorkflowStep,
  BobWorkflowTask,
  WorkflowDefinition,
  WorkflowTodoItem
} from "./bobWorkflowTypes"

export interface BobWorkflowStepRunner {
  runSingleWorkflowStep: (task: BobWorkflowTask) => Promise<boolean>
  runTodoStep: (todo: WorkflowTodoItem, index: number, task: BobWorkflowTask) => Promise<boolean>
}

export function createBobWorkflow(
  definition: WorkflowDefinition,
  runner: BobWorkflowStepRunner
): BobWorkflow {
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
    getApprovalConfig: () => ({
      allowed_permissions: definition.permissions,
      autoApprovalEnabled: definition.autoApprovalEnabled
    })
  }
}

function buildWorkflowSteps(
  definition: WorkflowDefinition,
  runner: BobWorkflowStepRunner
): BobWorkflowStep[] {
  if (definition.todoEnabled && definition.todoAsSteps && definition.todos.length > 0) {
    return definition.todos.map((todo, index) => ({
      id: todo.id,
      title: todo.text,
      execution: async (task) => runner.runTodoStep(todo, index, task)
    }))
  }
  return [{
    id: "runWorkflow",
    title: definition.label,
    execution: async (task) => runner.runSingleWorkflowStep(task)
  }]
}
