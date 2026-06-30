const test = require("node:test")
const assert = require("node:assert/strict")

const { createAuthoringModelFromTemplate } = require("../out/core/workflowAuthoringDefaults")
const { serializeAuthoringModelToMarkdown } = require("../out/core/workflowAuthoringSerializer")
const { validateWorkflowText } = require("../out/core/workflowValidator")

function validateAuthoringModel(model) {
  const result = serializeAuthoringModelToMarkdown(model)
  const validation = validateWorkflowText({ sourceId: "workflow-register", filePath: result.filePath, text: result.markdown })
  return { result, validation }
}

test("serializes a simple-agent authoring model into a valid workflow", () => {
  const model = createAuthoringModelFromTemplate({
    name: "gui-sample",
    title: "GUI Sample",
    description: "GUI で作成したサンプル workflow を実行する。",
    template: "simple-agent"
  })
  const { result, validation } = validateAuthoringModel(model)
  assert.equal(result.name, "gui-sample")
  assert.match(result.markdown, /schemaVersion: workflow-register\/v1/)
  assert.match(result.markdown, /steps:/)
  assert.equal(validation.ok, true)
})

test("serializes an artifact-output authoring model with result handoff", () => {
  const model = createAuthoringModelFromTemplate({
    name: "gui-artifact",
    title: "GUI Artifact",
    description: "AI 結果を Markdown 成果物へ保存する。",
    template: "artifact-output"
  })
  const { result, validation } = validateAuthoringModel(model)
  assert.match(result.markdown, /artifacts:/)
  assert.match(result.markdown, /stateKey: analysisReport/)
  assert.equal(validation.ok, true)
})

test("serializes command-then-agent with a state handoff", () => {
  const model = createAuthoringModelFromTemplate({
    name: "gui-command-agent",
    title: "GUI Command Agent",
    description: "コマンド結果を AI step に渡す。",
    template: "command-then-agent"
  })
  const { result, validation } = validateAuthoringModel(model)
  assert.match(result.markdown, /provider: vscode\.executeCommand/)
  assert.match(result.markdown, /resultKey: collectedContext/)
  assert.match(result.markdown, /includeState:/)
  assert.equal(validation.ok, true)
})

test("serializes input-driven-agent with select options", () => {
  const model = createAuthoringModelFromTemplate({
    name: "gui-inputs",
    title: "GUI Inputs",
    description: "入力値を使って AI step を実行する。",
    template: "input-driven-agent"
  })
  const { result, validation } = validateAuthoringModel(model)
  assert.match(result.markdown, /outputStyle:/)
  assert.match(result.markdown, /type: select/)
  assert.match(result.markdown, /- concise/)
  assert.match(result.markdown, /- detailed/)
  assert.equal(validation.ok, true)
})

test("validator rejects includeState references without a matching resultKey", () => {
  const model = createAuthoringModelFromTemplate({
    name: "gui-invalid-state",
    title: "GUI Invalid State",
    description: "存在しない state 参照を検証する。",
    template: "simple-agent"
  })
  model.steps.push({
    id: "consume-missing-state",
    title: "Consume missing state",
    type: "agent",
    includeState: ["missingContext"],
    prompt: "Use the missing state."
  })

  const { validation } = validateAuthoringModel(model)
  assert.equal(validation.ok, false)
  assert.ok(validation.diagnostics.some((item) => item.severity === "error" && item.message.includes("includeState references unknown resultKey 'missingContext'")))
})

test("validator rejects select inputs without options", () => {
  const model = createAuthoringModelFromTemplate({
    name: "gui-invalid-select",
    title: "GUI Invalid Select",
    description: "select input の options 不足を検証する。",
    template: "simple-agent"
  })
  model.inputs.push({ id: "reviewMode", type: "select", title: "Review mode", required: true, options: [] })

  const { validation } = validateAuthoringModel(model)
  assert.equal(validation.ok, false)
  assert.ok(validation.diagnostics.some((item) => item.severity === "error" && item.message.includes("Input 'reviewMode' is select but has no options")))
})
