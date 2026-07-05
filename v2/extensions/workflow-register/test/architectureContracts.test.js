const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const { extensionRoot, repoPath } = require("./helpers/sourceReader")

test("workflow action contract docs describe workflow-register public API and execution inputs", () => {
  const contract = fs.readFileSync(repoPath("docs", "workflow-action-contracts-ja.md"), "utf8")

  for (const phrase of [
    "registerActionProvider",
    "registerAgentProvider",
    "registerResultSink",
    "runWorkflow",
    "runWorkflowStep",
    "runNextStep",
    "ActionExecutionInput",
    "AgentExecutionInput",
    "latestAssistantText",
    "resultText",
    "artifactText",
    "result sink",
    "失敗"
  ]) {
    assert.ok(contract.includes(phrase), `workflow action contract must document: ${phrase}`)
  }
})

test("artifact metadata contract docs define additive cross-extension metadata", () => {
  const contract = fs.readFileSync(repoPath("docs", "artifact-metadata-contract-ja.md"), "utf8")

  for (const phrase of [
    "artifact_metadata",
    ".artifact-metadata.json",
    "producer_extension",
    "producer_version",
    "workflow_run_id",
    "source_vcs",
    "source_revision",
    "input_hash",
    "contains_sensitive_context",
    "human_review_required",
    "破壊的 schema 変更ではない"
  ]) {
    assert.ok(contract.includes(phrase), `artifact metadata contract must document: ${phrase}`)
  }
})

test("workflow-register README is synchronized with the split runtime and task snapshot defaults", () => {
  const readme = fs.readFileSync(path.join(extensionRoot, "README.md"), "utf8")

  assert.match(readme, /src\/bobStepRuntime\.ts[\s\S]*StepRuntime/)
  assert.doesNotMatch(readme, /今後の分割候補は `StepRuntime`/)
  assert.match(readme, /workflowRegister\.taskSnapshots\.includeMessages`\s*\|\s*`false`/)
  assert.match(readme, /既定では Bob chat messages を含めません/)
})

test("workflow-register docs cover template customization studio and snapshot defaults", () => {
  const readme = fs.readFileSync(path.join(extensionRoot, "README.md"), "utf8")
  const basicDesign = fs.readFileSync(path.join(extensionRoot, "docs", "basic-design-ja.md"), "utf8")
  const detailedDesign = fs.readFileSync(path.join(extensionRoot, "docs", "detailed-design-ja.md"), "utf8")
  const unitTestSpec = fs.readFileSync(path.join(extensionRoot, "docs", "unit-test-spec-ja.md"), "utf8")
  const realMachineSpec = fs.readFileSync(path.join(extensionRoot, "docs", "real-machine-test-spec-ja.md"), "utf8")

  for (const [name, text] of [
    ["README", readme],
    ["basic design", basicDesign],
    ["detailed design", detailedDesign],
    ["unit test spec", unitTestSpec],
    ["real machine test spec", realMachineSpec]
  ]) {
    assert.match(text, /Template Customization Studio|テンプレートカスタマイズ Studio/, `${name} must document Template Customization Studio`)
  }

  assert.match(detailedDesign, /workflowRegister\.taskSnapshots\.includeMessages`\s*\|\s*`false`/)
  assert.match(unitTestSpec, /WR-UT-036[\s\S]*WR-UT-039/)
  assert.match(realMachineSpec, /WR-RT-036[\s\S]*bzr --no-aliases/)
})
