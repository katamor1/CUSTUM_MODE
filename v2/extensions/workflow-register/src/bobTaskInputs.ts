import type {
  BobWorkflowTask,
  WorkflowDefinition
} from "./bobWorkflowTypes"

export function extractTaskWorkflowInputs(
  definition: WorkflowDefinition,
  task: BobWorkflowTask
): Record<string, unknown> {
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

function mergeKnownWorkflowInputs(
  definition: WorkflowDefinition,
  target: Record<string, unknown>,
  source: Record<string, unknown>
): void {
  for (const key of Object.keys(definition.inputs)) {
    if (source[key] !== undefined) target[key] = source[key]
  }
}

export function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function isObject(value: unknown): value is object {
  return Boolean(value && typeof value === "object")
}
