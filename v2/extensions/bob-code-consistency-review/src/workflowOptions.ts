export function buildCaptureWorkflowOptions(input: {
  args: unknown
  inputs: Record<string, unknown>
  state?: Record<string, string>
}): unknown {
  const options = mergeOptions(input.inputs, input.args)
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

function mergeOptions(inputs: Record<string, unknown>, args: unknown): Record<string, unknown> {
  return { ...inputs, ...optionRecord(args) }
}

function optionRecord(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return optionRecord(value[0])
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
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
