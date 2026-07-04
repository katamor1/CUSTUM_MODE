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

test("MCP server rejects cwd outside configured allowed roots", async () => {
  const serverPath = path.join(extensionRoot, "out", "mcp", "server.js")
  const allowedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bob-bazaar-mcp-allowed-"))
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bob-bazaar-mcp-outside-"))
  const request = {
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: {
      name: "project_rules_get_checklist",
      arguments: { cwd: outsideRoot }
    }
  }

  const child = spawnSync(process.execPath, [serverPath], {
    input: mcpFrame(request),
    env: {
      ...process.env,
      BOB_BAZAAR_ALLOWED_ROOTS: allowedRoot
    },
    timeout: 5000
  })

  assert.equal(child.status, 0, child.stderr.toString("utf8"))
  const message = readMcpMessage(child.stdout)
  assert.equal(message.id, 7)
  assert.equal(message.result.isError, true)
  assert.match(message.result.content[0].text, /cwd is outside allowed roots/)
})

test("MCP server accepts cwd inside configured allowed roots", async () => {
  const serverPath = path.join(extensionRoot, "out", "mcp", "server.js")
  const allowedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bob-bazaar-mcp-allowed-"))
  const childRoot = path.join(allowedRoot, "child")
  await fs.mkdir(childRoot)
  const request = {
    jsonrpc: "2.0",
    id: 8,
    method: "tools/call",
    params: {
      name: "project_rules_get_checklist",
      arguments: { cwd: childRoot }
    }
  }

  const child = spawnSync(process.execPath, [serverPath], {
    input: mcpFrame(request),
    env: {
      ...process.env,
      BOB_BAZAAR_ALLOWED_ROOTS: allowedRoot
    },
    timeout: 5000
  })

  assert.equal(child.status, 0, child.stderr.toString("utf8"))
  const message = readMcpMessage(child.stdout)
  assert.equal(message.id, 8)
  assert.equal(message.result.isError, undefined)
  assert.match(message.result.content[0].text, /"rules"/)
})
