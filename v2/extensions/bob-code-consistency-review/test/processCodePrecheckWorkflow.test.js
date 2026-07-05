const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

test("process-code-precheck workflow hands Phase 2 artifacts into the process record", () => {
  const repoRoot = path.resolve(__dirname, "..", "..", "..")
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".bob", "workflows", "process-code-precheck", "WORKFLOW.md"),
    "utf8"
  )

  for (const phrase of [
    "provider: bobCodeConsistency.preprocess",
    "provider: bobCodeConsistency.validateOutput",
    "provider: bobCodeConsistency.triage",
    "phase2Handoff:",
    "reviewPackage:",
    "validation:",
    "triage:"
  ]) {
    assert.ok(workflow.includes(phrase), `missing ${phrase}`)
  }
})
