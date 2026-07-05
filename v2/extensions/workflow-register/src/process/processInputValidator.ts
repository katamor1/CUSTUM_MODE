import {
  PROCESS_INPUT_SCHEMA_VERSION,
  PROCESS_PHASES,
  PROCESS_TARGET_LANGUAGES,
  PROCESS_VCS_TYPES,
  PROCESS_WORKFLOW_NAMES,
  type ProcessInput,
  type ProcessPhase,
  type ProcessTargetLanguage,
  type ProcessVcsType
} from "./processTypes"
import {
  describeUnsafeWorkspacePath,
  validateExistingWorkspacePath,
  validateSafePathSegment
} from "./processPaths"

export interface ProcessInputValidationOptions {
  workspaceRoot: string
  requireExistingPaths?: boolean
}

export type ProcessInputValidationResult =
  | { ok: true; diagnostics: string[]; input: ProcessInput }
  | { ok: false; diagnostics: string[]; input?: ProcessInput }

export async function validateProcessInput(
  candidate: unknown,
  options: ProcessInputValidationOptions
): Promise<ProcessInputValidationResult> {
  const diagnostics: string[] = []
  if (!isRecord(candidate)) {
    return { ok: false, diagnostics: ["process input must be an object"] }
  }
  expectExactString(diagnostics, candidate, "schemaVersion", PROCESS_INPUT_SCHEMA_VERSION)
  expectSafeSegment(diagnostics, candidate.campaignId, "campaignId")
  if (candidate.runId !== undefined) {
    expectSafeSegment(diagnostics, candidate.runId, "runId")
  }
  const workflowName = expectNonEmptyString(diagnostics, candidate, "workflowName")
  if (workflowName && !PROCESS_WORKFLOW_NAMES.includes(workflowName as typeof PROCESS_WORKFLOW_NAMES[number])) {
    diagnostics.push(`workflowName is not a registered Phase 3 workflow: ${workflowName}`)
  }
  const phase = expectNonEmptyString(diagnostics, candidate, "phase")
  if (phase && !PROCESS_PHASES.includes(phase as ProcessPhase)) {
    diagnostics.push(`phase is not supported: ${phase}`)
  }
  const targetLanguage = expectNonEmptyString(diagnostics, candidate, "targetLanguage")
  if (targetLanguage && !PROCESS_TARGET_LANGUAGES.includes(targetLanguage as ProcessTargetLanguage)) {
    diagnostics.push(`targetLanguage is not supported: ${targetLanguage}`)
  }
  expectNonEmptyString(diagnostics, candidate, "targetSummary")
  await validateVcs(diagnostics, candidate.vcs)
  await validateInputFiles(diagnostics, candidate.inputs, options)
  validateOptions(diagnostics, candidate.options)

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics }
  }
  return { ok: true, diagnostics, input: candidate as unknown as ProcessInput }
}

async function validateVcs(diagnostics: string[], value: unknown): Promise<void> {
  if (!isRecord(value)) {
    diagnostics.push("vcs must be an object")
    return
  }
  const type = expectNonEmptyString(diagnostics, value, "type", "vcs")
  if (type && !PROCESS_VCS_TYPES.includes(type as ProcessVcsType)) {
    diagnostics.push(`vcs.type is not supported: ${type}`)
  }
  const rootDiagnostic = describeUnsafeWorkspacePath("vcs.root", value.root)
  if (rootDiagnostic) diagnostics.push(rootDiagnostic)
  if ((type === "bazaar" || type === "bzr") && value.noAliases !== true) {
    diagnostics.push("Bazaar process input must assert bzr --no-aliases usage with vcs.noAliases: true")
  }
  if (value.revision !== undefined && typeof value.revision !== "string") {
    diagnostics.push("vcs.revision must be a string when present")
  }
  if (value.branch !== undefined && typeof value.branch !== "string") {
    diagnostics.push("vcs.branch must be a string when present")
  }
}

async function validateInputFiles(
  diagnostics: string[],
  value: unknown,
  options: ProcessInputValidationOptions
): Promise<void> {
  if (!isRecord(value)) {
    diagnostics.push("inputs must be an object keyed by evidence kind")
    return
  }
  for (const [kind, files] of Object.entries(value)) {
    if (!/^[a-z][a-z0-9_]*$/.test(kind)) {
      diagnostics.push(`inputs.${kind} must use a stable snake_case kind`)
    }
    if (!Array.isArray(files) || files.length === 0) {
      diagnostics.push(`inputs.${kind} must be a non-empty array`)
      continue
    }
    for (let index = 0; index < files.length; index += 1) {
      const label = `inputs.${kind}[${index}].path`
      const file = files[index]
      if (!isRecord(file)) {
        diagnostics.push(`inputs.${kind}[${index}] must be an object`)
        continue
      }
      const unsafe = describeUnsafeWorkspacePath(label, file.path)
      if (unsafe) {
        diagnostics.push(unsafe)
      } else if (options.requireExistingPaths !== false) {
        diagnostics.push(...await validateExistingWorkspacePath(options.workspaceRoot, file.path, label))
      }
      if (file.title !== undefined && typeof file.title !== "string") {
        diagnostics.push(`inputs.${kind}[${index}].title must be a string when present`)
      }
      if (file.encoding !== undefined && typeof file.encoding !== "string") {
        diagnostics.push(`inputs.${kind}[${index}].encoding must be a string when present`)
      }
      if (file.required !== undefined && typeof file.required !== "boolean") {
        diagnostics.push(`inputs.${kind}[${index}].required must be a boolean when present`)
      }
    }
  }
}

function validateOptions(diagnostics: string[], value: unknown): void {
  if (value === undefined) {
    diagnostics.push("options must set destructiveVcsOperations: false and requireHumanGate: true")
    return
  }
  if (!isRecord(value)) {
    diagnostics.push("options must be an object")
    return
  }
  if (value.destructiveVcsOperations !== false) {
    diagnostics.push("destructive VCS operations must be explicitly disabled")
  }
  if (value.requireHumanGate !== true) {
    diagnostics.push("human gate must be explicitly required")
  }
  if (value.textEncoding !== undefined && typeof value.textEncoding !== "string") {
    diagnostics.push("options.textEncoding must be a string when present")
  }
}

function expectSafeSegment(diagnostics: string[], value: unknown, label: string): void {
  const diagnostic = validateSafePathSegment(value, label)
  if (diagnostic) diagnostics.push(diagnostic)
}

function expectExactString(
  diagnostics: string[],
  candidate: Record<string, unknown>,
  key: string,
  expected: string,
  prefix?: string
): string | undefined {
  const label = prefix ? `${prefix}.${key}` : key
  const value = candidate[key]
  if (value !== expected) {
    diagnostics.push(`${label} must be ${expected}`)
    return undefined
  }
  return value
}

function expectNonEmptyString(
  diagnostics: string[],
  candidate: Record<string, unknown>,
  key: string,
  prefix?: string
): string | undefined {
  const label = prefix ? `${prefix}.${key}` : key
  const value = candidate[key]
  if (typeof value !== "string" || value.trim().length === 0) {
    diagnostics.push(`${label} must be a non-empty string`)
    return undefined
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
