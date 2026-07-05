#!/usr/bin/env node
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { formatError, McpStdioReader, respond, respondError } from "./jsonRpc"
import type { JsonRpcMessage } from "./jsonRpc"
import { createMcpToolRegistry } from "./tools"
import { EXTENSION_NAME, EXTENSION_VERSION } from "../shared/extensionMetadata"

const DEFAULT_MAX_REQUEST_BYTES = 1024 * 1024
const MAX_REQUEST_BYTES = readPositiveIntegerEnv("BOB_BAZAAR_MCP_MAX_REQUEST_BYTES", DEFAULT_MAX_REQUEST_BYTES)
const ALLOWED_ROOTS_ENV = "BOB_BAZAAR_ALLOWED_ROOTS"
const ALLOW_UNRESTRICTED_CWD_ENV = "BOB_BAZAAR_ALLOW_UNRESTRICTED_CWD"
const ENABLE_WRITE_TOOLS_ENV = "BOB_BAZAAR_ENABLE_WRITE_TOOLS"
const allowedRootInputs = readPathListEnv(ALLOWED_ROOTS_ENV)
const allowUnrestrictedCwd = process.env[ALLOW_UNRESTRICTED_CWD_ENV] === "1"
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
        serverInfo: { name: EXTENSION_NAME, version: EXTENSION_VERSION }
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
      const call = parseToolCallParams(message.params)
      const result = await tools.callTool(call.name, call.arguments)
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

function parseToolCallParams(params: unknown): { name: string; arguments: unknown } {
  if (!isRecord(params)) {
    throw new Error("tools/call params must be an object")
  }
  if (typeof params.name !== "string" || !params.name.trim()) {
    throw new Error("Missing required tools/call string parameter: name")
  }
  return {
    name: params.name,
    arguments: params.arguments ?? {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

async function assertAllowedCwd(cwd: string): Promise<string> {
  if (allowedRootInputs.length === 0) {
    if (allowUnrestrictedCwd) return fs.realpath(cwd)
    throw new Error(`allowed roots are not configured; set ${ALLOWED_ROOTS_ENV} or ${ALLOW_UNRESTRICTED_CWD_ENV}=1`)
  }

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
