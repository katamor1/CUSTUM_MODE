const test = require("node:test")
const assert = require("node:assert/strict")

const { createAuthoringModelFromTemplate } = require("../out/core/workflowAuthoringDefaults")
const { applyStepDraftReferenceRepair } = require("../out/core/workflowAuthoringStepDraftRepair")
const { validateStepDraft, formatStepDraftValidationSummary } = require("../out/core/workflowAuthoringStepDraftValidation")

test("step draft validation blocks command step without provider", () => {
  const model = createAuthoringModelFromTemplate({
    name: "bad-command",
    title: "Bad Command",
    description: "command provider の欠落を検出する。",
    template: "command-then-agent"
  })
  const draftStep = { ...model.steps[0], action: { provider: "", args: ["example.command"] } }

  const result = validateStepDraft({ model, originalStep: model.steps[0], draftStep, stepIndex: 0 })

  assert.equal(result.status, "error")
  assert.ok(result.diagnostics.some((item) => item.code === "command.provider.required"))
})

test("step draft validation warns when command sends an unbounded result", () => {
  const model = createAuthoringModelFromTemplate({
    name: "command-warning",
    title: "Command Warning",
    description: "sendResult と maxResultBytes の組み合わせを確認する。",
    template: "command-then-agent"
  })
  const draftStep = { ...model.steps[0], sendResult: true, maxResultBytes: undefined }

  const result = validateStepDraft({ model, originalStep: model.steps[0], draftStep, stepIndex: 0 })

  assert.equal(result.status, "warning")
  assert.ok(result.diagnostics.some((item) => item.code === "command.sendResult.withoutMaxResultBytes"))
  assert.match(formatStepDraftValidationSummary(result), /warning/)
})

test("step draft validation blocks stateRequired without includeState", () => {
  const model = createAuthoringModelFromTemplate({
    name: "state-required",
    title: "State Required",
    description: "stateRequired と includeState の整合を確認する。",
    template: "simple-agent"
  })
  const draftStep = { ...model.steps[0], stateRequired: true, includeState: [] }

  const result = validateStepDraft({ model, originalStep: model.steps[0], draftStep, stepIndex: 0 })

  assert.equal(result.status, "error")
  assert.ok(result.diagnostics.some((item) => item.code === "step.stateRequired.withoutIncludeState"))
})

test("manual step draft validation accepts userAction message without prompt", () => {
  const model = createAuthoringModelFromTemplate({
    name: "manual-user-action",
    title: "Manual User Action",
    description: "manual user action を検証する。",
    template: "manual-checklist"
  })
  const draftStep = {
    ...model.steps[0],
    prompt: undefined,
    userAction: { message: "Review the generated file.", completeLabel: "Reviewed" }
  }

  const result = validateStepDraft({ model, originalStep: model.steps[0], draftStep, stepIndex: 0 })

  assert.equal(result.status, "ok")
  assert.equal(result.diagnostics.some((item) => item.code === "manual.prompt.required"), false)
})

test("manual step draft validation warns about missing and risky userAction settings", () => {
  const model = createAuthoringModelFromTemplate({
    name: "manual-user-action-warnings",
    title: "Manual User Action Warnings",
    description: "manual user action の warning を検証する。",
    template: "manual-checklist"
  })
  const draftStep = {
    ...model.steps[0],
    prompt: "",
    userAction: {
      message: "Run command:workflowRegister.completeCurrentStep when done.",
      completeLabel: "This label is intentionally too long for a compact button",
      confirmOnComplete: true
    }
  }

  const result = validateStepDraft({ model, originalStep: model.steps[0], draftStep, stepIndex: 0 })

  assert.equal(result.status, "warning")
  assert.ok(result.diagnostics.some((item) => item.code === "manual.userAction.completeLabel.long"))
  assert.ok(result.diagnostics.some((item) => item.code === "manual.userAction.confirmMessage.default"))
  assert.ok(result.diagnostics.some((item) => item.code === "manual.userAction.commandUri.ignored"))
})

test("manual step draft validation warns when neither prompt nor userAction message exists", () => {
  const model = createAuthoringModelFromTemplate({
    name: "manual-user-action-missing",
    title: "Manual User Action Missing",
    description: "manual user action の欠落 warning を検証する。",
    template: "manual-checklist"
  })
  const draftStep = { ...model.steps[0], prompt: "", userAction: undefined }

  const result = validateStepDraft({ model, originalStep: model.steps[0], draftStep, stepIndex: 0 })

  assert.equal(result.status, "warning")
  assert.ok(result.diagnostics.some((item) => item.code === "manual.userAction.message.missing"))
})

test("step draft validation detects resultKey downstream impact", () => {
  const model = createAuthoringModelFromTemplate({
    name: "resultkey-impact",
    title: "ResultKey Impact",
    description: "resultKey 変更による後続影響を検出する。",
    template: "command-then-agent"
  })
  const draftStep = { ...model.steps[0], resultKey: "renamedContext" }

  const result = validateStepDraft({ model, originalStep: model.steps[0], draftStep, stepIndex: 0 })

  assert.equal(result.status, "error")
  assert.ok(result.affectedReferences.some((item) => item.code === "step.resultKey.change.breaksIncludeState"))
})

test("step draft validation rejects reserved workflow result keys", () => {
  const model = createAuthoringModelFromTemplate({
    name: "reserved-result-key",
    title: "Reserved Result Key",
    description: "内部予約 state key を GUI draft で拒否する。",
    template: "manual-checklist"
  })
  const draftStep = {
    ...model.steps[0],
    resultKey: "workflow.approval.collect",
    form: { resultKey: "workflow.review.form", fields: [] },
    approval: { resultKey: "workflow.branching.approval" }
  }

  const result = validateStepDraft({ model, originalStep: model.steps[0], draftStep, stepIndex: 0 })

  assert.equal(result.status, "error")
  assert.ok(result.diagnostics.some((item) => item.code === "step.resultKey.reserved"))
  assert.ok(result.diagnostics.some((item) => item.code === "manual.form.resultKey.reserved"))
  assert.ok(result.diagnostics.some((item) => item.code === "manual.approval.resultKey.reserved"))
})

test("step draft validation detects artifact producer impact", () => {
  const model = createAuthoringModelFromTemplate({
    name: "artifact-impact",
    title: "Artifact Impact",
    description: "step id 変更による artifact producedBy 影響を検出する。",
    template: "artifact-output"
  })
  const draftStep = { ...model.steps[1], id: "write-report-renamed" }

  const result = validateStepDraft({ model, originalStep: model.steps[1], draftStep, stepIndex: 1 })

  assert.equal(result.status, "error")
  assert.ok(result.affectedReferences.some((item) => item.code === "step.id.change.breaksArtifact"))
})

test("step draft repair updates artifact producers when step id changes", () => {
  const model = createAuthoringModelFromTemplate({
    name: "repair-artifact",
    title: "Repair Artifact",
    description: "step id 変更時に producedBy を更新する。",
    template: "artifact-output"
  })
  const draftStep = { ...model.steps[1], id: "write-report-renamed" }

  const repaired = applyStepDraftReferenceRepair({ model, originalStep: model.steps[1], draftStep, stepIndex: 1 })

  assert.deepEqual(repaired.updatedArtifactIds, ["report"])
  assert.equal(repaired.model.artifacts[0].producedBy, "write-report-renamed")
  assert.equal(repaired.model.steps[1].id, "write-report-renamed")
})

test("step draft repair updates includeState and result stateKey when resultKey changes", () => {
  const model = createAuthoringModelFromTemplate({
    name: "repair-result-key",
    title: "Repair ResultKey",
    description: "resultKey 変更時に後続参照を更新する。",
    template: "command-then-agent"
  })
  model.steps.push({
    id: "write-context",
    title: "Write context",
    type: "result",
    result: { source: "state", stateKey: "collectedContext", sinks: [{ type: "file", path: ".bob/artifacts/context.md" }] }
  })
  const draftStep = { ...model.steps[0], resultKey: "renamedContext" }

  const repaired = applyStepDraftReferenceRepair({ model, originalStep: model.steps[0], draftStep, stepIndex: 0 })

  assert.deepEqual(repaired.updatedStepIds, ["analyze"])
  assert.deepEqual(repaired.updatedResultStateStepIds, ["write-context"])
  assert.deepEqual(repaired.model.steps[1].includeState, ["renamedContext"])
  assert.equal(repaired.model.steps[2].result.stateKey, "renamedContext")
})
