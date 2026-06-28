const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const extensionRoot = path.resolve(__dirname, "..")

test("Bazaar MCP server reports the extension package version", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"))
  const source = fs.readFileSync(path.join(extensionRoot, "src", "mcp", "server.ts"), "utf8")

  assert.match(source, new RegExp(`const SERVER_VERSION = "${packageJson.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`))
  assert.match(source, /serverInfo: \{ name: "bob-bazaar-review", version: SERVER_VERSION \}/)
})
