const assert = require("node:assert/strict")
const { spawnSync } = require("node:child_process")
const path = require("node:path")
const { test } = require("node:test")
const { extensionRoot } = require("./helpers/sourceReader")

function mcpFrame(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8")
  return rawMcpFrame(body)
}

function rawMcpFrame(body) {
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

test("MCP stdio reader rejects requests over the configured byte limit", () => {
  const serverPath = path.join(extensionRoot, "out", "mcp", "server.js")
  const request = {
    jsonrpc: "2.0",
    id: 99,
    method: "initialize",
    params: { oversized: "x".repeat(256) }
  }
  const requestBodyBytes = Buffer.byteLength(JSON.stringify(request), "utf8")

  const child = spawnSync(process.execPath, [serverPath], {
    input: mcpFrame(request),
    env: {
      ...process.env,
      BOB_BAZAAR_MCP_MAX_REQUEST_BYTES: "64"
    },
    timeout: 5000
  })

  assert.equal(child.status, 0, child.stderr.toString("utf8"))
  const message = readMcpMessage(child.stdout)
  assert.equal(message.id, null)
  assert.equal(message.error.code, -32000)
  assert.match(message.error.message, new RegExp(`Content-Length ${requestBodyBytes} exceeds maximum 64 bytes`))
})

test("MCP stdio reader returns a JSON-RPC parse error for invalid JSON bodies", () => {
  const serverPath = path.join(extensionRoot, "out", "mcp", "server.js")
  const invalidBody = Buffer.from("{\"jsonrpc\":\"2.0\",", "utf8")
  const child = spawnSync(process.execPath, [serverPath], {
    input: rawMcpFrame(invalidBody),
    timeout: 5000
  })

  assert.equal(child.status, 0, child.stderr.toString("utf8"))
  const message = readMcpMessage(child.stdout)
  assert.equal(message.id, null)
  assert.equal(message.error.code, -32700)
  assert.match(message.error.message, /Parse error:/)
})

test("MCP tools/call validates params before dispatching to tools", () => {
  const serverPath = path.join(extensionRoot, "out", "mcp", "server.js")
  const child = spawnSync(process.execPath, [serverPath], {
    input: mcpFrame({
      jsonrpc: "2.0",
      id: 100,
      method: "tools/call",
      params: { arguments: {} }
    }),
    timeout: 5000
  })

  assert.equal(child.status, 0, child.stderr.toString("utf8"))
  const message = readMcpMessage(child.stdout)
  assert.equal(message.id, 100)
  assert.equal(message.result.isError, true)
  assert.match(message.result.content[0].text, /Missing required tools\/call string parameter: name/)
})
