import * as path from "node:path"
import YAML from "yaml"
import { pathExists, readTextFile, resolveWorkspacePathForKind, resolveWorkspacePathStrict, writeTextFile } from "./fileSystem"
import { canonicalizeBobOutputWithReport, type CanonicalizationIssue, type EvidenceIndexItem, type EvidenceLookup } from "./bobOutputCanonicalizer"
import { validateParsedBobOutput } from "./bobOutputValidator"
import { extractSingleYamlDocumentText } from "./structuredTextExtractor"
import type { ValidationReport } from "./validationTypes"

export type CaptureBobOutputResult = {
  status: "ok" | "error"
  bobOutputPath?: string
  rawOutputPath?: string
  canonicalOutputPath?: string
  sourcePath?: string
  reviewId?: string
  rawValidation?: ValidationReport
  canonicalValidation?: ValidationReport
  canonicalizationIssues?: CanonicalizationIssue[]
  message: string
}

type CaptureBobOutputInput = {
  workspaceRoot: string
  text: string
  bobOutputPath: string
  packageDir?: string
}

type CaptureSourceResult = {
  yamlText?: string
  sourcePath?: string
  message: string
}

export async function captureBobOutput(input: CaptureBobOutputInput): Promise<CaptureBobOutputResult> {
  const bobOutputPath = resolveWorkspacePathForKind(input.workspaceRoot, input.bobOutputPath, "bob-output")
  const packageDir = input.packageDir ? resolveWorkspacePathStrict(input.workspaceRoot, input.packageDir, "reviewPackagePath") : undefined
  const resolvedInput = { ...input, bobOutputPath, packageDir }
  const source = await resolveCaptureSource(resolvedInput)
  if (!source.yamlText) return { status: "error", message: source.message }

  let parsed: any
  try {
    parsed = YAML.parse(source.yamlText)
  } catch (error) {
    const sourceLabel = source.sourcePath ? ` (${source.sourcePath})` : ""
    return { status: "error", message: `YAML が不正です${sourceLabel}: ${error instanceof Error ? error.message : String(error)}` }
  }
  const evidenceLookup = await loadEvidenceLookup(packageDir)
  const rawValidation = await validateParsedBobOutput(parsed, { packageDir, requireEvidenceIndex: Boolean(packageDir) })
  const canonicalized = canonicalizeBobOutputWithReport(parsed, evidenceLookup)
  const canonical = canonicalized.output
  const canonicalValidation = await validateParsedBobOutput(canonical, { packageDir, requireEvidenceIndex: Boolean(packageDir) })
  const rawValidationIssues = rawValidation.errors.map((message): CanonicalizationIssue => ({
    severity: "warning",
    path: "$",
    code: "raw_validation_error",
    message
  }))
  const canonicalizationIssues = [...rawValidationIssues, ...canonicalized.report.issues]
  const normalized = `${YAML.stringify(canonical)}`
  const rawOutputPath = path.join(path.dirname(bobOutputPath), "raw-output.yaml")
  const canonicalOutputPath = path.join(path.dirname(bobOutputPath), "canonical-output.yaml")
  await writeTextFile(rawOutputPath, ensureTrailingNewline(source.yamlText))
  await writeTextFile(canonicalOutputPath, normalized)
  await writeTextFile(bobOutputPath, normalized)
  return {
    status: "ok",
    bobOutputPath: path.resolve(bobOutputPath),
    rawOutputPath: path.resolve(rawOutputPath),
    canonicalOutputPath: path.resolve(canonicalOutputPath),
    sourcePath: source.sourcePath,
    reviewId: canonical?.review_summary?.review_id,
    rawValidation,
    canonicalValidation,
    canonicalizationIssues,
    message: `Bob 出力を保存しました: ${bobOutputPath}${source.sourcePath ? ` (source: ${source.sourcePath})` : ""}${rawValidation.errors.length > 0 ? ` (raw validation warning: ${rawValidation.errors.length})` : ""}`
  }
}

async function resolveCaptureSource(input: CaptureBobOutputInput): Promise<CaptureSourceResult> {
  let textYaml: string | undefined
  try {
    textYaml = extractYamlFromText(input.text)
  } catch (error) {
    return { message: `Bob output YAML extraction failed: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (textYaml) return { yamlText: textYaml, message: "Bob output was read from command text." }

  return {
    message: "Bob 出力内に YAML オブジェクトが見つかりませんでした。Bob output YAML not found in command text; review-package/bob-output.yaml fallback is disabled."
  }
}

export function extractYamlFromText(text: string): string | undefined {
  return extractSingleYamlDocumentText(text, { label: "Bob output YAML text" })
}

function ensureTrailingNewline(text: string): string {
  return `${text.trimEnd()}\n`
}

async function loadEvidenceLookup(packageDir: string | undefined): Promise<EvidenceLookup | undefined> {
  if (!packageDir) return undefined
  const evidencePath = path.join(packageDir, "evidence-index.json")
  if (!(await pathExists(evidencePath))) return undefined
  const parsed = JSON.parse(await readTextFile(evidencePath)) as { evidence?: EvidenceIndexItem[] }
  const byId = new Map<string, EvidenceIndexItem>()
  const byRef = new Map<string, EvidenceIndexItem>()
  for (const item of parsed.evidence ?? []) {
    if (item.evidence_id) byId.set(item.evidence_id, item)
    if (item.ref) byRef.set(item.ref, item)
  }
  return { byId, byRef }
}
