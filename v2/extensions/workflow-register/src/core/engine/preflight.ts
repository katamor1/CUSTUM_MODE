import * as fs from "fs/promises"
import * as path from "path"
import { CoreWorkflowDefinition, WorkflowPreflightDefinition, WorkflowRunState } from "../model"

export interface WorkflowPreflightCheckInput {
  workflow: CoreWorkflowDefinition
  run: WorkflowRunState
  checkId: string
}

export type WorkflowPreflightCheckResult = boolean | string | { ok: boolean; error?: string }

export type WorkflowPreflightChecks = Record<string, (input: WorkflowPreflightCheckInput) => Promise<WorkflowPreflightCheckResult> | WorkflowPreflightCheckResult>

export interface EvaluateWorkflowPreflightInput {
  workflow: CoreWorkflowDefinition
  run: WorkflowRunState
  workspaceAvailable?: () => Promise<boolean> | boolean
  fileExists?: (relativePath: string) => Promise<boolean> | boolean
  preflightChecks: WorkflowPreflightChecks
  strictPreflightChecks: boolean
}

export function createDefaultPreflightChecks(workspaceRoot: string | undefined): WorkflowPreflightChecks {
  if (!workspaceRoot) return {}
  return {
    workspaceOpen: () => true,
    bobWorkspaceInitialized: () => exists(path.join(workspaceRoot, ".bob")),
    bazaarRepository: () => exists(path.join(workspaceRoot, ".bzr"))
  }
}

export async function evaluatePreflight(input: EvaluateWorkflowPreflightInput): Promise<{ errors: string[]; warnings: string[] }> {
  const errors: string[] = []
  const warnings: string[] = []
  if (input.workflow.requires?.workspace && input.workspaceAvailable) {
    const available = await Promise.resolve(input.workspaceAvailable())
    if (!available) errors.push("Workspace is required but not available.")
  }
  for (const file of input.workflow.requires?.files ?? []) await checkFile(file, input.fileExists, errors, warnings, true)
  for (const preflight of input.workflow.preflight ?? []) await evaluatePreflightEntry(input, preflight, errors, warnings)
  return { errors, warnings }
}

async function evaluatePreflightEntry(input: EvaluateWorkflowPreflightInput, preflight: WorkflowPreflightDefinition, errors: string[], warnings: string[]): Promise<void> {
  const policy = preflight.failurePolicy ?? "stop"
  const required = preflight.required !== false
  const fail = (message: string) => {
    if (required && policy === "stop") errors.push(`${preflight.id}: ${message}`)
    else warnings.push(`${preflight.id}: ${message}`)
  }
  for (const file of preflight.files ?? []) await checkFile(file, input.fileExists, errors, warnings, required && policy === "stop", preflight.id)
  for (const checkId of preflight.checks ?? []) {
    const check = input.preflightChecks[checkId]
    if (!check) {
      if (input.strictPreflightChecks) fail(`Unsupported preflight check: ${checkId}`)
      else warnings.push(`${preflight.id}: skipped unsupported preflight check: ${checkId}`)
      continue
    }
    const result = await Promise.resolve(check({ workflow: input.workflow, run: input.run, checkId }))
    const error = formatPreflightCheckFailure(result)
    if (error) fail(`${checkId}: ${error}`)
  }
}

async function checkFile(relativePath: string, fileExists: EvaluateWorkflowPreflightInput["fileExists"], errors: string[], warnings: string[], required: boolean, prefix?: string): Promise<void> {
  if (!fileExists) return
  const exists = await Promise.resolve(fileExists(relativePath))
  if (exists) return
  const message = `${prefix ? `${prefix}: ` : ""}Required workflow file is missing: ${relativePath}`
  if (required) errors.push(message)
  else warnings.push(message)
}

export async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

function formatPreflightCheckFailure(result: WorkflowPreflightCheckResult): string | undefined {
  if (result === true) return undefined
  if (result === false) return "check returned false"
  if (typeof result === "string") return result
  return result.ok ? undefined : result.error ?? "check failed"
}
