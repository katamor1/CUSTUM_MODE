const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const { spawnSync } = require("node:child_process")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")
const { extensionRoot } = require("./helpers/sourceReader")

function mcpFrame(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8")
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, "utf8"),
    body
  ])
}

function readMcpMessage(output) {
  const separator = output.indexOf("\r\n\r\n")
  assert.notEqual(separator, -1, `MCP response header not found in: ${output.toString("utf8")}`)
  const header = output.slice(0, separator).toString("utf8")
  const match = /^Content-Length:\s*(\d+)$/im.exec(header)
  assert.ok(match, `Content-Length not found in: ${header}`)
  const bodyStart = separator + 4
  const bodyEnd = bodyStart + Number(match[1])
  return JSON.parse(output.slice(bodyStart, bodyEnd).toString("utf8"))
}

function runServer(request, env = {}) {
  return spawnSync(process.execPath, [path.join(extensionRoot, "out", "mcp", "server.js")], {
    input: mcpFrame(request),
    env: {
      ...process.env,
      ...env
    },
    timeout: 5000
  })
}

test("MCP write tools are hidden from tools/list by default", () => {
  const child = runServer({
    jsonrpc: "2.0",
    id: 21,
    method: "tools/list"
  })

  assert.equal(child.status, 0, child.stderr.toString("utf8"))
  const message = readMcpMessage(child.stdout)
  const names = message.result.tools.map((tool) => tool.name)
  assert.ok(!names.includes("project_rules_init"))
})

test("MCP project_rules_init is disabled by default and does not write files", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bob-bazaar-mcp-write-disabled-"))
  const child = runServer({
    jsonrpc: "2.0",
    id: 22,
    method: "tools/call",
    params: {
      name: "project_rules_init",
      arguments: { cwd: workspaceRoot }
    }
  })

  assert.equal(child.status, 0, child.stderr.toString("utf8"))
  const message = readMcpMessage(child.stdout)
  assert.equal(message.result.isError, true)
  assert.match(message.result.content[0].text, /BOB_BAZAAR_ENABLE_WRITE_TOOLS=1/)
  await assert.rejects(fs.stat(path.join(workspaceRoot, ".bob", "review", "checklist.json")))
})

test("MCP project_rules_init is available when write tools are explicitly enabled", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bob-bazaar-mcp-write-enabled-"))
  const listChild = runServer(
    {
      jsonrpc: "2.0",
      id: 23,
      method: "tools/list"
    },
    { BOB_BAZAAR_ENABLE_WRITE_TOOLS: "1" }
  )

  assert.equal(listChild.status, 0, listChild.stderr.toString("utf8"))
  const listMessage = readMcpMessage(listChild.stdout)
  assert.ok(listMessage.result.tools.map((tool) => tool.name).includes("project_rules_init"))

  const callChild = runServer(
    {
      jsonrpc: "2.0",
      id: 24,
      method: "tools/call",
      params: {
        name: "project_rules_init",
        arguments: { cwd: workspaceRoot }
      }
    },
    {
      BOB_BAZAAR_ALLOWED_ROOTS: workspaceRoot,
      BOB_BAZAAR_ENABLE_WRITE_TOOLS: "1"
    }
  )

  assert.equal(callChild.status, 0, callChild.stderr.toString("utf8"))
  const callMessage = readMcpMessage(callChild.stdout)
  assert.equal(callMessage.result.isError, undefined)
  await fs.stat(path.join(workspaceRoot, ".bob", "review", "checklist.json"))
})
