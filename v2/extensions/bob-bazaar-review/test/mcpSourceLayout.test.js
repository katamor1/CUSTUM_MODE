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
  assert.match(bazaarToolsSource, /from "\.\.\/bazaar\/bazaar"/)

  const projectRulesToolsSource = readMcpSource("projectRulesTools.ts")
  assert.match(projectRulesToolsSource, /from "\.\.\/projectRules\//)
})

test("MCP tool contracts keep input and output types separate from tool implementations", () => {
  const expectedFiles = ["toolTypes.ts", "toolSchemas.ts"]
  for (const fileName of expectedFiles) {
    assert.ok(fs.existsSync(path.join(extensionRoot, "src", "mcp", fileName)), `${fileName} must exist`)
  }

  const toolCommonSource = readMcpSource("toolCommon.ts")
  assert.doesNotMatch(toolCommonSource, /export\s+(interface|type)\s+(ToolDef|BazaarCommandResult|RequiredAllowedCwd|.+Input|.+Output|McpTool)/)

  for (const fileName of ["bazaarTools.ts", "projectRulesTools.ts", "tools.ts"]) {
    const source = readMcpSource(fileName)
    assert.match(source, /from "\.\/toolTypes"/, `${fileName} must import MCP contracts from toolTypes.ts`)
  }

  const bazaarToolsSource = readMcpSource("bazaarTools.ts")
  const projectRulesToolsSource = readMcpSource("projectRulesTools.ts")
  assert.match(bazaarToolsSource, /from "\.\/toolSchemas"/)
  assert.match(projectRulesToolsSource, /from "\.\/toolSchemas"/)
})

test("bob-bazaar-review source does not use export-star barrels", () => {
  const sourceRoot = path.join(extensionRoot, "src")
  const violations = []

  function scanDirectory(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        scanDirectory(fullPath)
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        const source = fs.readFileSync(fullPath, "utf8")
        if (/^\s*export\s+\*\s+from\s+/m.test(source)) {
          violations.push(path.relative(sourceRoot, fullPath).replace(/\\/g, "/"))
        }
      }
    }
  }

  scanDirectory(sourceRoot)
  assert.deepEqual(violations, [], "export * is only allowed when an explicit public API boundary is approved")
})
