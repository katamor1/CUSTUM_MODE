const test = require("node:test")
const assert = require("node:assert/strict")

const {
  renderTraceabilityPrepClientScript,
  serializeTraceabilityPrepInitialModel
} = require("../out/webview/traceabilityPrepWebviewAssets")

test("traceability prep client script avoids CSP-blocked inline handlers", () => {
  const script = renderTraceabilityPrepClientScript(JSON.stringify({
    catalog: { domains: [], items: [], links: [], decisions: [] },
    report: { status: "ok", errors: [], warnings: [] },
    counts: { proposedItems: 0 }
  }))

  assert.doesNotMatch(script, /onclick=/)
  assert.doesNotMatch(script, /onchange=/)
  assert.match(script, /addEventListener\('click'/)
  assert.match(script, /addEventListener\('change'/)
  assert.match(script, /data-action=/)
  assert.match(script, /data-args=/)
})

test("traceability prep initial model cannot terminate the script tag", () => {
  const initialJson = serializeTraceabilityPrepInitialModel({
    catalog: {
      domains: [{ code: "PAY</script><script>alert(1)</script>", status: "proposed" }],
      items: [],
      links: [],
      decisions: []
    },
    report: { status: "ok", errors: [], warnings: [] },
    counts: { proposedItems: 0 }
  })

  assert.doesNotMatch(initialJson, /<\/script>/i)
  assert.match(initialJson, /\\u003c\/script>/i)
})
