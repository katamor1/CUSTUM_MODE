import { buildSafeWorkflowOptions } from "./workflowUserOptions"

const CAPTURE_BOB_OUTPUT_WORKFLOW_KEYS = ["bobOutputPath", "reviewPackagePath", "packageDir", "text"] as const

export function buildCaptureWorkflowOptions(input: {
  args: unknown
  inputs: Record<string, unknown>
  state?: Record<string, string>
}): unknown {
  const options = buildSafeWorkflowOptions({
    commandId: "bobCodeConsistency.captureBobOutput",
    inputs: input.inputs,
    args: input.args,
    allowedKeys: CAPTURE_BOB_OUTPUT_WORKFLOW_KEYS
  })
  if (typeof options.text !== "string" || !options.text.trim()) {
    const argText = firstString(input.args)
    if (argText) options.text = argText
  }
  if (typeof options.text !== "string" || !options.text.trim()) {
    const stateText = input.state?.bobReviewResult
    if (stateText) options.text = stateText
  }
  return options
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item)
      if (found) return found
    }
  }
  return undefined
}
