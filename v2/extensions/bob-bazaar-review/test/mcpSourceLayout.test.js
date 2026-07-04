const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const extensionRoot = path.resolve(__dirname, "..")

function readMcpSource(fileName) {
  return fs.readFileSync(path.join(extensionRoot, "src", "mcp", fileName), "utf8")
}

test("MCP server separates JSON-RPC plumbing from Bazaar and project-rules tool implementations", () => {
  const expectedFiles = ["server.ts", "jsonRpc.ts", "tools.ts", "bazaarTools.ts", "projectRulesTools.ts"]
  for (const fileName of expectedFiles) {
    assert.ok(fs.existsSync(path.join(extensionRoot, "src", "mcp", fileName)), `${fileName} must exist`)
  }

  const serverSource = readMcpSource("server.ts")
  assert.match(serverSource, /from "\.\/jsonRpc"/)
  assert.match(serverSource, /from "\.\/tools"/)
  assert.doesNotMatch(serverSource, /from "\.\.\/bazaar"/)
  assert.doesNotMatch(serverSource, /from "\.\.\/projectRules\//)

  const bazaarToolsSource = readMcpSource("bazaarTools.ts")
  assert.match(bazaarToolsSource, /from "\.\.\/bazaar"/)

  const projectRulesToolsSource = readMcpSource("projectRulesTools.ts")
  assert.match(projectRulesToolsSource, /from "\.\.\/projectRules\//)
})
