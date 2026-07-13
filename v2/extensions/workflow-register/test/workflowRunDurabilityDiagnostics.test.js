const assert = require("node:assert/strict")
const { test } = require("node:test")

const { buildWorkflowRunDiagnosticReport } = require("../out/core/runDiagnostics.js")

function run() {
  return {
    schemaVersion: "workflow-register/run-state/v1",
    runId: "run-1",
    workflowId: "workflow.test",
    workflowName: "test",
    status: "paused",
    currentStep: "step-1",
    inputs: {},
    state: { privatePayload: "must-not-appear" },
    steps: [{ id: "step-1", title: "Step 1", type: "manual", status: "held" }],
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:01:00.000Z"
  }
}

test("run diagnostics expose event, journal and lease evidence without state values", () => {
  const report = buildWorkflowRunDiagnosticReport([run()], {
    durabilityByRunId: {
      "run-1": {
        eventCount: 3,
        eventHeadHash: `sha256:${"a".repeat(64)}`,
        journalPending: false,
        lockPresent: true
      }
    },
    runDocumentDiagnostics: [{
      runId: "run-1",
      severity: "error",
      code: "stale-write",
      message: "A stale writer was rejected."
    }]
  })

  assert.ok(report.lines.includes("Run durability:"))
  assert.ok(report.lines.includes("- immutable events: 3"))
  assert.ok(report.lines.includes(`- event head: sha256:${"a".repeat(64)}`))
  assert.ok(report.lines.includes("- journal: none"))
  assert.ok(report.lines.includes("- execution lease: present"))
  assert.ok(report.lines.includes("- run-1 [error/stale-write]: A stale writer was rejected."))
  assert.doesNotMatch(report.lines.join("\n"), /must-not-appear/)
  assert.match(report.summary, /1 run durability record\(s\)/)
})
