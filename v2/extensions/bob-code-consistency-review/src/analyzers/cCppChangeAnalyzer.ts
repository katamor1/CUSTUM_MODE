import * as fs from "node:fs/promises"
import * as path from "node:path"
import { languageFromPath } from "../core/gitDiffCollector"
import { pathExists, resolveWorkspacePath, toPosixPath } from "../core/fileSystem"
import type { CodeAnalysisResult, DiffSummary, EvidenceRef, ReviewInput } from "../core/types"

type FunctionRange = { name: string; start: number; end: number; body: string[] }
type DiffLine = { file: string; line: number; text: string; kind: "add" | "delete" }

const C_LIKE_LANGUAGES = new Set(["c", "cpp", "h", "hpp"])
const CALL_EXCLUDES = new Set(["if", "for", "while", "switch", "return", "sizeof", "case"])
const RT_FORBIDDEN = ["fopen", "fread", "fwrite", "fprintf", "printf", "scanf", "sleep", "Sleep", "malloc", "free", "system"]

export async function analyzeCppChanges(diff: DiffSummary, reviewInput: ReviewInput, options: { workspaceRoot: string }): Promise<CodeAnalysisResult> {
  const warnings: string[] = []
  const changedSymbols: CodeAnalysisResult["changedSymbols"] = []
  const functions: CodeAnalysisResult["functions"] = []
  const callGraph: CodeAnalysisResult["callGraph"] = []
  const rtForbiddenCandidates: CodeAnalysisResult["rtForbiddenCandidates"] = []
  const codeSlices: CodeAnalysisResult["codeSlices"] = []
  const evidence: EvidenceRef[] = []
  const defines = new Set<string>()
  const globals = new Set<string>()
  const diffLines = parseUnifiedDiff(diff)
  const changedTokens = changedIdentifierTokens(diffLines)
  let functionIndex = 1
  let codeEvidenceIndex = 1

  for (const file of diff.files) {
    const language = file.language ?? languageFromPath(file.path)
    if (!C_LIKE_LANGUAGES.has(language)) continue
    const resolved = await resolveSourceFile(options.workspaceRoot, file.path)
    if (!resolved) {
      warnings.push(`changed C/C++ file not found in workspace: ${file.path}`)
      continue
    }

    const source = await fs.readFile(resolved, "utf8")
    const lines = source.split(/\r?\n/)
    const ranges = detectFunctions(lines)
    const fileDiffLines = diffLinesForFile(diffLines, file.path)
    for (const token of changedTokens) {
      if (new RegExp(`^\\s*#\\s*define\\s+${escapeRegExp(token)}\\b`, "m").test(source)) defines.add(token)
    }
    for (const globalName of detectGlobalCandidates(lines, changedTokens)) globals.add(globalName)

    for (const range of changedRanges(ranges, fileDiffLines)) {
      const functionId = `FUNC-${String(functionIndex++).padStart(4, "0")}`
      const evidenceId = `SRC-${String(codeEvidenceIndex++).padStart(4, "0")}`
      const callees = detectCallees(range.body.join("\n"), range.name)
      const callers = detectDirectCallers(ranges, range.name)
      for (const callee of callees) callGraph.push({ from: range.name, to: callee, confidence: "high", reason: "direct call in changed function" })
      for (const caller of callers) callGraph.push({ from: caller, to: range.name, confidence: "high", reason: "direct call to changed function in changed file" })

      const ref = `${toPosixPath(file.path)}:${range.start}-${range.end}`
      const markdown = renderCodeSlice(evidenceId, file.path, range, fileDiffLines)
      codeSlices.push({ evidence_id: evidenceId, file: toPosixPath(file.path), ref, functionName: range.name, markdown, text: range.body.join("\n") })
      evidence.push({ evidence_id: evidenceId, type: "code", ref, source: toPosixPath(file.path), location: `${range.name}:${range.start}-${range.end}`, text: range.body.join("\n") })
      changedSymbols.push({ id: functionId, name: range.name, kind: "function", file: toPosixPath(file.path), confidence: "high", change_type: file.status, line_after: `${range.start}-${range.end}`, evidence_id: evidenceId })
      functions.push({ id: functionId, name: range.name, file: toPosixPath(file.path), line_after: `${range.start}-${range.end}`, evidence_id: evidenceId, callees, callers })
    }

    for (const candidate of detectRtForbidden(fileDiffLines, file.path)) rtForbiddenCandidates.push(candidate)
  }

  if (changedSymbols.length === 0) warnings.push("No changed C/C++ function could be mapped from diff hunks.")

  const summaryMarkdown = renderSummary(changedSymbols, defines, globals, callGraph, rtForbiddenCandidates, reviewInput)
  return {
    changedSymbols,
    functions,
    defines: Array.from(defines).sort(),
    globals: Array.from(globals).sort(),
    callGraph,
    rtForbiddenCandidates,
    codeSlices,
    evidence,
    summaryMarkdown,
    warnings
  }
}

function parseUnifiedDiff(diff: DiffSummary): DiffLine[] {
  const result: DiffLine[] = []
  const text = diff.unifiedDiff ?? ""
  let currentFile = diff.files.length === 1 ? diff.files[0].path : ""
  let newLine = 0
  let oldLine = 0

  for (const line of text.split(/\r?\n/)) {
    const gitFile = line.match(/^diff --git a\/(.+?) b\/(.+)$/)
    if (gitFile) {
      currentFile = gitFile[2]
      continue
    }
    const plusFile = line.match(/^\+\+\+ b\/(.+)$/)
    if (plusFile) {
      currentFile = plusFile[1]
      continue
    }
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      continue
    }
    if (!currentFile || line.startsWith("+++ ") || line.startsWith("--- ")) continue
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

function detectFunctions(lines: string[]): FunctionRange[] {
  const ranges: FunctionRange[] = []
  let pendingSignature: { name: string; start: number; parts: string[] } | undefined
  let active: { name: string; start: number; depth: number; body: string[] } | undefined

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!active) {
      const signature = functionSignature(line)
      if (signature) pendingSignature = { name: signature, start: index + 1, parts: [line] }
      else if (pendingSignature) pendingSignature.parts.push(line)

      if (pendingSignature && line.includes("{")) {
        active = { name: pendingSignature.name, start: pendingSignature.start, depth: 0, body: [] }
        pendingSignature = undefined
      }
    }

    if (active) {
      active.body.push(line)
      active.depth += braceDelta(line)
      if (active.depth <= 0 && line.includes("}")) {
        ranges.push({ name: active.name, start: active.start, end: index + 1, body: active.body })
        active = undefined
      }
    }
  }
  return ranges
}

function functionSignature(line: string): string | undefined {
  if (/^\s*(if|for|while|switch|return)\b/.test(line)) return undefined
  if (line.includes(";")) return undefined
  const match = line.match(/^\s*(?:static\s+|inline\s+|extern\s+|const\s+|volatile\s+|unsigned\s+|signed\s+|long\s+|short\s+|struct\s+\w+\s+|enum\s+\w+\s+|[A-Za-z_][\w\s*]+?\s+)+([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:\{|$)/)
  return match?.[1]
}

function braceDelta(line: string): number {
  const stripped = line.replace(/"([^"\\]|\\.)*"/g, "\"\"").replace(/\/\/.*$/, "")
  return (stripped.match(/\{/g) ?? []).length - (stripped.match(/\}/g) ?? []).length
}

function changedRanges(ranges: FunctionRange[], diffLines: DiffLine[]): FunctionRange[] {
  const changedLineNumbers = new Set(diffLines.filter((line) => line.kind === "add").map((line) => line.line))
  const changed = ranges.filter((range) => Array.from(changedLineNumbers).some((line) => line >= range.start && line <= range.end))
  if (changed.length > 0) return changed
  const hunkFunctionNames = diffLines.flatMap((line) => functionSignature(line.text) ?? [])
  return ranges.filter((range) => hunkFunctionNames.includes(range.name))
}

function detectCallees(body: string, functionName: string): string[] {
  const result = new Set<string>()
  for (const match of body.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
    const name = match[1]
    if (name !== functionName && !CALL_EXCLUDES.has(name)) result.add(name)
  }
  return Array.from(result).sort()
}

function detectDirectCallers(ranges: FunctionRange[], functionName: string): string[] {
  return ranges
    .filter((range) => range.name !== functionName && new RegExp(`\\b${escapeRegExp(functionName)}\\s*\\(`).test(range.body.join("\n")))
    .map((range) => range.name)
    .sort()
}

function detectGlobalCandidates(lines: string[], changedTokens: Set<string>): string[] {
  const result = new Set<string>()
  let depth = 0
  for (const line of lines) {
    const global = depth === 0 ? line.match(/^\s*(?:static\s+)?(?:const\s+)?(?:int|long|short|char|bool|float|double|uint\d+_t|size_t)\s+([A-Za-z_]\w*)\b.*;/) : undefined
    if (global && (changedTokens.size === 0 || changedTokens.has(global[1]) || /g_|Count|State/i.test(global[1]))) result.add(global[1])
    depth += braceDelta(line)
  }
  return Array.from(result)
}

function detectRtForbidden(diffLines: DiffLine[], filePath: string): CodeAnalysisResult["rtForbiddenCandidates"] {
  const result: CodeAnalysisResult["rtForbiddenCandidates"] = []
  for (const line of diffLines.filter((item) => item.kind === "add")) {
    for (const symbol of RT_FORBIDDEN) {
      if (new RegExp(`\\b${escapeRegExp(symbol)}\\s*\\(`).test(line.text)) {
        result.push({ symbol, file: toPosixPath(filePath), line: line.line, reason: "rule-based RT forbidden processing candidate" })
      }
    }
  }
  return result
}

function diffLinesForFile(diffLines: DiffLine[], filePath: string): DiffLine[] {
  const normalized = toPosixPath(filePath)
  const basename = path.posix.basename(normalized)
  return diffLines.filter((line) => {
    const linePath = toPosixPath(line.file)
    return normalized.endsWith(linePath) || linePath.endsWith(normalized) || path.posix.basename(linePath) === basename
  })
}

function changedIdentifierTokens(diffLines: DiffLine[]): Set<string> {
  const result = new Set<string>()
  for (const line of diffLines) {
    for (const match of line.text.matchAll(/\b[A-Z][A-Z0-9_]{2,}\b/g)) result.add(match[0])
    for (const match of line.text.matchAll(/\bg_[A-Za-z0-9_]+\b/g)) result.add(match[0])
  }
  return result
}

async function resolveSourceFile(workspaceRoot: string, filePath: string): Promise<string | undefined> {
  const direct = resolveWorkspacePath(workspaceRoot, filePath)
  if (await pathExists(direct)) return direct
  const basename = path.basename(filePath)
  const candidates = await findFilesByBasename(workspaceRoot, basename, 2000)
  return candidates[0]
}

async function findFilesByBasename(root: string, basename: string, limit: number): Promise<string[]> {
  const result: string[] = []
  async function visit(dir: string): Promise<void> {
    if (result.length >= limit) return
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "out" || entry.name === "dist") continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isFile() && entry.name === basename) result.push(fullPath)
      else if (entry.isDirectory()) await visit(fullPath)
      if (result.length >= limit) return
    }
  }
  await visit(root)
  return result
}

function renderCodeSlice(evidenceId: string, filePath: string, range: FunctionRange, diffLines: DiffLine[]): string {
  const changed = diffLines.filter((line) => line.line >= range.start && line.line <= range.end)
  return [
    `## ${evidenceId} ${toPosixPath(filePath)}`,
    "",
    `- function: ${range.name}`,
    `- lines: ${range.start}-${range.end}`,
    "",
    "### Function body",
    "",
    "```c",
    ...range.body,
    "```",
    "",
    "### Changed lines",
    "",
    "```diff",
    ...changed.map((line) => `${line.kind === "add" ? "+" : "-"}${line.text}`),
    "```",
    ""
  ].join("\n")
}

function renderSummary(
  symbols: CodeAnalysisResult["changedSymbols"],
  defines: Set<string>,
  globals: Set<string>,
  callGraph: CodeAnalysisResult["callGraph"],
  rtForbiddenCandidates: CodeAnalysisResult["rtForbiddenCandidates"],
  reviewInput: ReviewInput
): string {
  return [
    "## C/C++ 変更解析サマリ",
    "",
    `- review_focus: ${reviewInput.review_focus.join(", ")}`,
    `- changed functions: ${symbols.filter((symbol) => symbol.kind === "function").length}`,
    `- define candidates: ${defines.size}`,
    `- global candidates: ${globals.size}`,
    `- direct call candidates: ${callGraph.length}`,
    `- RT forbidden candidates: ${rtForbiddenCandidates.length}`,
    "",
    "### 変更シンボル",
    "",
    ...symbols.map((symbol) => `- ${symbol.id}: ${symbol.name} (${symbol.kind}) ${symbol.file}${symbol.line_after ? `:${symbol.line_after}` : ""}`),
    "",
    "### 注意が必要な候補",
    "",
    ...rtForbiddenCandidates.map((candidate) => `- ${candidate.symbol}: ${candidate.file}${candidate.line ? `:${candidate.line}` : ""} ${candidate.reason}`)
  ].join("\n")
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
