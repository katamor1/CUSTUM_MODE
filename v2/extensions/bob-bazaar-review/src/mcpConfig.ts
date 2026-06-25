import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as vscode from "vscode"

export interface McpServerConfigOptions {
  workspaceFolder: vscode.WorkspaceFolder
  extensionContext: vscode.ExtensionContext
  serverName: string
  bzrPath: string
}

export interface McpServerConfigResult {
  configPath: string
  serverName: string
  serverPath: string
}

export async function configureWorkspaceMcpServer(options: McpServerConfigOptions): Promise<McpServerConfigResult> {
  const workspaceRoot = options.workspaceFolder.uri.fsPath
  const bobDir = path.join(workspaceRoot, ".bob")
  const configPath = path.join(bobDir, "mcp.json")
  const serverPath = options.extensionContext.asAbsolutePath(path.join("out", "mcp", "server.js"))

  await fs.mkdir(bobDir, { recursive: true })

  const config = await readJsonObject(configPath)
  const mcpServers = isRecord(config.mcpServers) ? config.mcpServers : {}

  mcpServers[options.serverName] = {
    command: process.execPath,
    args: [serverPath],
    env: {
      BZR_PATH: options.bzrPath
    },
    disabled: false
  }

  const next = {
    ...config,
    mcpServers
  }

  await fs.writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8")

  return {
    configPath,
    serverName: options.serverName,
    serverPath
  }
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(filePath, "utf8")
    const parsed = JSON.parse(raw)
    if (!isRecord(parsed)) {
      throw new Error("Top-level JSON value must be an object")
    }
    return parsed
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return {}
    }
    throw new Error(`Failed to read ${filePath}: ${error?.message ?? String(error)}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
