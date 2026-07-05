const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")
const yaml = require("js-yaml")

const repoRoot = path.resolve(__dirname, "..", "..", "..")
const docsRoot = path.join(repoRoot, "docs", "workflows", "process-workflows")
const { validateProcessInput } = require("../out/process/processInputValidator")

test("process workflow docs expose UAT, rollout, metrics, and sandbox launcher assets", () => {
  const requiredFiles = [
    "README.md",
    "schema-contracts-ja.md",
    "rollout-guide-ja.md",
    "metrics/process-workflows-metrics-ja.md",
    "uat/process-workflows-uat-plan-ja.md",
    "integration/launch-process-workflows-sandbox.ps1",
    "examples/mini-process-sandbox/process-input.yaml"
  ]
  for (const relativePath of requiredFiles) {
    assert.equal(fs.existsSync(path.join(docsRoot, relativePath)), true, `${relativePath} exists`)
  }

  const launcher = fs.readFileSync(path.join(docsRoot, "integration", "launch-process-workflows-sandbox.ps1"), "utf8")
  assert.match(launcher, /process-workflow-integration-/)
  assert.match(launcher, /\.bob\\process/)
  assert.match(launcher, /process-\*/)
  assert.match(launcher, /\$WorkflowCount -lt 14/)
  assert.match(launcher, /\[switch\]\$NoLaunch/)

  const uat = fs.readFileSync(path.join(docsRoot, "uat", "process-workflows-uat-plan-ja.md"), "utf8")
  assert.match(uat, /6 workflow/)
  assert.match(uat, /process-code-precheck/)
  assert.match(uat, /human gate/)
  assert.match(uat, /\.bob-process-records/)
})

test("mini process sandbox input validates against the Phase 3 input helper", async () => {
  const sampleRoot = path.join(docsRoot, "examples", "mini-process-sandbox")
  const processInput = yaml.load(fs.readFileSync(path.join(sampleRoot, "process-input.yaml"), "utf8"))

  const result = await validateProcessInput(processInput, { workspaceRoot: sampleRoot })

  assert.equal(result.ok, true, result.diagnostics.join("\n"))
})
