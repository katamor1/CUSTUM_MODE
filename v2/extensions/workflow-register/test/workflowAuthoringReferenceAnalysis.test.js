const test = require("node:test")
const assert = require("node:assert/strict")

const { createAuthoringModelFromTemplate } = require("../out/core/workflowAuthoringDefaults")
const { analyzeAuthoringReferences, analyzeStepMoveImpact, analyzeStepRemovalImpact, formatRemovalImpact } = require("../out/core/workflowAuthoringReferenceAnalysis")

test("reference analysis accepts a valid command-to-agent handoff", () => {
  const model = createAuthoringModelFromTemplate({
    name: "valid-handoff",
    title: "Valid Handoff",
    description: "コマンド結果を後続 AI step へ渡す。",
    template: "command-then-agent"
  })

  assert.deepEqual(analyzeAuthoringReferences(model), [])
})

test("reference analysis reports unknown includeState keys", () => {
  const model = createAuthoringModelFromTemplate({
    name: "missing-state",
    title: "Missing State",
    description: "存在しない state 参照を検出する。",
    template: "simple-agent"
  })
  model.steps[0].includeState = ["missingContext"]

  const issues = analyzeAuthoringReferences(model)
  assert.equal(issues.length, 1)
  assert.equal(issues[0].kind, "unknown-include-state")
  assert.equal(issues[0].stepId, "analyze")
})

test("reference analysis reports forward includeState after an unsafe move", () => {
  const model = createAuthoringModelFromTemplate({
    name: "move-breaks-state",
    title: "Move Breaks State",
    description: "並べ替えによる前方参照を検出する。",
    template: "command-then-agent"
  })

  const impact = analyzeStepMoveImpact(model, 0, 1)
  assert.ok(impact)
  assert.equal(impact.stepId, "collect-context")
  assert.ok(impact.issues.some((issue) => issue.kind === "forward-include-state" && issue.key === "collectedContext"))
})

test("removal impact reports includeState consumers and produced artifacts", () => {
  const model = createAuthoringModelFromTemplate({
    name: "removal-impact",
    title: "Removal Impact",
    description: "削除による参照影響を検出する。",
    template: "artifact-output"
  })

  const impact = analyzeStepRemovalImpact(model, 0)
  assert.ok(impact)
  assert.deepEqual(impact.resultKeys, ["analysisReport"])
  assert.deepEqual(impact.includeStateConsumers, [])

  model.steps.push({
    id: "summarize-again",
    title: "Summarize again",
    type: "agent",
    includeState: ["analysisReport"],
    prompt: "Summarize the report again."
  })
  const nextImpact = analyzeStepRemovalImpact(model, 0)
  assert.ok(nextImpact.includeStateConsumers.some((consumer) => consumer.stepId === "summarize-again" && consumer.key === "analysisReport"))
  assert.deepEqual(formatRemovalImpact(nextImpact).filter((line) => line.includes("analysisReport")).length > 0, true)
})

test("reference analysis reports unknown artifact producers", () => {
  const model = createAuthoringModelFromTemplate({
    name: "bad-artifact",
    title: "Bad Artifact",
    description: "存在しない producedBy を検出する。",
    template: "simple-agent"
  })
  model.artifacts.push({ id: "report", producedBy: "missing-step", path: ".bob/artifacts/report.md" })

  const issues = analyzeAuthoringReferences(model)
  assert.equal(issues.length, 1)
  assert.equal(issues[0].kind, "unknown-artifact-producer")
  assert.equal(issues[0].artifactId, "report")
})
