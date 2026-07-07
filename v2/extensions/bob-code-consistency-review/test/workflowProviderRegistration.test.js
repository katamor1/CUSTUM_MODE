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
  assert.match(source, /id: "bobCodeConsistency\.captureAiTraceabilityDraft"/)
  assert.match(source, /id: "bobCodeConsistency\.applyAiTraceabilityDraft"/)
  assert.match(source, /id: "bobCodeConsistency\.openTraceabilityPrep"/)
  assert.match(source, /id: "bobCodeConsistency\.validateTraceabilityCatalog"/)
  assert.match(source, /id: "bobCodeConsistency\.createReviewInputFromTraceability"/)
  for (const command of [
    "bobCodeConsistency.prepareAiTraceabilityDraft",
    "bobCodeConsistency.captureAiTraceabilityDraft",
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

test("traceability apply command can recover and normalize draft JSON", () => {
  const source = readSourceSet(["traceabilityCommands.ts"])

  assert.match(source, /resolveTraceabilityDraftText/)
  assert.match(source, /extractTraceabilityDraftJsonPaths/)
  assert.match(source, /ai-draft\.json/)
  assert.match(source, /ai-draft-output\.json/)
  assert.match(source, /readTextFile/)
  assert.match(source, /resolveTraceabilityDraftPath/)
  assert.match(source, /resolveWorkspacePathStrict/)
  assert.match(source, /canonicalizeTraceabilityDraftText/)
  assert.match(source, /test_case: "test_spec"/)
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
  const collectStepStart = workflow.indexOf("  - id: collect-document-candidates")
  const generateStepStart = workflow.indexOf("  - id: generate-traceability-draft")
  const collectStep = workflow.slice(collectStepStart, generateStepStart)
  const validateDraftStepStart = workflow.indexOf("  - id: validate-traceability-draft")
  const applyStepStart = workflow.indexOf("  - id: apply-traceability-draft")
  const generateStep = workflow.slice(generateStepStart, validateDraftStepStart)
  const validateDraftStep = workflow.slice(validateDraftStepStart, applyStepStart)
  const applyStep = workflow.slice(applyStepStart, workflow.indexOf("  - id: approve-traceability-catalog"))
  const artifacts = workflow.slice(workflow.indexOf("artifacts:"), workflow.indexOf("completion:"))
  assert.match(workflow, /allowedCommands:[\s\S]*- vscode\.executeCommand/)
  assert.match(workflow, /allowedCommandIds:[\s\S]*- bobCodeConsistency\.prepareAiTraceabilityDraft/)
  assert.match(collectStep, /id: collect-document-candidates[\s\S]*provider: vscode\.executeCommand/)
  assert.match(collectStep, /args:[\s\S]*- bobCodeConsistency\.prepareAiTraceabilityDraft/)
  assert.match(collectStep, /aiTraceabilityDraftPromptPath: "\{\{inputs\.aiTraceabilityDraftPromptPath\}\}"/)
  assert.match(collectStep, /base: "\{\{inputs\.base\}\}"/)
  assert.match(collectStep, /docsRoot: "\{\{inputs\.docsRoot\}\}"/)
  assert.match(collectStep, /head: "\{\{inputs\.head\}\}"/)
  assert.match(collectStep, /textEncoding: "\{\{inputs\.textEncoding\}\}"/)
  assert.match(collectStep, /vcs: "\{\{inputs\.vcs\}\}"/)
  assert.match(collectStep, /vcsRoot: "\{\{inputs\.vcsRoot\}\}"/)
  assert.match(workflow, /allowedCommands:[\s\S]*- bobCodeConsistency\.captureAiTraceabilityDraft/)
  assert.match(generateStep, /id: generate-traceability-draft[\s\S]*type: agent/)
  assert.doesNotMatch(generateStep, /provider: bobCodeConsistency\.captureAiTraceabilityDraft/)
  assert.match(generateStep, /resultKey: traceabilityDraftJson/)
  assert.match(generateStep, /途中で切らず、必ず閉じた JSON object/)
  assert.match(generateStep, /test_case は無効/)
  assert.match(validateDraftStep, /id: validate-traceability-draft[\s\S]*provider: bobCodeConsistency\.captureAiTraceabilityDraft/)
  assert.match(validateDraftStep, /text: "\{\{state\.traceabilityDraftJson\}\}"/)
  assert.match(validateDraftStep, /resultKey: validatedTraceabilityDraftJson/)
  assert.match(applyStep, /text: "\{\{state\.validatedTraceabilityDraftJson\}\}"/)
  assert.match(applyStep, /includeState:[\s\S]*- validatedTraceabilityDraftJson/)
  assert.match(applyStep, /resultKey: traceabilityCatalogResult/)
  assert.doesNotMatch(artifacts, /id: traceabilityDraftPrompt/)
  assert.doesNotMatch(artifacts, /id: traceabilityCatalog/)
  assert.doesNotMatch(artifacts, /id: reviewInput/)
  assert.doesNotMatch(artifacts, /id: reviewPackage/)
  assert.match(workflow, /Markdown、説明文、mermaid、リンク、ファイル作成報告は禁止/)
  assert.doesNotMatch(workflow, /id: copy-traceability-draft-json/)
  assert.doesNotMatch(workflow, /clipboard/)
  assert.doesNotMatch(workflow, /type: manual[\s\S]*?Generate \.bob-review\/review-package/)
})
