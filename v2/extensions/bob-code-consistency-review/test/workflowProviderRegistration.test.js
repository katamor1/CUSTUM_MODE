const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const extensionRoot = path.resolve(__dirname, "..")
const repoRoot = path.resolve(extensionRoot, "..", "..")

test("extension registers code consistency workflow providers with workflow-register", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"))
  const source = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8")

  assert.ok(packageJson.extensionDependencies.includes("local.workflow-register"))
  assert.ok(packageJson.activationEvents.includes("onStartupFinished"))
  assert.match(source, /const WORKFLOW_REGISTER_EXTENSION_ID = "local\.workflow-register"/)
  assert.match(source, /registerWorkflowProviders\(context\)\.catch/)
  assert.match(source, /id: "bobCodeConsistency\.preprocess"/)
  assert.match(source, /id: "bobCodeConsistency\.captureBobOutput"/)
  assert.match(source, /buildCaptureWorkflowOptions\(\{ args, inputs, state \}\)/)
  assert.match(source, /id: "bobCodeConsistency\.validateOutput"/)
  assert.match(source, /id: "bobCodeConsistency\.triage"/)
})

test("Bob workflow template uses command providers instead of manual CLI instructions", () => {
  const workflowPath = path.join(repoRoot, ".bob", "workflows", "code-consistency-review", "WORKFLOW.md")
  const workflow = fs.readFileSync(workflowPath, "utf8")

  assert.match(workflow, /^schemaVersion: workflow-register\/v1$/m)
  assert.match(workflow, /provider: bobCodeConsistency\.preprocess/)
  assert.match(workflow, /provider: bobCodeConsistency\.captureBobOutput/)
  assert.match(workflow, /provider: bobCodeConsistency\.validateOutput/)
  assert.match(workflow, /provider: bobCodeConsistency\.triage/)
  assert.doesNotMatch(workflow, /node dist\/src\/cli\/main\.js preprocess/)
  assert.doesNotMatch(workflow, /type: manual[\s\S]*?Generate \.bob-review\/review-package/)
})
