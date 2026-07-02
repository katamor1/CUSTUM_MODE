const assert = require("node:assert/strict")
const { test } = require("node:test")
const { readSrc } = require("./helpers/sourceReader")

test("traceability prep command opens a Webview approval surface", () => {
  const commandSource = readSrc("traceabilityCommands.ts")
  const webviewSource = readSrc("webview", "traceabilityPrepWebview.ts")

  assert.match(commandSource, /openTraceabilityPrepWebview/)
  assert.match(webviewSource, /createWebviewPanel\("bobCodeConsistencyTraceabilityPrep"/)
  assert.match(webviewSource, /retainContextWhenHidden: true/)
  assert.match(webviewSource, /approveItem/)
  assert.match(webviewSource, /approveLink/)
  assert.match(webviewSource, /approveDecision/)
  assert.match(webviewSource, /Gate Report/)
  assert.match(webviewSource, /Review Input Preview/)
})
