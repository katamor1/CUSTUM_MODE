const assert = require("node:assert/strict")
const { test } = require("node:test")
const {
  assertContributesCommand,
  readJson,
  readSourceSet,
  readRepoFile
} = require("./helpers/sourceReader")

test("extension registers code consistency workflow providers with workflow-register", () => {
  const packageJson = readJson("package.json")
  const source = readSourceSet(["extension.ts", "workflowProviderRegistration.ts"])

  assert.ok(packageJson.extensionDependencies.includes("local.workflow-register"))
  assert.ok(packageJson.activationEvents.includes("onStartupFinished"))
  assert.match(source, /const WORKFLOW_REGISTER_EXTENSION_ID = "local\.workflow-register"/)
  assert.match(source, /registerWorkflowProviders\(\{/)
  assert.match(source, /id: "bobCodeConsistency\.preprocess"/)
  assert.match(source, /id: "bobCodeConsistency\.captureBobOutput"/)
  assert.match(source, /buildCaptureWorkflowOptions\(\{ args, inputs, state \}\)/)
  assert.match(source, /mergeWorkflowOptions\("bobCodeConsistency\.preprocess", input\)/)
  assert.match(source, /WORKFLOW_COMMAND_ALLOWED_OPTIONS/)
  assert.match(source, /buildSafeWorkflowOptions\(\{/)
  assert.match(source, /allowedKeys: WORKFLOW_COMMAND_ALLOWED_OPTIONS\[commandId\] \?\? \[\]/)
  assert.match(source, /workflowContextOptions\(input\)/)
  assert.match(source, /buildApplyTraceabilityDraftOptions\(input\)/)
  assert.match(source, /input\.state\?\.traceabilityDraftJson/)
  assert.match(source, /return \{ \.\.\.options, text: draftText \}/)
  assert.match(source, /id: "bobCodeConsistency\.validateOutput"/)
  assert.match(source, /id: "bobCodeConsistency\.triage"/)
  assert.match(source, /id: "bobCodeConsistency\.prepareAiTraceabilityDraft"/)
  assert.match(source, /id: "bobCodeConsistency\.applyAiTraceabilityDraft"/)
  assert.match(source, /id: "bobCodeConsistency\.openTraceabilityPrep"/)
  assert.match(source, /id: "bobCodeConsistency\.validateTraceabilityCatalog"/)
  assert.match(source, /id: "bobCodeConsistency\.createReviewInputFromTraceability"/)
  for (const command of [
    "bobCodeConsistency.prepareAiTraceabilityDraft",
    "bobCodeConsistency.applyAiTraceabilityDraft",
    "bobCodeConsistency.openTraceabilityPrep",
    "bobCodeConsistency.validateTraceabilityCatalog",
    "bobCodeConsistency.createReviewInputFromTraceability"
  ]) {
    assertContributesCommand(packageJson, command)
  }
  assert.equal(packageJson.contributes.configuration.properties["bobCodeConsistency.traceabilityCatalogPath"].default, ".bob-trace/traceability-catalog.json")
  assert.equal(packageJson.contributes.configuration.properties["bobCodeConsistency.traceabilityGateReportPath"].default, ".bob-trace/gate-report.md")
  assert.match(packageJson.contributes.configuration.properties["bobCodeConsistency.textEncoding"].description, /Shift-JIS/)
})

test("code consistency provider accepts workflowRoot without first-folder fallback", () => {
  const source = readSourceSet(["extension.ts", "workflowProviderRegistration.ts", "workspaceResolver.ts"])

  assert.match(source, /workflowRoot\?: string/)
  assert.match(source, /bobRoot\?: string/)
  assert.match(source, /resolveBobWorkspaceRoot/)
  assert.doesNotMatch(source, /workspaceFolders\?\.\[0\]|workspaceFolders\?\[0\]/)
  assert.doesNotMatch(source, /function requireWorkspaceRoot/)
})

test("traceability apply command can recover draft JSON from linked workflow output files", () => {
  const source = readSourceSet(["traceabilityCommands.ts"])

  assert.match(source, /resolveTraceabilityDraftText/)
  assert.match(source, /extractTraceabilityDraftJsonPaths/)
  assert.match(source, /ai-draft\.json/)
  assert.match(source, /ai-draft-output\.json/)
  assert.match(source, /readTextFile/)
  assert.match(source, /resolveTraceabilityDraftPath/)
  assert.match(source, /resolveWorkspacePathStrict/)
})

test("Bob workflow template uses command providers instead of manual CLI instructions", () => {
  const workflow = readRepoFile(".bob", "workflows", "code-consistency-review", "WORKFLOW.md")

  assert.match(workflow, /^schemaVersion: workflow-register\/v1$/m)
  assert.match(workflow, /provider: bobCodeConsistency\.preprocess/)
  assert.match(workflow, /textEncoding:/)
  assert.match(workflow, /default: auto/)
  assert.match(workflow, /provider: bobCodeConsistency\.captureBobOutput/)
  assert.match(workflow, /provider: bobCodeConsistency\.validateOutput/)
  assert.match(workflow, /provider: bobCodeConsistency\.triage/)
  assert.match(workflow, /id: apply-traceability-draft[\s\S]*includeState:[\s\S]*- traceabilityDraftJson/)
  assert.match(workflow, /Markdown、説明文、mermaid、リンク、ファイル作成報告は禁止/)
  assert.doesNotMatch(workflow, /id: copy-traceability-draft-json/)
  assert.doesNotMatch(workflow, /clipboard/)
  assert.doesNotMatch(workflow, /node dist\/src\/cli\/main\.js preprocess/)
  assert.doesNotMatch(workflow, /type: manual[\s\S]*?Generate \.bob-review\/review-package/)
})
