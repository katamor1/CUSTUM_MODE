const assert = require("node:assert/strict")
const { test } = require("node:test")

test("review GUI CSP nonce is generated from random bytes and reused consistently", () => {
  const { createNonce, renderHtml } = require("../out/reviewGuiHtml")

  const nonce = createNonce()
  assert.equal(Buffer.from(nonce, "base64").length, 16)

  const html = renderHtml("vscode-resource:")
  const cspNonce = html.match(/script-src 'nonce-([^']+)'/)?.[1]
  const scriptNonce = html.match(/<script nonce="([^"]+)">/)?.[1]

  assert.ok(cspNonce)
  assert.equal(cspNonce, scriptNonce)
  assert.equal(Buffer.from(cspNonce, "base64").length, 16)
})
