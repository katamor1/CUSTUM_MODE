const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const extensionRoot = path.resolve(__dirname, "..")

test("Bazaar MCP server reports the extension package version", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"))
  const source = fs.readFileSync(path.join(extensionRoot, "src", "mcp", "server.ts"), "utf8")
  const { EXTENSION_NAME, EXTENSION_VERSION } = require("../out/shared/extensionMetadata")

  assert.equal(EXTENSION_NAME, packageJson.name)
  assert.equal(EXTENSION_VERSION, packageJson.version)
  assert.match(source, /import \{ EXTENSION_NAME, EXTENSION_VERSION \} from "\.\.\/shared\/extensionMetadata"/)
  assert.match(source, /serverInfo: \{ name: EXTENSION_NAME, version: EXTENSION_VERSION \}/)
})
