const assert = require("node:assert/strict")
const { test } = require("node:test")

test("input collector prompts conditionally relevant inputs in order", async () => {
  const { collectWorkflowInputsWithResolver } = require("../out/core/inputCollector")
  const inputs = {
    mode: { type: "select", required: true, options: ["single", "range"] },
    revision: { type: "string", requiredWhen: "inputs.mode == 'single'" },
    base: { type: "string", requiredWhen: "inputs.mode != 'single'" },
    target: { type: "string", requiredWhen: "inputs.mode == 'range'" }
  }
  const prompted = []
  const resolved = await collectWorkflowInputsWithResolver({
    inputs,
    provided: {},
    prompt: async (key) => {
      prompted.push(key)
      if (key === "mode") return "range"
      if (key === "base") return "10"
      if (key === "target") return "20"
      return undefined
    }
  })

  assert.deepEqual(prompted, ["mode", "base", "target"])
  assert.deepEqual(resolved, { mode: "range", base: "10", target: "20" })
})

test("input collector cancels when required input is cancelled", async () => {
  const { collectWorkflowInputsWithResolver } = require("../out/core/inputCollector")
  const resolved = await collectWorkflowInputsWithResolver({
    inputs: { revision: { type: "string", required: true } },
    prompt: async () => undefined
  })

  assert.equal(resolved, undefined)
})
