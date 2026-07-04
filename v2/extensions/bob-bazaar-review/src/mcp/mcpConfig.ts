import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as vscode from "vscode"

export interface McpServerConfigOptions {
  workspaceFolder: vscode.WorkspaceFolder
  extensionContext: vscode.ExtensionContext
  serverName: string
  bzrPath: string
  textEncoding?: string
}

export interface McpServerConfigResult {
  configPath: string
  serverName: string
  serverPath: string
}

export async function configureWorkspaceMcpServer(options: McpServerConfigOptions): Promise<McpServerConfigResult> {
  const serverName = validateServerName(options.serverName)
  const workspaceRoot = options.workspaceFolder.uri.fsPath
  const bobDir = path.join(workspaceRoot, ".bob")
  const configPath = path.join(bobDir, "mcp.json")
  const serverPath = options.extensionContext.asAbsolutePath(path.join("out", "mcp", "server.js"))

  await fs.mkdir(bobDir, { recursive: true })

  const config = await readJsonObject(configPath)
  const mcpServers = isRecord(config.mcpServers) ? config.mcpServers : {}

  mcpServers[serverName] = {
    command: process.execPath,
    args: [serverPath],
    env: {
      BZR_PATH: options.bzrPath,
      BZR_TEXT_ENCODING: options.textEncoding ?? "auto",
      BOB_BAZAAR_ALLOWED_ROOTS: workspaceRoot
    },
    disabled: false
  }

  const next = {
    ...config,
    mcpServers
  }

  await backupExistingFile(configPath)
  await atomicWriteFile(configPath, `${JSON.stringify(next, null, 2)}\n`)

  return {
    configPath,
    serverName,
    serverPath
  }
}

export function validateServerName(serverName: string): string {
  const trimmed = serverName.trim()
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw new Error(`MCP server name must match ^[A-Za-z0-9._-]+$: ${serverName}`)
  }
  return trimmed
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

async function backupExistingFile(filePath: string): Promise<void> {
  try {
    await fs.access(filePath)
  } catch (error: any) {
    if (error?.code === "ENOENT") return
    throw error
  }
  await fs.copyFile(filePath, await nextBackupPath(filePath))
}

async function nextBackupPath(filePath: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  for (let index = 0; index < 1000; index += 1) {
    const suffix = index === 0 ? "" : `-${index}`
    const candidate = `${filePath}.bak-${stamp}${suffix}`
    try {
      await fs.access(candidate)
    } catch (error: any) {
      if (error?.code === "ENOENT") return candidate
      throw error
    }
  }
  throw new Error(`Unable to allocate backup path for ${filePath}`)
}

async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  try {
    await fs.writeFile(tempPath, content, "utf8")
    await fs.rename(tempPath, filePath)
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}
