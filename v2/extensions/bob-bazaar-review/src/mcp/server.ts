#!/usr/bin/env node
import { BazaarClient, BazaarError } from "../bazaar"

interface JsonRpcMessage {
  jsonrpc?: "2.0"
  id?: string | number | null
  method?: string
  params?: any
  result?: any
  error?: any
}

interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

const client = new BazaarClient({
  bzrPath: process.env.BZR_PATH || "bzr",
  maxBuffer: Number(process.env.BZR_MAX_BUFFER || 10 * 1024 * 1024)
})

const tools: ToolDef[] = [
  {
    name: "bazaar_root",
    description: "Return the Bazaar repository root for a working directory.",
    inputSchema: objectSchema({ cwd: stringProp("Working directory inside the Bazaar repository") }, ["cwd"])
  },
  {
    name: "bazaar_revno",
    description: "Return the current Bazaar revno for a repository.",
    inputSchema: objectSchema({ cwd: stringProp("Bazaar repository root or child directory") }, ["cwd"])
  },
  {
    name: "bazaar_log",
    description: "Return Bazaar log output. When revision is supplied, returns that revision log.",
    inputSchema: objectSchema({ cwd: stringProp("Bazaar repository root"), revision: optionalStringProp("Optional Bazaar revision") }, ["cwd"])
  },
  {
    name: "bazaar_diff_revision",
    description: "Return unified diff for a single Bazaar revision, equivalent to bzr diff -c REV.",
    inputSchema: objectSchema({ cwd: stringProp("Bazaar repository root"), revision: stringProp("Bazaar revision to review") }, ["cwd", "revision"])
  },
  {
    name: "bazaar_diff_range",
    description: "Return unified diff between two Bazaar revisions, equivalent to bzr diff -r BASE..TARGET.",
    inputSchema: objectSchema({ cwd: stringProp("Bazaar repository root"), baseRevision: stringProp("Base Bazaar revision"), targetRevision: stringProp("Target Bazaar revision") }, ["cwd", "baseRevision", "targetRevision"])
  },
  {
    name: "bazaar_diff_working_tree",
    description: "Return unified diff for the current working tree, optionally since a base revision.",
    inputSchema: objectSchema({ cwd: stringProp("Bazaar repository root"), baseRevision: optionalStringProp("Optional base Bazaar revision") }, ["cwd"])
  },
  {
    name: "bazaar_cat_revision",
    description: "Return a file's content at a Bazaar revision, equivalent to bzr cat -r REV PATH.",
    inputSchema: objectSchema({ cwd: stringProp("Bazaar repository root"), revision: stringProp("Bazaar revision"), path: stringProp("Repository-relative file path") }, ["cwd", "revision", "path"])
  },
  {
    name: "bazaar_status",
    description: "Return Bazaar status for a repository.",
    inputSchema: objectSchema({ cwd: stringProp("Bazaar repository root") }, ["cwd"])
  }
]

const reader = new McpStdioReader(async (message) => {
  if (!message.method) return
  try {
    if (message.method === "initialize") {
      respond(message.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "bob-bazaar-review", version: "0.1.0" }
      })
      return
    }

    if (message.method === "notifications/initialized") {
      return
    }

    if (message.method === "tools/list") {
      respond(message.id, { tools })
      return
    }

    if (message.method === "tools/call") {
      const result = await callTool(message.params?.name, message.params?.arguments ?? {})
      respond(message.id, result)
      return
    }

    respondError(message.id, -32601, `Method not found: ${message.method}`)
  } catch (error: any) {
    respond(message.id, {
      isError: true,
      content: [{ type: "text", text: formatError(error) }]
    })
  }
})

process.stdin.on("data", (chunk) => reader.push(chunk))
process.stdin.on("error", (error) => {
  process.stderr.write(`stdin error: ${String(error)}\n`)
})

async function callTool(name: string, args: any): Promise<any> {
  switch (name) {
    case "bazaar_root":
      return text(await client.root(requiredString(args, "cwd")))
    case "bazaar_revno":
      return text(await client.revno(requiredString(args, "cwd")))
    case "bazaar_log":
      return commandText(await client.log(requiredString(args, "cwd"), optionalString(args, "revision")))
    case "bazaar_diff_revision":
      return commandText(await client.diffRevision(requiredString(args, "cwd"), requiredString(args, "revision")))
    case "bazaar_diff_range":
      return commandText(await client.diffRange(requiredString(args, "cwd"), requiredString(args, "baseRevision"), requiredString(args, "targetRevision")))
    case "bazaar_diff_working_tree":
      return commandText(await client.diffWorkingTree(requiredString(args, "cwd"), optionalString(args, "baseRevision")))
    case "bazaar_cat_revision":
      return commandText(await client.cat(requiredString(args, "cwd"), requiredString(args, "revision"), requiredString(args, "path")))
    case "bazaar_status":
      return commandText(await client.status(requiredString(args, "cwd")))
    default:
      throw new BazaarError(`Unknown Bazaar MCP tool: ${name}`)
  }
}

function commandText(result: { stdout: string; stderr: string; command: string; args: string[]; cwd: string }): any {
  const body = [
    `cwd: ${result.cwd}`,
    `command: ${result.command} ${result.args.join(" ")}`,
    result.stderr.trim() ? `stderr:\n${result.stderr}` : "",
    result.stdout
  ].filter(Boolean).join("\n\n")
  return text(body)
}

function text(value: string): any {
  return { content: [{ type: "text", text: value }] }
}

function respond(id: JsonRpcMessage["id"], result: any): void {
  if (id === undefined) return
  write({ jsonrpc: "2.0", id, result })
}

function respondError(id: JsonRpcMessage["id"], code: number, message: string): void {
  if (id === undefined) return
  write({ jsonrpc: "2.0", id, error: { code, message } })
}

function write(message: JsonRpcMessage): void {
  const payload = Buffer.from(JSON.stringify(message), "utf8")
  process.stdout.write(`Content-Length: ${payload.byteLength}\r\n\r\n`)
  process.stdout.write(payload)
}

function requiredString(args: any, name: string): string {
  const value = args?.[name]
  if (typeof value !== "string" || !value.trim()) {
    throw new BazaarError(`Missing required string argument: ${name}`)
  }
  return value
}

function optionalString(args: any, name: string): string | undefined {
  const value = args?.[name]
  if (value === undefined || value === null || value === "") {
    return undefined
  }
  if (typeof value !== "string") {
    throw new BazaarError(`Expected string argument: ${name}`)
  }
  return value
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`
  }
  return String(error)
}

function objectSchema(properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false }
}

function stringProp(description: string): Record<string, unknown> {
  return { type: "string", description }
}

function optionalStringProp(description: string): Record<string, unknown> {
  return { type: "string", description }
}

class McpStdioReader {
  private buffer = Buffer.alloc(0)

  constructor(private readonly onMessage: (message: JsonRpcMessage) => void | Promise<void>) {}

  push(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])

    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n")
      if (headerEnd === -1) return

      const header = this.buffer.slice(0, headerEnd).toString("utf8")
      const contentLength = parseContentLength(header)
      if (contentLength === undefined) {
        this.buffer = this.buffer.slice(headerEnd + 4)
        continue
      }

      const bodyStart = headerEnd + 4
      const bodyEnd = bodyStart + contentLength
      if (this.buffer.length < bodyEnd) return

      const body = this.buffer.slice(bodyStart, bodyEnd).toString("utf8")
      this.buffer = this.buffer.slice(bodyEnd)

      void Promise.resolve(this.onMessage(JSON.parse(body))).catch((error) => {
        process.stderr.write(`message handling error: ${formatError(error)}\n`)
      })
    }
  }
}

function parseContentLength(header: string): number | undefined {
  for (const line of header.split(/\r?\n/)) {
    const match = /^Content-Length:\s*(\d+)$/i.exec(line.trim())
    if (match) {
      return Number(match[1])
    }
  }
  return undefined
}
