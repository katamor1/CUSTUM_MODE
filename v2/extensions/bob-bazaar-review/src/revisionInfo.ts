import { BazaarClient, BazaarCommandResult } from "./bazaar"

export type BazaarChangedFileStatus = "added" | "modified" | "removed" | "renamed" | "unknown"

export interface BazaarChangedFile {
  path: string
  status: BazaarChangedFileStatus
}

export interface BazaarRevisionInfo {
  revision: string
  revno?: string
  author: string
  committer: string
  timestamp: string
  message: string
  changedFileCount: number
  changedFiles: string[]
  changedFileEntries: BazaarChangedFile[]
  logText: string
}

export interface BazaarRevisionPacketInput {
  root: string
  revision: string
  log: BazaarCommandResult
  diff: BazaarCommandResult
  info: BazaarRevisionInfo
}

export async function loadBazaarRevisionPacketInput(client: BazaarClient, workspacePath: string, revision: string): Promise<BazaarRevisionPacketInput> {
  const root = await client.root(workspacePath)
  const [log, diff] = await Promise.all([
    client.log(root, revision),
    client.diffRevision(root, revision)
  ])
  const info = parseBazaarRevisionInfo(revision, log.stdout, diff.stdout)
  return { root, revision, log, diff, info }
}

export function parseBazaarRevisionInfo(revision: string, logText: string, diffText: string): BazaarRevisionInfo {
  const metadata = parseLogMetadata(logText)
  const changedFileEntries = parseChangedFileEntries(diffText)
  const changedFiles = changedFileEntries.map((entry) => entry.path)
  return {
    revision,
    revno: metadata.revno,
    author: metadata.author || metadata.committer || "unknown",
    committer: metadata.committer || metadata.author || "unknown",
    timestamp: metadata.timestamp || "unknown",
    message: metadata.message || "",
    changedFileCount: changedFiles.length,
    changedFiles,
    changedFileEntries,
    logText
  }
}

export async function buildAddedFilesContentSection(
  client: BazaarClient,
  root: string,
  revision: string,
  info: BazaarRevisionInfo,
  maxBytes = 256 * 1024
): Promise<string | undefined> {
  const addedFiles = info.changedFileEntries.filter((entry) => entry.status === "added")
  if (addedFiles.length === 0 || maxBytes <= 0) return undefined

  const lines: string[] = [
    "## Added file contents",
    "",
    "The following files are newly added in this Bazaar revision. Diff output may omit enough context for new files, so their revision content is included explicitly.",
    ""
  ]
  let remainingBytes = maxBytes
  let truncated = false

  for (const entry of addedFiles) {
    if (remainingBytes <= 0) {
      truncated = true
      break
    }

    try {
      const result = await client.cat(root, revision, entry.path)
      let content = result.stdout
      const contentBytes = Buffer.byteLength(content, "utf8")
      if (contentBytes > remainingBytes) {
        content = truncateUtf8(content, remainingBytes)
        truncated = true
      }
      remainingBytes -= Buffer.byteLength(content, "utf8")
      lines.push(`### ${entry.path}`)
      lines.push("")
      lines.push("```text")
      lines.push(content)
      lines.push("```")
      lines.push("")
    } catch (error: any) {
      lines.push(`### ${entry.path}`)
      lines.push("")
      lines.push(`Could not load added file content with Bazaar cat at revision ${revision}: ${error?.message ?? String(error)}`)
      lines.push("")
    }
  }

  if (truncated) {
    lines.push(`[TRUNCATED: added file contents exceeded ${maxBytes} bytes. Use focused read/search tools for additional context.]`)
  }

  return lines.join("\n")
}

function parseLogMetadata(logText: string): { revno?: string; author?: string; committer?: string; timestamp?: string; message?: string } {
  const lines = logText.split(/\r?\n/)
  const result: { revno?: string; author?: string; committer?: string; timestamp?: string; message?: string } = {}
  const messageLines: string[] = []
  let inMessage = false

  for (const line of lines) {
    const trimmed = line.trimEnd()
    if (/^revno:\s*/i.test(trimmed)) result.revno = trimmed.replace(/^revno:\s*/i, "").trim()
    else if (/^author:\s*/i.test(trimmed)) result.author = trimmed.replace(/^author:\s*/i, "").trim()
    else if (/^committer:\s*/i.test(trimmed)) result.committer = trimmed.replace(/^committer:\s*/i, "").trim()
    else if (/^timestamp:\s*/i.test(trimmed)) result.timestamp = trimmed.replace(/^timestamp:\s*/i, "").trim()
    else if (/^message:\s*$/i.test(trimmed)) inMessage = true
    else if (inMessage) {
      if (/^[-]{5,}$/.test(trimmed)) break
      messageLines.push(trimmed.replace(/^\s{2,}/, ""))
    }
  }

  result.message = messageLines.join("\n").trim()
  return result
}

export function parseChangedFiles(diffText: string): string[] {
  return parseChangedFileEntries(diffText).map((entry) => entry.path)
}

export function parseChangedFileEntries(diffText: string): BazaarChangedFile[] {
  const files = new Map<string, BazaarChangedFileStatus>()
  for (const line of diffText.split(/\r?\n/)) {
    let match = /^===\s+(modified|added|removed|renamed)\s+file\s+'(.+)'\s*$/.exec(line)
    if (match) {
      files.set(match[2], normalizeStatus(match[1]))
      continue
    }
    match = /^diff\s+--git\s+a\/(.+?)\s+b\/(.+?)\s*$/.exec(line)
    if (match) {
      if (!files.has(match[2])) files.set(match[2], "unknown")
      continue
    }
    match = /^\+\+\+\s+(?:b\/)?(.+?)\s*$/.exec(line)
    if (match && match[1] !== "/dev/null") {
      if (!files.has(match[1])) files.set(match[1], "unknown")
    }
  }
  return [...files.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, status]) => ({ path, status }))
}

function normalizeStatus(status: string): BazaarChangedFileStatus {
  switch (status) {
    case "added":
      return "added"
    case "modified":
      return "modified"
    case "removed":
      return "removed"
    case "renamed":
      return "renamed"
    default:
      return "unknown"
  }
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value
  let result = value
  while (Buffer.byteLength(result, "utf8") > maxBytes) {
    result = result.slice(0, Math.floor(result.length * 0.9))
  }
  return `${result}\n\n[TRUNCATED]`
}
