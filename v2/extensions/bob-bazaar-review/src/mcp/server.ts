#!/usr/bin/env node
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { formatError, McpStdioReader, respond, respondError } from "./jsonRpc"
import type { JsonRpcMessage } from "./jsonRpc"
import { createMcpToolRegistry } from "./tools"

const SERVER_VERSION = "0.3.0"
const DEFAULT_MAX_REQUEST_BYTES = 1024 * 1024
const MAX_REQUEST_BYTES = readPositiveIntegerEnv("BOB_BAZAAR_MCP_MAX_REQUEST_BYTES", DEFAULT_MAX_REQUEST_BYTES)
const ALLOWED_ROOTS_ENV = "BOB_BAZAAR_ALLOWED_ROOTS"
const ENABLE_WRITE_TOOLS_ENV = "BOB_BAZAAR_ENABLE_WRITE_TOOLS"
const allowedRootInputs = readPathListEnv(ALLOWED_ROOTS_ENV)
let allowedRootsPromise: Promise<string[]> | undefined

const tools = createMcpToolRegistry({
  requiredAllowedCwd,
  writeToolsEnabled: process.env[ENABLE_WRITE_TOOLS_ENV] === "1"
})

async function handleMessage(message: JsonRpcMessage): Promise<void> {
  if (!message.method) return
  try {
    if (message.method === "initialize") {
      respond(message.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "bob-bazaar-review", version: SERVER_VERSION }
      })
      return
    }

    if (message.method === "notifications/initialized") {
      return
    }

    if (message.method === "tools/list") {
      respond(message.id, { tools: tools.availableTools() })
      return
    }

    if (message.method === "tools/call") {
      const result = await tools.callTool(message.params?.name, message.params?.arguments ?? {})
      respond(message.id, result)
      return
    }

    respondError(message.id, -32601, `Method not found: ${message.method}`)
  } catch (error: unknown) {
    respond(message.id, {
      isError: true,
      content: [{ type: "text", text: formatError(error) }]
    })
  }
}

async function requiredAllowedCwd(args: unknown, name: string): Promise<string> {
  const value = (args as Record<string, unknown> | undefined)?.[name]
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required string argument: ${name}`)
  }
  return assertAllowedCwd(value)
}

async function assertAllowedCwd(cwd: string): Promise<string> {
  if (allowedRootInputs.length === 0) return cwd

  // MCP tool の cwd はエージェント入力なので、realpath 後に明示許可 root 配下だけへ閉じ込める。
  const resolvedCwd = await fs.realpath(cwd)
  const allowedRoots = await getAllowedRoots()
  for (const root of allowedRoots) {
    const relative = path.relative(root, resolvedCwd)
    if (relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative))) {
      return resolvedCwd
    }
  }
  throw new Error(`cwd is outside allowed roots: ${cwd}`)
}

async function getAllowedRoots(): Promise<string[]> {
  allowedRootsPromise ??= Promise.all(allowedRootInputs.map((root) => fs.realpath(root)))
  return allowedRootsPromise
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name])
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function readPathListEnv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean)
}

const reader = new McpStdioReader(handleMessage, MAX_REQUEST_BYTES)

process.stdin.on("data", (chunk) => reader.push(chunk))
process.stdin.on("error", (error) => {
  process.stderr.write(`stdin error: ${String(error)}\n`)
})
