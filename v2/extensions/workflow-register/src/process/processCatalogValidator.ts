import {
  PROCESS_CATALOG_SCHEMA_VERSION,
  PROCESS_INPUT_SCHEMA_VERSION,
  PROCESS_PHASES,
  PROCESS_RECORD_SCHEMA_VERSION,
  PROCESS_REVIEW_RESULT_SCHEMA_VERSION,
  PROCESS_WORKFLOW_NAMES,
  type ProcessCatalog,
  type ProcessCatalogWorkflow,
  type ProcessPhase
} from "./processTypes"
import { describeUnsafeWorkspacePath } from "./processPaths"

export {
  PROCESS_CATALOG_SCHEMA_VERSION,
  PROCESS_INPUT_SCHEMA_VERSION,
  PROCESS_RECORD_SCHEMA_VERSION,
  PROCESS_REVIEW_RESULT_SCHEMA_VERSION,
  PROCESS_WORKFLOW_NAMES
} from "./processTypes"

export interface ProcessCatalogValidationOptions {
  requireAllPhase3Workflows?: boolean
}

export type ProcessCatalogValidationResult =
  | { ok: true; diagnostics: string[]; catalog: ProcessCatalog }
  | { ok: false; diagnostics: string[]; catalog?: ProcessCatalog }

export function validateProcessCatalog(
  candidate: unknown,
  options: ProcessCatalogValidationOptions = {}
): ProcessCatalogValidationResult {
  const diagnostics: string[] = []
  const requireAllPhase3Workflows = options.requireAllPhase3Workflows ?? true
  if (!isRecord(candidate)) {
    return { ok: false, diagnostics: ["catalog must be an object"] }
  }

  expectExactString(diagnostics, candidate, "schemaVersion", PROCESS_CATALOG_SCHEMA_VERSION)
  expectNonEmptyString(diagnostics, candidate, "catalogId")
  expectWorkspacePath(diagnostics, candidate.workflowRoot, "workflowRoot")
  expectWorkspacePath(diagnostics, candidate.runRoot, "runRoot")
  expectWorkspacePath(diagnostics, candidate.recordRoot, "recordRoot")
  if (candidate.displayName !== undefined && typeof candidate.displayName !== "string") {
    diagnostics.push("displayName must be a string when present")
  }
  if (candidate.version !== undefined && typeof candidate.version !== "string" && typeof candidate.version !== "number") {
    diagnostics.push("version must be a string or number when present")
  }
  if (!Array.isArray(candidate.workflows)) {
    diagnostics.push("workflows must be an array")
    return { ok: false, diagnostics }
  }

  const workflowNames = new Set<string>()
  for (let index = 0; index < candidate.workflows.length; index += 1) {
    validateWorkflow(diagnostics, candidate.workflows[index], index, workflowNames)
  }
  if (requireAllPhase3Workflows) {
    for (const workflowName of PROCESS_WORKFLOW_NAMES) {
      if (!workflowNames.has(workflowName)) {
        diagnostics.push(`missing required Phase 3 workflow: ${workflowName}`)
      }
    }
  }

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics }
  }
  return { ok: true, diagnostics, catalog: candidate as unknown as ProcessCatalog }
}

function validateWorkflow(
  diagnostics: string[],
  candidate: unknown,
  index: number,
  workflowNames: Set<string>
): void {
  const prefix = `workflows[${index}]`
  if (!isRecord(candidate)) {
    diagnostics.push(`${prefix} must be an object`)
    return
  }
  const name = expectNonEmptyString(diagnostics, candidate, "name", prefix)
  expectNonEmptyString(diagnostics, candidate, "title", prefix)
  const phase = expectNonEmptyString(diagnostics, candidate, "phase", prefix)
  if (name) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
      diagnostics.push(`${prefix}.name must be a stable kebab-case workflow id`)
    }
    if (workflowNames.has(name)) {
      diagnostics.push(`${prefix}.name duplicate workflow name: ${name}`)
    }
    workflowNames.add(name)
    if (!PROCESS_WORKFLOW_NAMES.includes(name as typeof PROCESS_WORKFLOW_NAMES[number])) {
      diagnostics.push(`${prefix}.name is not a registered Phase 3 workflow: ${name}`)
    }
  }
  if (phase && !PROCESS_PHASES.includes(phase as ProcessPhase)) {
    diagnostics.push(`${prefix}.phase is not supported: ${phase}`)
  }
  expectWorkspacePath(diagnostics, candidate.workflowPath, `${prefix}.workflowPath`)
  if (name && typeof candidate.workflowPath === "string") {
    const expectedPath = `.bob/workflows/${name}/WORKFLOW.md`
    if (candidate.workflowPath.replace(/\\/g, "/") !== expectedPath) {
      diagnostics.push(`${prefix}.workflowPath must be ${expectedPath}`)
    }
  }
  expectExactString(diagnostics, candidate, "inputSchema", PROCESS_INPUT_SCHEMA_VERSION, prefix)
  expectExactString(diagnostics, candidate, "recordSchema", PROCESS_RECORD_SCHEMA_VERSION, prefix)
  expectExactString(diagnostics, candidate, "reviewResultSchema", PROCESS_REVIEW_RESULT_SCHEMA_VERSION, prefix)
  expectStringArray(diagnostics, candidate, "requiredInputs", prefix, { minItems: 1, itemPattern: /^[a-z][a-z0-9_]*$/ })
  expectStringArray(diagnostics, candidate, "humanGates", prefix, { minItems: 1, itemPattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ })
  const outputs = expectStringArray(diagnostics, candidate, "artifactOutputs", prefix, { minItems: 1 })
  for (let outputIndex = 0; outputIndex < outputs.length; outputIndex += 1) {
    expectWorkspacePath(diagnostics, outputs[outputIndex], `${prefix}.artifactOutputs[${outputIndex}]`)
  }
}

function expectWorkspacePath(diagnostics: string[], value: unknown, label: string): void {
  const diagnostic = describeUnsafeWorkspacePath(label, value)
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

function expectStringArray(
  diagnostics: string[],
  candidate: Record<string, unknown>,
  key: string,
  prefix: string,
  options: { minItems?: number; itemPattern?: RegExp } = {}
): string[] {
  const label = `${prefix}.${key}`
  const value = candidate[key]
  if (!Array.isArray(value)) {
    diagnostics.push(`${label} must be an array`)
    return []
  }
  if (options.minItems !== undefined && value.length < options.minItems) {
    diagnostics.push(`${label} must have at least ${options.minItems} item(s)`)
  }
  const strings: string[] = []
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index]
    if (typeof item !== "string" || item.trim().length === 0) {
      diagnostics.push(`${label}[${index}] must be a non-empty string`)
      continue
    }
    if (options.itemPattern && !options.itemPattern.test(item)) {
      diagnostics.push(`${label}[${index}] has an unsupported value: ${item}`)
    }
    strings.push(item)
  }
  return strings
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
