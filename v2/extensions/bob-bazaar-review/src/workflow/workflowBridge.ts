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

export function buildReviewContextResult(packet: string): BazaarReviewContextResult {
  const metadata = parsePacketMetadata(packet)
  return {
    status: "ok",
    workspacePath: metadata["repository root"] ?? "",
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
  const match = packet.match(/^###\s+Message \/ status\s*$(?:\r?\n)+```text\r?\n([\s\S]*?)\r?\n```/im)
  return match?.[1]?.trim() || undefined
}

function parsePacketChangedFiles(packet: string): Array<{ path: string; status: string }> {
  const lines = packet.split(/\r?\n/)
  const result: Array<{ path: string; status: string }> = []
  let inChangedFiles = false
  for (const line of lines) {
    if (/^###\s+Changed files\s*$/i.test(line)) {
      inChangedFiles = true
      continue
    }
    if (inChangedFiles && /^#{1,3}\s+/.test(line)) break
    const match = inChangedFiles ? line.match(/^-\s+([^:]+):\s+(.+)$/) : undefined
    if (match) result.push({ status: match[1].trim(), path: match[2].trim() })
  }
  return result
}
