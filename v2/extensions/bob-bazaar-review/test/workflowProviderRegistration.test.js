const assert = require("node:assert/strict")
const { test } = require("node:test")
const {
  readExtensionFile,
  readJson,
  readSourceSet
} = require("./helpers/sourceReader")

test("Bazaar companion extension has no required companion extension dependency", () => {
  const packageJson = readJson("package.json")
  const source = readSourceSet(["extension.ts", "workflow/workflowRegisterBridge.ts", "workflow/workflowProviders.ts", "workflow/workflowActions.ts"])
  const extensionDependencies = packageJson.extensionDependencies ?? []

  assert.ok(!extensionDependencies.includes("IBM.bob-code"))
  assert.ok(!extensionDependencies.includes("local.workflow-register"))
  assert.ok(packageJson.activationEvents.includes("onStartupFinished"))
  assert.match(source, /const WORKFLOW_REGISTER_EXTENSION_ID = "local\.workflow-register"/)
  assert.match(source, /registerWorkflowProvidersWithRetry\(context\)/)
  assert.match(source, /id: "bobBazaar\.openReviewGui"/)
  assert.match(source, /initialTargetFromWorkflowInputs\(input\.inputs, input\)/)
  assert.match(source, /id: "bobBazaar\.collectReviewContext"/)
  assert.match(source, /execute: \(input\) => collectReviewContext\(input\)/)
  assert.match(source, /id: "bobBazaar\.loadReviewRules"/)
  assert.match(source, /execute: \(input\) => loadReviewRules\(input\)/)
  assert.match(source, /id: "bobBazaar\.captureReviewResult"/)
  assert.match(source, /execute: \(input\) => captureReviewResult\(firstStringArg\(input\.args\), captureOptionsFromCommandArgs\(\[input\]\)\)/)
})

test("Bazaar capture command accepts workflow context appended by result sinks", () => {
  const source = readSourceSet(["extension.ts", "workflow/workflowRegisterBridge.ts"])

  assert.match(source, new RegExp([
    "registerCommand\\(",
    "\"bobBazaar\\.captureReviewResult\"",
    "captureReviewResult\\(inputText, captureOptionsFromCommandArgs\\(args\\)\\)"
  ].join("[\\s\\S]*")))
  assert.match(source, /export function captureOptionsFromCommandArgs\(args: unknown\[\]\): CaptureReviewResultOptions/)
  assert.match(source, /const workflowState = recordStringMap\(context\.state\)/)
  assert.match(source, /expectedChecklistItems: expectedChecklistItemsFromState\(workflowState\)/)
  assert.match(source, /expectedRuleIds: expectedRuleIdsFromState\(workflowState\)/)
  assert.match(source, /reviewResultSchema: reviewResultSchemaFromState\(workflowState\)/)
  assert.match(source, /workspaceRoot: stringInput\(context\.workflowRoot\)/)
})

test("Bazaar workflow provider registration retries optional workflow-register integration", () => {
  const source = readSourceSet([
    "extension.ts",
    "workflow/workflowProviders.ts",
    "workflow/retryRegistrationController.ts"
  ])

  assert.match(source, /registerWorkflowProvidersWithRetry\(context\)/)
  assert.match(source, /WORKFLOW_PROVIDER_RETRY_DELAYS_MS/)
  assert.match(source, /vscode\.extensions\.onDidChange/)
  assert.match(source, /setTimeout\(/)
  assert.match(source, /timers\.delete\(timer\)/)
  assert.match(source, /providersRegistered/)
})

test("Bazaar provider retry lifecycle recovers restarts and disposes stale or late registrations", () => {
  const source = readSourceSet([
    "workflow/workflowProviders.ts",
    "workflow/retryRegistrationController.ts"
  ])

  assert.match(source, /let disposed = false/)
  assert.match(source, /let generation = 0/)
  assert.match(source, /let registeredApi: Api \| undefined/)
  assert.match(source, /let registrationAttempt: Promise<boolean> \| undefined/)
  assert.match(source, /let activeRegistrations: DisposableLike\[\] = \[\]/)
  assert.match(source, /const currentAttempt = performAttempt\(generation\)/)
  assert.match(source, /if \(disposed \|\| attemptGeneration !== generation\)/)
  assert.match(source, /disposeRegistrations\(result\.registrations\)/)
  assert.match(source, /if \(registrationAttempt === currentAttempt\) registrationAttempt = undefined/)
  assert.match(source, /currentApi === registeredApi/)
  assert.match(source, /disposeRegistrations\(activeRegistrations\)/)
  assert.doesNotMatch(source, /^let workflowProviderRegistrationAttempt/m)
})

test("Bazaar workflow providers declare ownership and register disposables", () => {
  const source = readSourceSet(["workflow/workflowRegisterBridge.ts", "workflow/workflowProviders.ts"])

  assert.match(source, /const BAZAAR_PROVIDER_SOURCE_ID = "local\.bob-bazaar-review"/)
  assert.match(source, /sourceId: BAZAAR_PROVIDER_SOURCE_ID/)
  assert.match(source, /const registrations: vscode\.Disposable\[\] = \[\]/)
  assert.match(source, /disposeRegistrations\(registrations\)/)
  assert.match(source, /context\.subscriptions\.push\(\.\.\.registrations\)/)
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

test("Bazaar load-rules workflow result exposes project rule ids and schema to result capture", () => {
  const source = readSourceSet(["workflow/workflowActions.ts"])

  assert.match(source, /ruleIds: string\[\]/)
  assert.match(source, /reviewResultSchema: unknown/)
  assert.match(source, /const ruleIds = checklist\.rules\.map\(\(rule\) => rule\.id\)/)
  assert.match(source, /ruleIds,/)
  assert.match(source, /reviewResultSchema: schema/)
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
