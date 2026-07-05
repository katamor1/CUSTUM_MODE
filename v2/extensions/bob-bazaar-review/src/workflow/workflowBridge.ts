export interface BazaarReviewContextResult {
  status: "ok"
  workspacePath: string
  mode: "singleRevision" | "revisionRange" | "workingTreeSinceRevision" | string
  target: string
  revision?: string
  baseRevision?: string
  targetRevision?: string
  revno?: string
  author?: string
  committer?: string
  timestamp?: string
  message?: string
  changedFiles: Array<{ path: string; status: string }>
  packetBytes: number
  packetSummary: string
}

export function buildReviewContextResult(packet: string, options: { workspacePath?: string } = {}): BazaarReviewContextResult {
  const metadata = parsePacketMetadata(packet)
  return {
    status: "ok",
    workspacePath: options.workspacePath ?? metadata["repository root"] ?? "",
    mode: metadata["review mode"] ?? "unknown",
    target: metadata["revision target"] ?? metadata.target ?? "",
    revision: metadata.revision,
    baseRevision: metadata.base_revision,
    targetRevision: metadata.target_revision,
    revno: metadata.revno,
    author: metadata.author,
    committer: metadata.committer,
    timestamp: metadata.timestamp,
    message: parsePacketMessage(packet),
    changedFiles: parsePacketChangedFiles(packet),
    packetBytes: Buffer.byteLength(packet, "utf8"),
    packetSummary: "Review packet has already been added to Bob context. Use the packet in context for full diff details."
  }
}

function parsePacketMetadata(packet: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of packet.split(/\r?\n/)) {
    const header = line.match(/^(VCS|Repository root|Review mode|Revision target):\s*(.+)$/)
    if (header) {
      result[header[1].toLowerCase()] = header[2].trim()
      continue
    }
    const item = line.match(/^-\s+([A-Za-z0-9_ -]+):\s*(.+)$/)
    if (item) result[item[1].trim().toLowerCase().replace(/[ -]/g, "_")] = item[2].trim()
  }
  return result
}

function parsePacketMessage(packet: string): string | undefined {
  const lines = packet.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    if (!isMessageHeading(lines[index])) continue
    let cursor = index + 1
    while (cursor < lines.length && !lines[cursor].trim()) cursor += 1
    if (!/^```text\s*$/i.test(lines[cursor] ?? "")) return undefined
    const messageLines: string[] = []
    for (cursor += 1; cursor < lines.length; cursor += 1) {
      if (/^```\s*$/.test(lines[cursor])) break
      messageLines.push(lines[cursor])
    }
    return messageLines.join("\n").trim() || undefined
  }
  return undefined
}

function parsePacketChangedFiles(packet: string): Array<{ path: string; status: string }> {
  const lines = packet.split(/\r?\n/)
  const result: Array<{ path: string; status: string }> = []
  let inChangedFiles = false
  for (const line of lines) {
    if (isChangedFilesHeading(line)) {
      inChangedFiles = true
      continue
    }
    if (inChangedFiles && /^#{1,3}\s+/.test(line)) break
    const match = inChangedFiles ? line.match(/^-\s+([^:]+):\s+(.+)$/) : undefined
    if (match) result.push({ status: match[1].trim(), path: match[2].trim() })
  }
  return result
}

function isMessageHeading(line: string): boolean {
  return /^###\s+(?:Message|メッセージ)\s*\/\s*status\s*$/i.test(line)
}

function isChangedFilesHeading(line: string): boolean {
  return /^###\s+(?:Changed files|変更ファイル)\s*$/i.test(line)
}
