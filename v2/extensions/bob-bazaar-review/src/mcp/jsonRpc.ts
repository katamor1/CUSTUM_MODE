export interface JsonRpcMessage {
  jsonrpc?: "2.0"
  id?: string | number | null
  method?: string
  params?: unknown
  result?: unknown
  error?: unknown
}

export function respond(id: JsonRpcMessage["id"], result: unknown): void {
  if (id === undefined) return
  write({ jsonrpc: "2.0", id, result })
}

export function respondError(id: JsonRpcMessage["id"], code: number, message: string): void {
  if (id === undefined) return
  write({ jsonrpc: "2.0", id, error: { code, message } })
}

function write(message: JsonRpcMessage): void {
  const payload = Buffer.from(JSON.stringify(message), "utf8")
  process.stdout.write(`Content-Length: ${payload.byteLength}\r\n\r\n`)
  process.stdout.write(payload)
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`
  }
  return String(error)
}

export class McpStdioReader {
  private buffer = Buffer.alloc(0)
  private remainingOversizedBodyBytes = 0

  constructor(
    private readonly onMessage: (message: JsonRpcMessage) => void | Promise<void>,
    private readonly maxRequestBytes: number,
    private readonly onProtocolError: (code: number, message: string) => void = (code, message) => respondError(null, code, message)
  ) {}

  push(chunk: Buffer): void {
    if (this.remainingOversizedBodyBytes > 0) {
      if (chunk.length <= this.remainingOversizedBodyBytes) {
        this.remainingOversizedBodyBytes -= chunk.length
        return
      }
      chunk = chunk.slice(this.remainingOversizedBodyBytes)
      this.remainingOversizedBodyBytes = 0
    }

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
      if (contentLength > this.maxRequestBytes) {
        this.rejectOversizedRequest(bodyStart, contentLength)
        continue
      }
      if (this.buffer.length < bodyEnd) return

      const body = this.buffer.slice(bodyStart, bodyEnd).toString("utf8")
      this.buffer = this.buffer.slice(bodyEnd)

      let message: JsonRpcMessage
      try {
        message = JSON.parse(body)
      } catch (error) {
        this.onProtocolError(-32700, `Parse error: ${formatError(error)}`)
        continue
      }

      void Promise.resolve(this.onMessage(message)).catch((error) => {
        process.stderr.write(`message handling error: ${formatError(error)}\n`)
      })
    }
  }

  private rejectOversizedRequest(bodyStart: number, contentLength: number): void {
    const availableBodyBytes = Math.max(0, this.buffer.length - bodyStart)
    const bytesToDiscardNow = Math.min(contentLength, availableBodyBytes)
    this.buffer = this.buffer.slice(bodyStart + bytesToDiscardNow)
    this.remainingOversizedBodyBytes = contentLength - bytesToDiscardNow
    this.onProtocolError(-32000, `Content-Length ${contentLength} exceeds maximum ${this.maxRequestBytes} bytes.`)
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
