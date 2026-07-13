const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const Module = require("node:module")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { writeTraceabilityCatalog } = require("../out/core/traceabilityCatalogStore")

async function makeWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bob-trace-prep-cas-"))
}

function catalogWithDomains(domains) {
  return {
    schema_version: 1,
    documents: [],
    domains,
    items: [],
    links: [],
    decisions: []
  }
}

function loadPrepWebview(vscode) {
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "vscode") return vscode
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const modulePath = require.resolve("../out/webview/traceabilityPrepWebview")
    delete require.cache[modulePath]
    return require(modulePath)
  } finally {
    Module._load = originalLoad
  }
}

function webviewHarness(modelPostDelayMs = 0) {
  const posted = []
  let receiveMessage
  const webview = {
    cspSource: "vscode-resource:",
    html: "",
    onDidReceiveMessage: (listener) => {
      receiveMessage = listener
      return { dispose: () => undefined }
    },
    postMessage: async (message) => {
      posted.push(message)
      if (modelPostDelayMs > 0 && message.type === "model") {
        await new Promise((resolve) => setTimeout(resolve, modelPostDelayMs))
      }
      return true
    }
  }
  const panel = { webview }
  const vscode = {
    ViewColumn: { One: 1 },
    window: { createWebviewPanel: () => panel }
  }
  const { openTraceabilityPrepWebview } = loadPrepWebview(vscode)
  return {
    openTraceabilityPrepWebview,
    posted,
    send: (message) => receiveMessage(message)
  }
}

function options(workspaceRoot) {
  return {
    context: { subscriptions: [] },
    workspaceRoot,
    catalogPath: ".bob-trace/traceability-catalog.json",
    reportPath: ".bob-trace/gate-report.md",
    textEncoding: "utf8"
  }
}

test("Traceability Prep rejects an external winner without saved or gate-report side effects", async () => {
  const workspaceRoot = await makeWorkspace()
  await writeTraceabilityCatalog({
    workspaceRoot,
    catalog: catalogWithDomains([{ code: "PAY", status: "proposed" }])
  })
  const harness = webviewHarness()
  await harness.openTraceabilityPrepWebview(options(workspaceRoot))
  await writeTraceabilityCatalog({
    workspaceRoot,
    catalog: catalogWithDomains([{ code: "AUTH", status: "accepted" }])
  })

  await harness.send({ type: "action", action: { type: "approveDomain", code: "PAY" } })
  await harness.send({ type: "save" })

  const final = JSON.parse(await fs.readFile(path.join(workspaceRoot, ".bob-trace", "traceability-catalog.json"), "utf8"))
  assert.deepEqual(final.domains, [{ code: "AUTH", status: "accepted" }])
  assert.equal(harness.posted.some((message) => message.type === "saved"), false)
  assert.ok(harness.posted.some((message) => message.type === "error" && /stale|refresh|再読込|更新/i.test(message.message)))
  await assert.rejects(fs.readFile(path.join(workspaceRoot, ".bob-trace", "gate-report.md"), "utf8"), /ENOENT/)
})

test("Traceability Prep serializes same-panel actions and consecutive saves while advancing revision", async () => {
  const workspaceRoot = await makeWorkspace()
  await writeTraceabilityCatalog({
    workspaceRoot,
    catalog: catalogWithDomains([
      { code: "PAY", status: "proposed" },
      { code: "AUTH", status: "proposed" }
    ])
  })
  const harness = webviewHarness(10)
  await harness.openTraceabilityPrepWebview(options(workspaceRoot))

  await Promise.all([
    harness.send({ type: "action", action: { type: "approveDomain", code: "PAY" } }),
    harness.send({ type: "save" }),
    harness.send({ type: "action", action: { type: "approveDomain", code: "AUTH" } }),
    harness.send({ type: "save" })
  ])

  const saved = harness.posted.filter((message) => message.type === "saved")
  assert.equal(saved.length, 2)
  assert.notEqual(saved[0].backupPath, saved[1].backupPath)
  const final = JSON.parse(await fs.readFile(path.join(workspaceRoot, ".bob-trace", "traceability-catalog.json"), "utf8"))
  assert.deepEqual(final.domains.map((domain) => domain.status), ["accepted", "accepted"])
  assert.match(await fs.readFile(path.join(workspaceRoot, ".bob-trace", "gate-report.md"), "utf8"), /Traceability Gate Report/)
})
