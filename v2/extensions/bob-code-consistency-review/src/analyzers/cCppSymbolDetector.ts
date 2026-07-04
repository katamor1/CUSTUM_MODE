import { toPosixPath } from "../core/fileSystem"
import type { CodeAnalysisResult } from "../core/analysisTypes"
import type { DiffLine } from "./cCppDiffParser"

export type FunctionRange = { name: string; start: number; end: number; body: string[] }

const CALL_EXCLUDES = new Set(["if", "for", "while", "switch", "return", "sizeof", "case"])
const RT_FORBIDDEN = ["fopen", "fread", "fwrite", "fprintf", "printf", "scanf", "sleep", "Sleep", "malloc", "free", "system"]
const FUNCTION_SIGNATURE_PATTERN = new RegExp(
  "^\\s*(?:"
    + "static\\s+|"
    + "inline\\s+|"
    + "extern\\s+|"
    + "const\\s+|"
    + "volatile\\s+|"
    + "unsigned\\s+|"
    + "signed\\s+|"
    + "long\\s+|"
    + "short\\s+|"
    + "struct\\s+\\w+\\s+|"
    + "enum\\s+\\w+\\s+|"
    + "[A-Za-z_][\\w\\s*]+?\\s+"
    + ")+([A-Za-z_]\\w*)\\s*\\([^;]*\\)\\s*(?:\\{|$)"
)
const GLOBAL_CANDIDATE_PATTERN = new RegExp(
  "^\\s*(?:static\\s+)?(?:const\\s+)?"
    + "(?:int|long|short|char|bool|float|double|uint\\d+_t|size_t)\\s+"
    + "([A-Za-z_]\\w*)\\b.*;"
)

export function detectFunctions(lines: string[]): FunctionRange[] {
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

export function changedRanges(ranges: FunctionRange[], diffLines: DiffLine[]): FunctionRange[] {
  const changedLineNumbers = new Set(diffLines.filter((line) => line.kind === "add").map((line) => line.line))
  const changed = ranges.filter((range) => Array.from(changedLineNumbers).some((line) => line >= range.start && line <= range.end))
  if (changed.length > 0) return changed
  const hunkFunctionNames = diffLines.flatMap((line) => functionSignature(line.text) ?? [])
  return ranges.filter((range) => hunkFunctionNames.includes(range.name))
}

export function detectCallees(body: string, functionName: string): string[] {
  const result = new Set<string>()
  for (const match of body.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
    const name = match[1]
    if (name !== functionName && !CALL_EXCLUDES.has(name)) result.add(name)
  }
  return Array.from(result).sort()
}

export function detectDirectCallers(ranges: FunctionRange[], functionName: string): string[] {
  return ranges
    .filter((range) => range.name !== functionName && new RegExp(`\\b${escapeRegExp(functionName)}\\s*\\(`).test(range.body.join("\n")))
    .map((range) => range.name)
    .sort()
}

export function detectGlobalCandidates(lines: string[], changedTokens: Set<string>): string[] {
  const result = new Set<string>()
  let depth = 0
  for (const line of lines) {
    const global = depth === 0 ? line.match(GLOBAL_CANDIDATE_PATTERN) : undefined
    if (global && (changedTokens.size === 0 || changedTokens.has(global[1]) || /g_|Count|State/i.test(global[1]))) result.add(global[1])
    depth += braceDelta(line)
  }
  return Array.from(result)
}

export function detectRtForbidden(diffLines: DiffLine[], filePath: string): CodeAnalysisResult["rtForbiddenCandidates"] {
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

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function functionSignature(line: string): string | undefined {
  if (/^\s*(if|for|while|switch|return)\b/.test(line)) return undefined
  if (line.includes(";")) return undefined
  const match = line.match(FUNCTION_SIGNATURE_PATTERN)
  return match?.[1]
}

function braceDelta(line: string): number {
  const stripped = line.replace(/"([^"\\]|\\.)*"/g, "\"\"").replace(/\/\/.*$/, "")
  return (stripped.match(/\{/g) ?? []).length - (stripped.match(/\}/g) ?? []).length
}
