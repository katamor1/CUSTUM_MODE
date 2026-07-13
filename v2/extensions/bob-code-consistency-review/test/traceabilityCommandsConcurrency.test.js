const assert = require("node:assert/strict")
const Module = require("node:module")
const path = require("node:path")
const { test } = require("node:test")

function emptyCatalog() {
  return { schema_version: 1, documents: [], domains: [], items: [], links: [], decisions: [] }
}

function loadTraceabilityCommands(harness) {
  const originalLoad = Module._load
  const stubs = {
    vscode: {
      workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) }
    },
    "./core/traceabilityAiDraftProvider": {},
    "./core/traceabilityCatalog": {
      buildReviewInputDraftFromTraceability: () => ({ status: "ok", draft: {}, warnings: [] })
    },
    "./core/traceabilityCatalogStore": {
      DEFAULT_TRACEABILITY_CATALOG_PATH: ".bob-trace/traceability-catalog.json",
      DEFAULT_TRACEABILITY_GATE_REPORT_PATH: ".bob-trace/gate-report.md",
      readTraceabilityCatalog: async () => {
        harness.reads += 1
        return {
          status: "ok",
          catalog: emptyCatalog(),
          catalogPath: "catalog.json",
          created: false,
          revision: harness.reads === 1 ? "sha256:first" : "sha256:external-winner"
        }
      },
      validateAndWriteTraceabilityGateReport: async () => ({ status: "ok" })
    },
    "./core/fileSystem": {},
    "./core/reviewInputBuilder": {
      writeReviewInputFromDraft: async () => {
        harness.writes += 1
        return { status: "ok", outputPath: "review-input.yaml" }
      }
    },
    "./extensionCommandOptions": {
      absolute: (_root, value) => value,
      booleanOption: () => true,
      notifyError: (message) => harness.notifications.push(message),
      notifyInfo: (message) => harness.notifications.push(message),
      notifyInfoWithReport: () => undefined,
      requireBobWorkspaceRoot: async () => path.resolve("workspace"),
      reviewFocusOption: () => undefined,
      stringOption: () => undefined
    },
    "./reviewInputWizard": {
      collectReviewMetadata: async () => ({
        id: "review",
        title: "review",
        purpose: "review",
        change_type: "maintenance",
        vcs: "git",
        base: "HEAD~1",
        head: "HEAD"
      })
    },
    "./webview/traceabilityPrepWebview": {},
    "./workflowProviderRegistration": { optionRecord: () => ({}) }
  }
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.hasOwn(stubs, request)) return stubs[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const modulePath = require.resolve("../out/traceabilityCommands")
    delete require.cache[modulePath]
    return require(modulePath)
  } finally {
    Module._load = originalLoad
  }
}

test("create-review-input rejects a catalog changed while metadata was collected", async () => {
  const harness = { reads: 0, writes: 0, notifications: [] }
  const { runCreateReviewInputFromTraceability } = loadTraceabilityCommands(harness)

  const result = await runCreateReviewInputFromTraceability()

  assert.equal(harness.reads, 2)
  assert.equal(harness.writes, 0)
  assert.equal(result.status, "error")
  assert.equal(result.code, "stale_revision")
  assert.match(result.errors.join("; "), /stale|refresh|再読込|更新/i)
})
