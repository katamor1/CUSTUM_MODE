const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")
const yaml = require("js-yaml")

const outRoot = path.resolve(__dirname, "..", "out")
const {
  PROCESS_CATALOG_SCHEMA_VERSION,
  PROCESS_WORKFLOW_NAMES,
  validateProcessCatalog
} = require(path.join(outRoot, "process", "processCatalogValidator"))

test("tracked Phase 3 process catalog validates every required workflow", () => {
  const repoRoot = path.resolve(__dirname, "..", "..", "..")
  const catalogPath = path.join(repoRoot, ".bob", "process", "process-catalog.yaml")
  const catalog = yaml.load(fs.readFileSync(catalogPath, "utf8"))

  const result = validateProcessCatalog(catalog)

  assert.equal(result.ok, true, result.diagnostics.join("\n"))
  assert.equal(result.catalog.schemaVersion, PROCESS_CATALOG_SCHEMA_VERSION)
  assert.deepEqual(
    result.catalog.workflows.map((workflow) => workflow.name).sort(),
    [...PROCESS_WORKFLOW_NAMES].sort()
  )
})

test("process catalog rejects duplicate workflow names and unsafe paths", () => {
  const catalog = {
    schemaVersion: PROCESS_CATALOG_SCHEMA_VERSION,
    catalogId: "phase3-process-workflows",
    workflowRoot: ".bob/workflows",
    runRoot: ".bob-process-runs",
    recordRoot: ".bob-process-records",
    workflows: [
      {
        name: "process-common-review",
        title: "共通レビュー",
        phase: "common",
        workflowPath: ".bob/workflows/process-common-review/WORKFLOW.md",
        inputSchema: "bob-process-input/v1",
        recordSchema: "bob-process-record/v1",
        reviewResultSchema: "process-review-result/v1",
        requiredInputs: ["review_target"],
        artifactOutputs: [".bob-process-runs/{{run.id}}/common-review/review-result.yaml"],
        humanGates: ["common-review-gate"]
      },
      {
        name: "process-common-review",
        title: "重複レビュー",
        phase: "common",
        workflowPath: "../outside/WORKFLOW.md",
        inputSchema: "bob-process-input/v1",
        recordSchema: "bob-process-record/v1",
        reviewResultSchema: "process-review-result/v1",
        requiredInputs: ["review_target"],
        artifactOutputs: ["C:/outside/review-result.yaml"],
        humanGates: ["common-review-gate"]
      }
    ]
  }

  const result = validateProcessCatalog(catalog)

  assert.equal(result.ok, false)
  assert.match(result.diagnostics.join("\n"), /duplicate workflow name/i)
  assert.match(result.diagnostics.join("\n"), /unsafe workspace path/i)
})
