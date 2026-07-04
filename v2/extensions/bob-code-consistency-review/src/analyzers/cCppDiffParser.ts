import * as path from "node:path"
import { toPosixPath } from "../core/fileSystem"
import type { DiffSummary } from "../core/diffTypes"

export type DiffLine = { file: string; line: number; text: string; kind: "add" | "delete" }

export function parseUnifiedDiff(diff: DiffSummary): DiffLine[] {
  const result: DiffLine[] = []
  const text = diff.unifiedDiff ?? ""
  let currentFile = diff.files.length === 1 ? diff.files[0].path : ""
  let newLine = 0
  let oldLine = 0

  for (const line of text.split(/\r?\n/)) {
    const gitFile = line.match(/^diff --git a\/(.+?) b\/(.+)$/)
    if (gitFile) {
      currentFile = normalizeDiffPath(gitFile[2])
      continue
    }
    const bzrFile = line.match(/^===\s+.+?\s+file '(.+?)'(?:\s+=>\s+'(.+)')?$/)
    if (bzrFile) {
      currentFile = normalizeDiffPath(bzrFile[2] ?? bzrFile[1])
      continue
    }
    const plusFile = line.match(/^\+\+\+\s+(.+?)(?:\t.*)?$/)
    if (plusFile && plusFile[1] !== "/dev/null") {
      currentFile = normalizeDiffPath(plusFile[1])
      continue
    }
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      continue
    }
    if (!currentFile || line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("=== ")) continue
    if (line.startsWith("+")) {
      result.push({ file: currentFile, line: newLine, text: line.slice(1), kind: "add" })
      newLine += 1
    } else if (line.startsWith("-")) {
      result.push({ file: currentFile, line: oldLine, text: line.slice(1), kind: "delete" })
      oldLine += 1
    } else {
      newLine += 1
      oldLine += 1
    }
  }
  return result
}

export function diffLinesForFile(diffLines: DiffLine[], filePath: string): DiffLine[] {
  const normalized = toPosixPath(filePath)
  const basename = path.posix.basename(normalized)
  return diffLines.filter((line) => {
    const linePath = toPosixPath(line.file)
    return normalized.endsWith(linePath) || linePath.endsWith(normalized) || path.posix.basename(linePath) === basename
  })
}

export function changedIdentifierTokens(diffLines: DiffLine[]): Set<string> {
  const result = new Set<string>()
  for (const line of diffLines) {
    for (const match of line.text.matchAll(/\b[A-Z][A-Z0-9_]{2,}\b/g)) result.add(match[0])
    for (const match of line.text.matchAll(/\bg_[A-Za-z0-9_]+\b/g)) result.add(match[0])
  }
  return result
}

function normalizeDiffPath(filePath: string): string {
  return filePath.replace(/^a\//, "").replace(/^b\//, "")
}
