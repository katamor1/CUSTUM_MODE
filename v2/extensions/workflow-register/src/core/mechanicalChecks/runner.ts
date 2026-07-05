import { execFile, type ExecFileException } from "child_process"
import * as fs from "fs/promises"
import * as path from "path"
import {
  MechanicalCheckDefinition,
  MechanicalCheckProfile,
  MechanicalCheckStatus,
  MechanicalChecksConfig
} from "./config"
import {
  MechanicalCheckEvidenceFile,
  MechanicalCheckFinding,
  MechanicalCheckMetrics,
  parseMechanicalCheckOutput
} from "./parser"

const PROFILE_RESULT_SCHEMA = "bob-mechanical-check-profile-result/v1"
const CHECK_RESULT_SCHEMA = "bob-mechanical-check-result/v1"
const MAX_OUTPUT_BYTES = 1024 * 1024

export interface RunMechanicalChecksProfileInput {
  workspaceRoot: string
  config: MechanicalChecksConfig
  profile: string
  runId?: string
  now?: () => string
}

export interface MechanicalCheckProfileResult {
  schema_version: typeof PROFILE_RESULT_SCHEMA
  run_id: string
  profile: string
  gate: string
  status: MechanicalCheckStatus
  checks_total: number
  passed: number
  warnings: number
  failed: number
  blocked: number
  started_at: string
  finished_at: string
  artifact_root: string
  summary_path: string
  result_path: string
  checks: MechanicalCheckRunResult[]
}

export interface MechanicalCheckRunResult {
  schema_version: typeof CHECK_RESULT_SCHEMA
  check_id: string
  title: string
  status: MechanicalCheckStatus
  started_at: string
  finished_at: string
  exit_code?: number
  timed_out?: boolean
  summary: string
  stdout_path: string
  stderr_path: string
  result_path: string
  metrics: MechanicalCheckMetrics
  findings: MechanicalCheckFinding[]
  evidence: Array<{ path: string; type: string }>
}

interface ProcessResult {
  exitCode?: number
  stdout: string
  stderr: string
  timedOut: boolean
  error?: string
}

export async function runMechanicalChecksProfile(input: RunMechanicalChecksProfileInput): Promise<MechanicalCheckProfileResult> {
  const workspaceRoot = path.resolve(input.workspaceRoot)
  const startedAt = timestamp(input.now)
  const runId = input.runId ?? runIdFromTimestamp(startedAt)
  const runRoot = path.join(workspaceRoot, ".bob", "mechanical-checks", "runs", runId)
  await fs.mkdir(runRoot, { recursive: true })

  const profile = input.config.profiles.find((item) => item.id === input.profile)
  if (!profile) {
    const finishedAt = timestamp(input.now)
    const result = buildProfileResult({
      runId,
      workspaceRoot,
      runRoot,
      profile: { id: input.profile, title: input.profile, gate: "", checks: [] },
      checks: [],
      startedAt,
      finishedAt,
      status: "blocked"
    })
    await writeProfileArtifacts(runRoot, result)
    return result
  }

  const checksById = new Map(input.config.checks.map((check) => [check.id, check]))
  const checks: MechanicalCheckRunResult[] = []
  for (const checkId of profile.checks) {
    const check = checksById.get(checkId)
    checks.push(check
      ? await runMechanicalCheck({ workspaceRoot, runRoot, check, now: input.now })
      : missingCheckResult(runRoot, checkId, timestamp(input.now), timestamp(input.now)))
  }
  const finishedAt = timestamp(input.now)
  const result = buildProfileResult({ runId, workspaceRoot, runRoot, profile, checks, startedAt, finishedAt })
  await writeProfileArtifacts(runRoot, result)
  return result
}

async function runMechanicalCheck(input: {
  workspaceRoot: string
  runRoot: string
  check: MechanicalCheckDefinition
  now?: () => string
}): Promise<MechanicalCheckRunResult> {
  const { workspaceRoot, runRoot, check } = input
  const startedAt = timestamp(input.now)
  const checkRoot = path.join(runRoot, "checks", check.id)
  await fs.mkdir(checkRoot, { recursive: true })
  const stdoutPath = path.join(checkRoot, "stdout.log")
  const stderrPath = path.join(checkRoot, "stderr.log")
  const resultPath = path.join(checkRoot, "result.json")

  const commandPath = resolveWorkspacePath(workspaceRoot, check.command)
  const cwdPath = resolveWorkspacePath(workspaceRoot, check.cwd)
  const commandExists = commandPath ? await fileExists(commandPath) : false
  const cwdExists = cwdPath ? await directoryExists(cwdPath) : false
  if (!commandPath || !commandExists || !cwdPath || !cwdExists) {
    await fs.writeFile(stdoutPath, "", "utf8")
    await fs.writeFile(stderrPath, !commandExists ? `script not found: ${check.command}\n` : `cwd not found: ${check.cwd}\n`, "utf8")
    const result = checkResult({
      check,
      status: "blocked",
      startedAt,
      finishedAt: timestamp(input.now),
      stdoutPath,
      stderrPath,
      resultPath,
      workspaceRoot,
      summary: !commandExists ? `script not found: ${check.command}` : `cwd not found: ${check.cwd}`,
      metrics: {},
      evidence: []
    })
    await writeJson(resultPath, result)
    return result
  }

  const knownIds = await loadKnownIds(workspaceRoot, check.passCondition.allowKnownIdsFile)
  if (!knownIds.ok) {
    await fs.writeFile(stdoutPath, "", "utf8")
    await fs.writeFile(stderrPath, `${knownIds.reason}\n`, "utf8")
    const result = checkResult({
      check,
      status: "blocked",
      startedAt,
      finishedAt: timestamp(input.now),
      stdoutPath,
      stderrPath,
      resultPath,
      workspaceRoot,
      summary: knownIds.reason,
      metrics: {},
      evidence: []
    })
    await writeJson(resultPath, result)
    return result
  }

  const processResult = await executeCheckProcess(check, commandPath, cwdPath)
  await fs.writeFile(stdoutPath, processResult.stdout, "utf8")
  await fs.writeFile(stderrPath, processResult.stderr, "utf8")
  const evidence = await collectEvidence(workspaceRoot, checkRoot, check.evidence.collect)
  const parsed = await parseMechanicalCheckOutput({
    workspaceRoot,
    parser: check.parser,
    processResult,
    evidence,
    knownIds: knownIds.ids
  })
  if (!parsed.ok) {
    const result = checkResult({
      check,
      status: "blocked",
      startedAt,
      finishedAt: timestamp(input.now),
      exitCode: processResult.exitCode,
      timedOut: processResult.timedOut || undefined,
      stdoutPath,
      stderrPath,
      resultPath,
      workspaceRoot,
      summary: parsed.reason,
      metrics: parsed.metrics,
      findings: parsed.findings,
      evidence: evidence.map((item) => ({
        path: workspaceRelativePath(workspaceRoot, item.absolutePath),
        type: item.type
      }))
    })
    await writeJson(resultPath, result)
    return result
  }
  const metrics = parsed.metrics
  const assessed = assessCheck(check, processResult, metrics)
  const result = checkResult({
    check,
    status: assessed.status,
    startedAt,
    finishedAt: timestamp(input.now),
    exitCode: processResult.exitCode,
    timedOut: processResult.timedOut || undefined,
    stdoutPath,
    stderrPath,
    resultPath,
    workspaceRoot,
    summary: assessed.summary,
    metrics,
    findings: parsed.findings,
    evidence: evidence.map((item) => ({
      path: workspaceRelativePath(workspaceRoot, item.absolutePath),
      type: item.type
    }))
  })
  await writeJson(resultPath, result)
  return result
}

function buildProfileResult(input: {
  runId: string
  workspaceRoot: string
  runRoot: string
  profile: MechanicalCheckProfile
  checks: MechanicalCheckRunResult[]
  startedAt: string
  finishedAt: string
  status?: MechanicalCheckStatus
}): MechanicalCheckProfileResult {
  const counts = {
    passed: input.checks.filter((check) => check.status === "passed").length,
    warnings: input.checks.filter((check) => check.status === "warning").length,
    failed: input.checks.filter((check) => check.status === "failed").length,
    blocked: input.checks.filter((check) => check.status === "blocked").length
  }
  const status = input.status ?? profileStatus(counts)
  return {
    schema_version: PROFILE_RESULT_SCHEMA,
    run_id: input.runId,
    profile: input.profile.id,
    gate: input.profile.gate,
    status,
    checks_total: input.checks.length,
    ...counts,
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    artifact_root: workspaceRelativePath(input.workspaceRoot, input.runRoot),
    summary_path: path.join(".bob", "mechanical-checks", "runs", input.runId, "profile-summary.md").replace(/\\/g, "/"),
    result_path: path.join(".bob", "mechanical-checks", "runs", input.runId, "profile-result.json").replace(/\\/g, "/"),
    checks: input.checks
  }
}

function profileStatus(counts: { passed: number; warnings: number; failed: number; blocked: number }): MechanicalCheckStatus {
  if (counts.blocked > 0) return "blocked"
  if (counts.failed > 0) return "failed"
  if (counts.warnings > 0) return "warning"
  return "passed"
}

function missingCheckResult(runRoot: string, checkId: string, startedAt: string, finishedAt: string): MechanicalCheckRunResult {
  const checkRoot = path.join(runRoot, "checks", checkId)
  return {
    schema_version: CHECK_RESULT_SCHEMA,
    check_id: checkId,
    title: checkId,
    status: "blocked",
    started_at: startedAt,
    finished_at: finishedAt,
    summary: `check not found: ${checkId}`,
    stdout_path: path.join(checkRoot, "stdout.log").replace(/\\/g, "/"),
    stderr_path: path.join(checkRoot, "stderr.log").replace(/\\/g, "/"),
    result_path: path.join(checkRoot, "result.json").replace(/\\/g, "/"),
    metrics: {},
    findings: [],
    evidence: []
  }
}

async function executeCheckProcess(
  check: MechanicalCheckDefinition,
  commandPath: string,
  cwdPath: string
): Promise<ProcessResult> {
  const invocation = invocationForCheck(check, commandPath)
  return new Promise((resolve) => {
    execFile(invocation.file, invocation.args, {
      cwd: cwdPath,
      env: { ...process.env, ...check.env },
      timeout: Math.max(1, Math.round(check.timeoutSeconds * 1000)),
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true
    }, (error, stdout, stderr) => {
      const processError = error as ExecFileException | null
      const timedOut = Boolean(processError?.killed) || processError?.signal === "SIGTERM"
      resolve({
        exitCode: typeof processError?.code === "number" ? processError.code : processError ? undefined : 0,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? "") + (processError?.message && !timedOut ? `\n${processError.message}` : ""),
        timedOut,
        error: processError?.message
      })
    })
  })
}

function invocationForCheck(check: MechanicalCheckDefinition, commandPath: string): { file: string; args: string[] } {
  if (check.runner === "node") return { file: process.execPath, args: [commandPath, ...check.args] }
  if (check.runner === "python") return { file: "python", args: [commandPath, ...check.args] }
  if (check.runner === "powershell") {
    return { file: "powershell.exe", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", commandPath, ...check.args] }
  }
  if (check.runner === "bat") return { file: "cmd.exe", args: ["/d", "/c", commandPath, ...check.args] }
  return { file: commandPath, args: check.args }
}

async function collectEvidence(
  workspaceRoot: string,
  checkRoot: string,
  patterns: string[]
): Promise<MechanicalCheckEvidenceFile[]> {
  const evidenceRoot = path.join(checkRoot, "evidence")
  const files = await listWorkspaceFiles(workspaceRoot)
  const collected: MechanicalCheckEvidenceFile[] = []
  for (const pattern of patterns) {
    const matcher = globMatcher(pattern)
    for (const file of files) {
      if (!matcher(file.relativePath)) continue
      const target = path.join(evidenceRoot, ...file.relativePath.split("/"))
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.copyFile(file.absolutePath, target)
      collected.push({
        absolutePath: target,
        relativePath: file.relativePath,
        type: evidenceType(file.relativePath)
      })
    }
  }
  return dedupeEvidence(collected)
}

function assessCheck(
  check: MechanicalCheckDefinition,
  processResult: ProcessResult,
  metrics: MechanicalCheckMetrics
): { status: MechanicalCheckStatus; summary: string } {
  if (processResult.timedOut) return { status: "blocked", summary: `check timed out after ${check.timeoutSeconds} second(s)` }
  if (processResult.error && processResult.exitCode === undefined) return { status: "blocked", summary: processResult.error }
  const violations: string[] = []
  if (processResult.exitCode && processResult.exitCode !== 0) violations.push(`exit code ${processResult.exitCode}`)
  if (exceeds(metrics.new_warnings, check.passCondition.maxNewWarnings)) {
    violations.push(`new warnings ${metrics.new_warnings} exceeds limit ${check.passCondition.maxNewWarnings}`)
  }
  if (exceeds(metrics.new_errors, check.passCondition.maxNewErrors)) {
    violations.push(`new errors ${metrics.new_errors} exceeds limit ${check.passCondition.maxNewErrors}`)
  }
  if (exceeds(metrics.new_findings, check.passCondition.maxNewFindings)) {
    violations.push(`new findings ${metrics.new_findings} exceeds limit ${check.passCondition.maxNewFindings}`)
  }
  if (exceeds(metrics.violations, check.passCondition.maxViolations)) {
    violations.push(`violations ${metrics.violations} exceeds limit ${check.passCondition.maxViolations}`)
  }
  if (violations.length === 0) return { status: "passed", summary: "passed" }
  return { status: check.allowFailure ? "warning" : "failed", summary: violations.join("; ") }
}

function checkResult(input: {
  check: MechanicalCheckDefinition
  status: MechanicalCheckStatus
  startedAt: string
  finishedAt: string
  exitCode?: number
  timedOut?: boolean
  stdoutPath: string
  stderrPath: string
  resultPath: string
  workspaceRoot: string
  summary: string
  metrics: MechanicalCheckMetrics
  findings?: MechanicalCheckFinding[]
  evidence: Array<{ path: string; type: string }>
}): MechanicalCheckRunResult {
  return {
    schema_version: CHECK_RESULT_SCHEMA,
    check_id: input.check.id,
    title: input.check.title,
    status: input.status,
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    exit_code: input.exitCode,
    timed_out: input.timedOut,
    summary: input.summary,
    stdout_path: workspaceRelativePath(input.workspaceRoot, input.stdoutPath),
    stderr_path: workspaceRelativePath(input.workspaceRoot, input.stderrPath),
    result_path: workspaceRelativePath(input.workspaceRoot, input.resultPath),
    metrics: input.metrics,
    findings: input.findings ?? [],
    evidence: input.evidence
  }
}

async function writeProfileArtifacts(runRoot: string, result: MechanicalCheckProfileResult): Promise<void> {
  await writeJson(path.join(runRoot, "profile-result.json"), result)
  await fs.writeFile(path.join(runRoot, "profile-summary.md"), profileSummaryMarkdown(result), "utf8")
}

function profileSummaryMarkdown(result: MechanicalCheckProfileResult): string {
  const rows = result.checks.map((check) => [
    check.title,
    check.status,
    check.summary,
    metricCell(check.metrics.total_findings),
    metricCell(check.metrics.new_findings),
    metricCell(check.metrics.known_findings),
    topFindingsCell(check.findings),
    check.evidence.map((item) => item.path).join(", ")
  ])
  return [
    `# ${result.profile} 機械チェック結果`,
    "",
    `- 結果: ${result.status}`,
    `- checks: ${result.checks_total}`,
    `- passed: ${result.passed}`,
    `- warnings: ${result.warnings}`,
    `- failed: ${result.failed}`,
    `- blocked: ${result.blocked}`,
    "",
    "| Check | Result | Summary | Total findings | New findings | Known findings | Top findings | Evidence |",
    "|---|---|---|---:|---:|---:|---|---|",
    ...rows.map((row) => `| ${row.map(escapeMarkdownTableCell).join(" | ")} |`),
    ""
  ].join("\n")
}

function metricCell(value: number | undefined): string {
  return value === undefined ? "" : String(value)
}

function topFindingsCell(findings: MechanicalCheckFinding[]): string {
  return findings.slice(0, 3).map((finding) => {
    const location = finding.file ? ` (${finding.file}${finding.line === undefined ? "" : `:${finding.line}`})` : ""
    return `${finding.id}: ${finding.message}${location}`
  }).join("; ")
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

async function loadKnownIds(
  workspaceRoot: string,
  relativePath: string | undefined
): Promise<{ ok: true; ids: Set<string> } | { ok: false; reason: string }> {
  if (!relativePath) return { ok: true, ids: new Set() }
  const knownIdsPath = resolveWorkspacePath(workspaceRoot, relativePath)
  if (!knownIdsPath || !await fileExists(knownIdsPath)) {
    return { ok: false, reason: `known ids file not found: ${relativePath}` }
  }
  const text = await fs.readFile(knownIdsPath, "utf8")
  return {
    ok: true,
    ids: new Set(text.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#")))
  }
}

async function listWorkspaceFiles(workspaceRoot: string): Promise<Array<{ absolutePath: string; relativePath: string }>> {
  const results: Array<{ absolutePath: string; relativePath: string }> = []
  await walk(workspaceRoot, results, workspaceRoot)
  return results
}

async function walk(
  workspaceRoot: string,
  results: Array<{ absolutePath: string; relativePath: string }>,
  current: string
): Promise<void> {
  let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>
  try {
    entries = await fs.readdir(current, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const absolutePath = path.join(current, entry.name)
    if (entry.isDirectory()) {
      await walk(workspaceRoot, results, absolutePath)
      continue
    }
    if (!entry.isFile()) continue
    results.push({
      absolutePath,
      relativePath: workspaceRelativePath(workspaceRoot, absolutePath)
    })
  }
}

function globMatcher(pattern: string): (relativePath: string) => boolean {
  const source = pattern.replace(/\\/g, "/")
  let regex = "^"
  for (let index = 0; index < source.length; index += 1) {
    if (source.startsWith("**/", index)) {
      regex += "(?:.*/)?"
      index += 2
      continue
    }
    const char = source[index]
    if (char === "*" && source[index + 1] === "*") {
      regex += ".*"
      index += 1
    } else if (char === "*") {
      regex += "[^/]*"
    } else if (char === "?") {
      regex += "[^/]"
    } else {
      regex += escapeRegExp(char)
    }
  }
  regex += "$"
  const compiled = new RegExp(regex)
  return (relativePath) => compiled.test(relativePath.replace(/\\/g, "/"))
}

function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string | undefined {
  const root = path.resolve(workspaceRoot)
  if (path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath) || path.posix.isAbsolute(relativePath)) return undefined
  const target = path.resolve(root, relativePath)
  return isInsideOrSame(root, target) ? target : undefined
}

function workspaceRelativePath(workspaceRoot: string, filePath: string): string {
  return path.relative(workspaceRoot, filePath).replace(/\\/g, "/")
}

function runIdFromTimestamp(value: string): string {
  return value.replace(/[^0-9A-Za-z]+/g, "-").replace(/^-|-$/g, "") || "mechanical-check-run"
}

function timestamp(now?: () => string): string {
  return now ? now() : new Date().toISOString()
}

function exceeds(value: number | undefined, limit: number | undefined): boolean {
  return value !== undefined && limit !== undefined && value > limit
}

function countPattern(text: string, pattern: string): number {
  try {
    return Array.from(text.matchAll(new RegExp(pattern, "g"))).length
  } catch {
    return 0
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath)
    return stat.isFile()
  } catch {
    return false
  }
}

async function directoryExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath)
    return stat.isDirectory()
  } catch {
    return false
  }
}

function evidenceType(relativePath: string): string {
  const extension = path.extname(relativePath).replace(/^\./, "").toLowerCase()
  return extension || "file"
}

function dedupeEvidence(items: MechanicalCheckEvidenceFile[]): MechanicalCheckEvidenceFile[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.absolutePath)) return false
    seen.add(item.absolutePath)
    return true
  })
}

function isInsideOrSame(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}
