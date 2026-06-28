const assert = require("node:assert/strict")
const { test } = require("node:test")

test("input resolver handles requiredWhen", () => {
  const { resolveWorkflowInputsToPrompt, validateWorkflowInputs } = require("../out/core/inputResolver")
  const inputs = {
    mode: { type: "select", required: true, options: ["single", "range"] },
    revision: { type: "string", requiredWhen: "inputs.mode == 'single'" },
    base: { type: "string", requiredWhen: "inputs.mode != 'single'" }
  }
  const single = resolveWorkflowInputsToPrompt(inputs, { mode: "single" })
  const range = resolveWorkflowInputsToPrompt(inputs, { mode: "range" })
  assert.equal(single.find((item) => item.key === "revision").prompt, true)
  assert.equal(single.find((item) => item.key === "base").prompt, false)
  assert.equal(range.find((item) => item.key === "revision").prompt, false)
  assert.equal(range.find((item) => item.key === "base").prompt, true)
  assert.match(validateWorkflowInputs(inputs, { mode: "single" }).join("\n"), /revision/)
  assert.deepEqual(validateWorkflowInputs(inputs, { mode: "single", revision: "1" }), [])
})
