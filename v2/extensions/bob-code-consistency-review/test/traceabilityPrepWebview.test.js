const assert = require("node:assert/strict")
const { test } = require("node:test")
const { readSrc } = require("./helpers/sourceReader")

test("traceability prep command opens a Webview approval surface", () => {
  const commandSource = readSrc("traceabilityCommands.ts")
  const webviewSource = readSrc("webview", "traceabilityPrepWebview.ts")
  const webviewAssetsSource = readSrc("webview", "traceabilityPrepWebviewAssets.ts")
  const combinedWebviewSource = `${webviewSource}\n${webviewAssetsSource}`

  assert.match(commandSource, /openTraceabilityPrepWebview/)
  assert.match(webviewSource, /createWebviewPanel\(\s*"bobCodeConsistencyTraceabilityPrep"/)
  assert.match(webviewSource, /retainContextWhenHidden: true/)
  assert.match(combinedWebviewSource, /approveItem/)
  assert.match(combinedWebviewSource, /approveLink/)
  assert.match(combinedWebviewSource, /approveDecision/)
  assert.match(combinedWebviewSource, /Gate Report/)
  assert.match(combinedWebviewSource, /Review Input Preview/)
})
