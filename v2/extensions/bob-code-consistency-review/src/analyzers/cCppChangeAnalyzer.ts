import * as fs from "node:fs/promises"
import * as path from "node:path"
import { classifyLanguageFromPath, isCLikeLanguage } from "../core/languageClassifier"
import { normalizeChangedFilePathStrict, pathExists, readTextFile, resolveWorkspacePathStrict, toPosixPath } from "../core/fileSystem"
import type { CodeAnalysisResult } from "../core/analysisTypes"
import type { DiffSummary } from "../core/diffTypes"
import type { EvidenceRef } from "../core/documentTypes"
import type { ReviewInput } from "../core/reviewTypes"
import { renderCodeSlice, renderSummary } from "./cCppAnalysisRenderer"
import { changedIdentifierTokens, diffLinesForFile, parseUnifiedDiff } from "./cCppDiffParser"
import {
  changedRanges,
  detectCallees,
  detectDirectCallers,
  detectFunctions,
  detectGlobalCandidates,
  detectRtForbidden,
  escapeRegExp
} from "./cCppSymbolDetector"

type AnalyzeCppChangesOptions = { workspaceRoot: string; textEncoding?: string }
type SourceResolution = { filePath?: string; warning?: string }

export async function analyzeCppChanges(
  diff: DiffSummary,
  reviewInput: ReviewInput,
  options: AnalyzeCppChangesOptions
): Promise<CodeAnalysisResult> {
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
  const sourceRoot = resolveSourceRoot(diff.vcsRoot, options.workspaceRoot, warnings)
  let functionIndex = 1
  let codeEvidenceIndex = 1
  let cLikeFileSeen = false

  for (const file of diff.files) {
    const language = file.language ?? classifyLanguageFromPath(file.path)
    if (!isCLikeLanguage(language)) continue
    cLikeFileSeen = true
    const resolved = await resolveSourceFile(sourceRoot, file.path)
    if (!resolved.filePath) {
      warnings.push(resolved.warning ?? `変更された C/C++ ファイルがワークスペース内で見つかりません: ${file.path}`)
      continue
    }

    const source = await readTextFile(resolved.filePath, options.textEncoding)
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
      for (const callee of callees) {
        callGraph.push({
          from: range.name,
          to: callee,
          confidence: "high",
          reason: "direct call in changed function"
        })
      }
      for (const caller of callers) {
        callGraph.push({
          from: caller,
          to: range.name,
          confidence: "high",
          reason: "direct call to changed function in changed file"
        })
      }

      const ref = `${toPosixPath(file.path)}:${range.start}-${range.end}`
      const markdown = renderCodeSlice(evidenceId, file.path, range, fileDiffLines)
      codeSlices.push({
        evidence_id: evidenceId,
        file: toPosixPath(file.path),
        ref,
        functionName: range.name,
        markdown,
        text: range.body.join("\n")
      })
      evidence.push({
        evidence_id: evidenceId,
        type: "code",
        ref,
        source: toPosixPath(file.path),
        location: `${range.name}:${range.start}-${range.end}`,
        text: range.body.join("\n")
      })
      changedSymbols.push({
        id: functionId,
        name: range.name,
        kind: "function",
        file: toPosixPath(file.path),
        confidence: "high",
        change_type: file.status,
        line_after: `${range.start}-${range.end}`,
        evidence_id: evidenceId
      })
      functions.push({
        id: functionId,
        name: range.name,
        file: toPosixPath(file.path),
        line_after: `${range.start}-${range.end}`,
        evidence_id: evidenceId,
        callees,
        callers
      })
    }

    for (const candidate of detectRtForbidden(fileDiffLines, file.path)) rtForbiddenCandidates.push(candidate)
  }

  if (cLikeFileSeen && changedSymbols.length === 0) warnings.push("VCS 差分から変更 C/C++ 関数を特定できませんでした。")

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

async function resolveSourceFile(workspaceRoot: string, filePath: string): Promise<SourceResolution> {
  let normalizedPath: string
  try {
    normalizedPath = normalizeChangedFilePathStrict(filePath)
  } catch (error) {
    return { warning: error instanceof Error ? error.message : `changed file path escapes workspace: ${filePath}` }
  }
  const direct = resolveWorkspacePathStrict(workspaceRoot, normalizedPath, "changed file path")
  if (await pathExists(direct)) return { filePath: direct }
  const basename = path.basename(normalizedPath)
  const candidates = await findFilesByBasename(workspaceRoot, basename, 2000)
  if (candidates.length === 1) return { filePath: candidates[0] }
  if (candidates.length > 1) {
    const candidateList = candidates.map((candidate) => toPosixPath(path.relative(workspaceRoot, candidate))).join(", ")
    return { warning: `ambiguous basename fallback for ${toPosixPath(normalizedPath)}: ${candidateList}` }
  }
  return {}
}

function resolveSourceRoot(vcsRoot: string | undefined, workspaceRoot: string, warnings: string[]): string {
  if (!vcsRoot) return workspaceRoot
  try {
    return resolveWorkspacePathStrict(workspaceRoot, vcsRoot, "vcsRoot")
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : `vcsRoot escapes workspace: ${vcsRoot}`)
    return workspaceRoot
  }
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
      if (entry.name === ".git" || entry.name === ".bzr" || entry.name === "node_modules" || entry.name === "out" || entry.name === "dist") continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isFile() && entry.name === basename) result.push(fullPath)
      else if (entry.isDirectory()) await visit(fullPath)
      if (result.length >= limit) return
    }
  }
  await visit(root)
  return result.sort((left, right) => left.localeCompare(right))
}
