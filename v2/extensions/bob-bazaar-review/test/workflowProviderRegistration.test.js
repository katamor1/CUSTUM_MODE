const assert = require("node:assert/strict")
const { test } = require("node:test")
const {
  readExtensionFile,
  readJson,
  readSourceSet
} = require("./helpers/sourceReader")

test("Bazaar companion extension has no required companion extension dependency", () => {
  const packageJson = readJson("package.json")
  const source = readSourceSet(["extension.ts", "workflowRegisterBridge.ts"])
  const extensionDependencies = packageJson.extensionDependencies ?? []

  assert.ok(!extensionDependencies.includes("IBM.bob-code"))
  assert.ok(!extensionDependencies.includes("local.workflow-register"))
  assert.ok(packageJson.activationEvents.includes("onStartupFinished"))
  assert.match(source, /const WORKFLOW_REGISTER_EXTENSION_ID = "local\.workflow-register"/)
  assert.match(source, /registerWorkflowProviders\(context\)\.catch/)
  assert.match(source, /id: "bobBazaar\.openReviewGui"/)
  assert.match(source, /initialTargetFromWorkflowInputs\(input\.inputs, input\)/)
  assert.match(source, /id: "bobBazaar\.collectReviewContext"/)
  assert.match(source, /id: "bobBazaar\.loadReviewRules"/)
  assert.match(source, /execute: \(input\) => loadReviewRules\(input\)/)
  assert.match(source, /id: "bobBazaar\.captureReviewResult"/)
  assert.match(source, /execute: \(input\) => captureReviewResult\(firstStringArg\(input\.args\), captureOptionsFromCommandArgs\(\[input\]\)\)/)
})

test("Bazaar capture command accepts workflow context appended by result sinks", () => {
  const source = readSourceSet(["extension.ts", "workflowRegisterBridge.ts"])

  assert.match(source, new RegExp([
    "registerCommand\\(",
    "\"bobBazaar\\.captureReviewResult\"",
    "captureReviewResult\\(inputText, captureOptionsFromCommandArgs\\(args\\)\\)"
  ].join("[\\s\\S]*")))
  assert.match(source, /export function captureOptionsFromCommandArgs\(args: unknown\[\]\): CaptureReviewResultOptions/)
  assert.match(source, /const workflowState = recordStringMap\(context\.state\)/)
  assert.match(source, /expectedChecklistItems: expectedChecklistItemsFromState\(workflowState\)/)
  assert.match(source, /workspaceRoot: stringInput\(context\.workflowRoot\)/)
})

test("Bazaar workflow template starts review target selection from the GUI by default", () => {
  const workflow = readExtensionFile("templates", ".bob", "workflows", "bazaar-project-rule-review", "WORKFLOW.md")

  assert.match(workflow, /revisionMode:[\s\S]*?prompt: false/)
  assert.match(workflow, /revision:[\s\S]*?prompt: false/)
  assert.match(workflow, /baseRevision:[\s\S]*?prompt: false/)
  assert.match(workflow, /targetRevision:[\s\S]*?prompt: false/)
  assert.doesNotMatch(workflow, /requiredWhen:/)
})

test("Bazaar workflow template declares the providers owned by this extension", () => {
  const workflow = readExtensionFile("templates", ".bob", "workflows", "bazaar-project-rule-review", "WORKFLOW.md")

  assert.match(workflow, /^stepCompletion: manual$/m)
  assert.match(workflow, /^stepMessage: step$/m)
  assert.doesNotMatch(workflow, /```workflow-step/)
  assert.doesNotMatch(workflow, /^## Step:/m)
  assert.match(workflow, /^steps:$/m)
  assertWorkflowProvider(workflow, "review-input", "openReviewGui", "false", undefined, "false")
  assertWorkflowProvider(workflow, "collect-context", "collectReviewContext", "true", "true", "true")
  assertWorkflowProvider(workflow, "load-rules", "loadReviewRules", "true", "true", "true")
})

function assertWorkflowProvider(workflow, stepId, provider, sendResult, required, completeOnSuccess) {
  const parts = [
    `id: ${stepId}`,
    `provider: bobBazaar\\.${provider}`,
    `sendResult: ${sendResult}`
  ]
  if (required !== undefined) parts.push(`required: ${required}`)
  parts.push(`completeOnSuccess: ${completeOnSuccess}`)
  assert.match(workflow, new RegExp(parts.join("[\\s\\S]*?")))
}
