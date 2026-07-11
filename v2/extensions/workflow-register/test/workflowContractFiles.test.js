const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const { validateWorkflowText } = require("../out/core/workflowValidator")

const repoRoot = path.resolve(__dirname, "..", "..", "..")
const workflowSearchRoots = [
  ".bob/workflows",
  ".bob/template-library",
  "extensions/workflow-register/samples",
  "extensions/bob-bazaar-review/templates",
  "extensions/bob-code-consistency-review/templates",
  "docs/workflows"
]
const providerCatalogPath = "docs/workflows/action-provider-contracts.json"
const providerImplementationSourcePaths = [
  "extensions/workflow-register/src/core/actionRegistry.ts",
  "extensions/workflow-register/src/core/mechanicalChecks/actionProvider.ts",
  "extensions/bob-bazaar-review/src/workflow/workflowProviders.ts",
  "extensions/bob-code-consistency-review/src/workflowProviderRegistration.ts"
]
const packagePaths = [
  "extensions/workflow-register/package.json",
  "extensions/bob-bazaar-review/package.json",
  "extensions/bob-code-consistency-review/package.json"
]
const availablePreflightChecks = ["workspaceOpen", "bobWorkspaceInitialized", "bazaarRepository"]
const sampleExternalCommandAllowlist = new Map([
  [
    "extensions/workflow-register/samples/step-back-branching-approval/.bob/workflows/step-back-branching-approval/WORKFLOW.md",
    new Set(["example.preapprovalCheck"])
  ]
])

const integrationWorkflowPairs = [
  {
    templatePath: "extensions/bob-bazaar-review/templates/.bob/workflows/bazaar-project-rule-review/WORKFLOW.md",
    mirrorPath: ".bob/workflows/bazaar-project-rule-review/WORKFLOW.md"
  },
  {
    templatePath: "extensions/bob-code-consistency-review/templates/.bob/workflows/code-consistency-review/WORKFLOW.md",
    mirrorPath: ".bob/workflows/code-consistency-review/WORKFLOW.md"
  }
]

test("all repository workflow contracts are discovered and strict-clean", () => {
  const workflowPaths = discoverWorkflowPaths()
  const providerIds = readActionProviderCatalogIds()
  const commandIds = discoverContributedCommandIds()

  assert.ok(workflowPaths.length >= 21, `Expected at least 21 workflow contracts, found ${workflowPaths.length}`)
  assert.ok(workflowPaths.includes(".bob/workflows/process-coding-plan/WORKFLOW.md"))
  assert.ok(workflowPaths.includes(".bob/workflows/bazaar-project-rule-review/WORKFLOW.md"))
  assert.ok(workflowPaths.includes(".bob/workflows/code-consistency-review/WORKFLOW.md"))
  assert.ok(workflowPaths.includes(".bob/template-library/standard/process-code-precheck/WORKFLOW.md"))

  for (const relativePath of workflowPaths) {
    const text = readRepoFile(relativePath)
    const validation = validateStrictText(text, relativePath, providerIds)
    assert.equal(validation.ok, true, `${relativePath}\n${formatDiagnostics(validation)}`)
    assertNestedCommandContracts(relativePath, validation.workflow, commandIds)
  }
})

test("integration workflow templates match their workspace mirrors", () => {
  for (const { templatePath, mirrorPath } of integrationWorkflowPairs) {
    const templateText = readRepoFile(templatePath)
    const mirrorText = readRepoFile(mirrorPath)
    assert.equal(mirrorText, templateText, `${mirrorPath} must match ${templatePath}`)
  }
})

test("canonical provider catalog exactly matches extension registration sources", () => {
  const catalogIds = readActionProviderCatalogIds()
  const implementationIds = discoverImplementedActionProviderIds()

  assert.deepEqual(implementationIds, catalogIds)
  for (const expected of [
    "vscode.executeCommand",
    "workflowRegister.runMechanicalChecks",
    "bobBazaar.openReviewGui",
    "bobBazaar.collectReviewContext",
    "bobBazaar.loadReviewRules",
    "bobBazaar.captureReviewResult",
    "bobCodeConsistency.preprocess",
    "bobCodeConsistency.captureBobOutput",
    "bobCodeConsistency.validateOutput",
    "bobCodeConsistency.triage"
  ]) {
    assert.ok(catalogIds.includes(expected), `Missing action provider contract: ${expected}`)
  }
})

test("provider catalog has stable owners, unique ids, and no implicit implementation ids", () => {
  const catalog = readProviderCatalog()
  assert.deepEqual(Object.keys(catalog.providers).sort(), [
    "local.bob-bazaar-review",
    "local.bob-code-consistency-review",
    "local.workflow-register"
  ])

  const allIds = Object.values(catalog.providers).flat()
  assert.equal(new Set(allIds).size, allIds.length, "Action provider ids must be globally unique")
  for (const id of allIds) {
    assert.match(id, /^[A-Za-z0-9._-]+$/, `Invalid action provider id: ${id}`)
    assert.equal(id, id.trim(), `Action provider id has outer whitespace: ${id}`)
  }
})

test("sample external command allowlist is path-scoped and guardrail-declared", () => {
  const samplePath = "extensions/workflow-register/samples/step-back-branching-approval/.bob/workflows/step-back-branching-approval/WORKFLOW.md"
  const validation = validateStrictText(readRepoFile(samplePath), samplePath)
  assert.equal(validation.ok, true, formatDiagnostics(validation))
  const commandIds = discoverContributedCommandIds()

  assert.doesNotThrow(() => assertNestedCommandContracts(samplePath, validation.workflow, commandIds))
  assert.throws(
    () => assertNestedCommandContracts(".bob/workflows/production-copy/WORKFLOW.md", validation.workflow, commandIds),
    /uncontributed command 'example\.preapprovalCheck'/
  )
})

test("result step prompt and includeState are accepted as Bob runtime fields", () => {
  const validation = validateStrictText(`---
schemaVersion: workflow-register/v1
name: result-runtime-fields
description: Result runtime field validation.
stepMessage: step
steps:
  - id: collect
    title: Collect context
    type: command
    prompt: Collect the context.
    action:
      provider: sample.collect
    resultKey: context
  - id: save
    title: Save context
    type: result
    prompt: Save the collected context.
    includeState:
      - context
    result:
      source: state
      stateKey: context
      sinks:
        - type: file
          path: .bob/workflows/runs/{{run.id}}/context.json
---
# Result runtime fields
`, "test/fixtures/inline/WORKFLOW.md", ["sample.collect"])

  assert.equal(validation.ok, true, formatDiagnostics(validation))
  assert.equal(validation.workflow.engineSteps[1].prompt, "Save the collected context.")
  assert.deepEqual(validation.workflow.engineSteps[1].includeState, ["context"])
})

test("step messages allow result steps to use their result definition without a prompt", () => {
  const validation = validateStrictText(`---
schemaVersion: workflow-register/v1
name: result-step-without-prompt
description: Result step prompt fallback validation.
stepMessage: step
steps:
  - id: write
    title: Write result
    type: result
    result:
      source: literal
      text: done
      sinks:
        - type: file
          path: .bob/workflows/runs/{{run.id}}/done.txt
---
# Result step without prompt
`)

  assert.equal(validation.ok, true, formatDiagnostics(validation))
})

function discoverWorkflowPaths() {
  const result = new Set()
  for (const root of workflowSearchRoots) {
    const absoluteRoot = path.join(repoRoot, ...root.split("/"))
    if (!fs.existsSync(absoluteRoot)) continue
    walk(absoluteRoot, (filePath) => {
      if (path.basename(filePath) !== "WORKFLOW.md") return
      result.add(toRepoPath(filePath))
    })
  }
  return [...result].sort()
}

function readActionProviderCatalogIds() {
  const catalog = readProviderCatalog()
  return [...new Set(Object.values(catalog.providers).flat())].sort()
}

function readProviderCatalog() {
  const catalog = JSON.parse(readRepoFile(providerCatalogPath))
  assert.equal(catalog.schema_version, "bob-action-provider-contracts/v1")
  assert.ok(catalog.providers && typeof catalog.providers === "object" && !Array.isArray(catalog.providers))
  for (const [owner, ids] of Object.entries(catalog.providers)) {
    assert.match(owner, /^[A-Za-z0-9._-]+$/, `Invalid action provider owner: ${owner}`)
    assert.ok(Array.isArray(ids), `Provider catalog entry must be an array: ${owner}`)
    assert.ok(ids.every((id) => typeof id === "string"), `Provider catalog ids must be strings: ${owner}`)
  }
  return catalog
}

function discoverImplementedActionProviderIds() {
  const result = new Set()
  for (const relativePath of providerImplementationSourcePaths) {
    const source = readRepoFile(relativePath)
    for (const match of source.matchAll(/\bid:\s*"([A-Za-z0-9._-]+)"/g)) result.add(match[1])
    for (const match of source.matchAll(/\b[A-Z0-9_]*ACTION_PROVIDER_ID\s*=\s*"([A-Za-z0-9._-]+)"/g)) {
      result.add(match[1])
    }
  }
  return [...result].sort()
}

function discoverContributedCommandIds() {
  const result = new Set()
  for (const relativePath of packagePaths) {
    const packageJson = JSON.parse(readRepoFile(relativePath))
    for (const item of packageJson.contributes?.commands ?? []) {
      if (typeof item.command === "string" && item.command.trim()) result.add(item.command.trim())
    }
  }
  return result
}

function assertNestedCommandContracts(relativePath, workflow, commandIds) {
  for (const step of workflow.engineSteps) {
    if (step.type !== "command" || step.action.provider !== "vscode.executeCommand") continue
    const args = step.action.args
    const commandId = Array.isArray(args) ? args[0] : undefined
    assert.equal(typeof commandId, "string", `${relativePath}: step '${step.id}' must pass a command id as vscode.executeCommand args[0]`)
    assert.ok(
      commandIds.has(commandId) || isDeclaredSampleExternalCommand(relativePath, workflow, commandId),
      `${relativePath}: step '${step.id}' references uncontributed command '${commandId}'`
    )
  }

  for (const commandId of workflow.guardrails?.allowedCommandIds ?? []) {
    assert.ok(
      commandIds.has(commandId) || isDeclaredSampleExternalCommand(relativePath, workflow, commandId),
      `${relativePath}: guardrails allow uncontributed command '${commandId}'`
    )
  }
}

function isDeclaredSampleExternalCommand(relativePath, workflow, commandId) {
  if (typeof commandId !== "string") return false
  const allowedCommands = sampleExternalCommandAllowlist.get(relativePath)
  return allowedCommands?.has(commandId) === true &&
    (workflow.guardrails?.allowedCommandIds ?? []).includes(commandId)
}

function validateStrictText(text, filePath = "test/fixtures/inline/WORKFLOW.md", providerIds = readActionProviderCatalogIds()) {
  return validateWorkflowText({
    sourceId: "workflow-register",
    filePath,
    text,
    strict: true,
    availableActionProviders: providerIds,
    availablePreflightChecks
  })
}

function formatDiagnostics(validation) {
  return validation.diagnostics.map((item) => `${item.severity}: ${item.message}`).join("\n")
}

function walk(directory, visit) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if ([".git", "node_modules", "out", "dist"].includes(entry.name)) continue
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(filePath, visit)
    else if (entry.isFile()) visit(filePath)
  }
}

function toRepoPath(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/")
}

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, ...relativePath.split("/")), "utf8")
}
