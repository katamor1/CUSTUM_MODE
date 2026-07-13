const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")
const yaml = require("js-yaml")

const { parseWorkflowMarkdown } = require("../out/core/parser")

const repoRoot = path.resolve(__dirname, "..", "..", "..")
const catalogPath = path.join(repoRoot, ".bob", "process", "process-catalog.yaml")
const catalog = yaml.load(fs.readFileSync(catalogPath, "utf8"))

test("process catalog enumerates the authoritative 14 workflow definitions", () => {
  assert.equal(catalog.workflows.length, 14)
  assert.equal(new Set(catalog.workflows.map((entry) => entry.name)).size, 14)
})

test("specialized workflow contract CI runs and watches the process catalog contract", () => {
  const workflow = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "workflow-contracts.yml"), "utf8")
  assert.match(workflow, /node --test test\/workflowContractFiles\.test\.js test\/processWorkflowContracts\.test\.js/)
  assert.equal(workflow.match(/- "extensions\/workflow-register\/test\/processWorkflowContracts\.test\.js"/g)?.length, 2)
  assert.equal(workflow.match(/- "\.bob\/process\/process-catalog\.yaml"/g)?.length, 2)
})

for (const entry of catalog.workflows) {
  test(`${entry.name} terminates at human-gate unless explicitly approved`, () => {
    const workflowPath = path.join(repoRoot, ...entry.workflowPath.split("/"))
    const parsed = parseWorkflowMarkdown({
      sourceId: "workflow-register",
      filePath: entry.workflowPath,
      text: fs.readFileSync(workflowPath, "utf8")
    })

    assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
    assert.equal(parsed.workflow.branching?.enabled, true)
    const humanGate = parsed.workflow.engineSteps.find((step) => step.id === "human-gate")
    assert.equal(humanGate?.transition?.default, "fail")
    assert.equal(humanGate?.transition?.decisions.length, 1)
    const approved = humanGate.transition.decisions[0]
    assert.equal(approved.id, "approved")
    assert.equal(approved.when.stateKey, "humanGate.decision")
    assert.equal(approved.when.equals, "approved")
    assert.equal(approved.goto, "write-process-record")
  })
}
