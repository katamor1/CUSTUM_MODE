const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

test("configureWorkspaceMcpServer writes the configured Bazaar text encoding", async () => {
  const { configureWorkspaceMcpServer } = require("../out/mcp/mcpConfig")
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bob-bazaar-mcp-"))
  const result = await configureWorkspaceMcpServer({
    workspaceFolder: { uri: { fsPath: workspaceRoot } },
    extensionContext: { asAbsolutePath: (relativePath) => path.join("C:\\extension", relativePath) },
    serverName: "bazaar",
    bzrPath: "bzr",
    textEncoding: "shift_jis"
  })

  const config = JSON.parse(await fs.readFile(result.configPath, "utf8"))

  assert.equal(config.mcpServers.bazaar.env.BZR_TEXT_ENCODING, "shift_jis")
  assert.equal(config.mcpServers.bazaar.env.BOB_BAZAAR_ALLOWED_ROOTS, workspaceRoot)
})

test("configureWorkspaceMcpServer rejects invalid server names", async () => {
  const { configureWorkspaceMcpServer } = require("../out/mcp/mcpConfig")
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bob-bazaar-mcp-"))

  await assert.rejects(
    () => configureWorkspaceMcpServer({
      workspaceFolder: { uri: { fsPath: workspaceRoot } },
      extensionContext: { asAbsolutePath: (relativePath) => path.join("C:\\extension", relativePath) },
      serverName: "../bad",
      bzrPath: "bzr"
    }),
    /MCP server name/
  )
})

test("configureWorkspaceMcpServer backs up existing config and writes atomically", async () => {
  const { configureWorkspaceMcpServer } = require("../out/mcp/mcpConfig")
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bob-bazaar-mcp-"))
  const bobDir = path.join(workspaceRoot, ".bob")
  const configPath = path.join(bobDir, "mcp.json")
  const previousConfig = { mcpServers: { old: { command: "node", args: ["old.js"] } } }
  await fs.mkdir(bobDir, { recursive: true })
  await fs.writeFile(configPath, `${JSON.stringify(previousConfig, null, 2)}\n`, "utf8")

  await configureWorkspaceMcpServer({
    workspaceFolder: { uri: { fsPath: workspaceRoot } },
    extensionContext: { asAbsolutePath: (relativePath) => path.join("C:\\extension", relativePath) },
    serverName: "bazaar",
    bzrPath: "bzr"
  })

  const entries = await fs.readdir(bobDir)
  const backupName = entries.find((entry) => /^mcp\.json\.bak-/.test(entry))
  assert.ok(backupName)
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(bobDir, backupName), "utf8")), previousConfig)
  assert.ok(!entries.some((entry) => entry.endsWith(".tmp")))
})
