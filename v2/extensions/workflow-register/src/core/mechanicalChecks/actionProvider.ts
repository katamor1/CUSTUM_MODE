import * as fs from "fs/promises"
import * as path from "path"
import type { ActionExecutionInput } from "../model"
import { requireWorkspaceTrust, type WorkspaceTrustCheck } from "../workspaceTrust"
import { MechanicalChecksConfig, parseMechanicalChecksConfig } from "./config"
import { MechanicalCheckProfileResult, runMechanicalChecksProfile } from "./runner"
import type { ActionProvider } from "../actionTypes"

export const MECHANICAL_CHECKS_ACTION_PROVIDER_ID = "workflowRegister.runMechanicalChecks"
const DEFAULT_CONFIG_PATH = ".bob/checks/mechanical-checks.yaml"

export interface MechanicalChecksActionProviderOptions {
  isWorkspaceTrusted?: WorkspaceTrustCheck
}

interface MechanicalChecksActionArgs {
  profile?: string
  configPath?: string
  baseRevision?: string
  targetRevision?: string
  changedFiles?: string[]
  dryRun?: boolean
}

export function createMechanicalChecksActionProvider(
  options: MechanicalChecksActionProviderOptions = {}
): ActionProvider {
  return {
    id: MECHANICAL_CHECKS_ACTION_PROVIDER_ID,
    execute: (input) => executeMechanicalChecksAction(input, options)
  }
}

async function executeMechanicalChecksAction(
  input: ActionExecutionInput,
  options: MechanicalChecksActionProviderOptions
): Promise<MechanicalCheckProfileResult | Record<string, unknown>> {
  requireWorkspaceTrust(options.isWorkspaceTrusted, "running mechanical checks")
  const args = mechanicalCheckArgs(input.args)
  const profile = requireArg(args.profile, "profile")
  const workspaceRoot = requireArg(input.workflowRoot, "workflowRoot")
  const configPath = args.configPath ?? DEFAULT_CONFIG_PATH
  const configFile = resolveWorkspacePath(workspaceRoot, configPath)
  if (!configFile) return blockedActionResult(profile, `config path escapes the workspace: ${configPath}`)

  let text: string
  try {
    text = await fs.readFile(configFile, "utf8")
  } catch {
    return blockedActionResult(profile, `config file not found: ${configPath}`)
  }
  const parsed = parseMechanicalChecksConfig(text, { workspaceRoot })
  if (!parsed.ok) return blockedActionResult(profile, `mechanical check config is invalid: ${parsed.diagnostics.join("; ")}`)

  return runMechanicalChecksProfile({
    workspaceRoot,
    config: renderConfigArgs(parsed.config, actionVariables(args)),
    profile,
    runId: runIdFromInput(input)
  })
}

function mechanicalCheckArgs(value: unknown): MechanicalChecksActionArgs {
  return value && typeof value === "object" && !Array.isArray(value) ? value as MechanicalChecksActionArgs : {}
}

function requireArg(value: unknown, name: string): string {
  if (typeof value === "string" && value.trim()) return value.trim()
  throw new Error(`workflowRegister.runMechanicalChecks requires ${name}.`)
}

function actionVariables(args: MechanicalChecksActionArgs): Record<string, string> {
  return {
    BASE_REVISION: args.baseRevision ?? "",
    TARGET_REVISION: args.targetRevision ?? "",
    CHANGED_FILES: Array.isArray(args.changedFiles) ? args.changedFiles.join("\n") : "",
    DRY_RUN: args.dryRun ? "true" : "false"
  }
}

function renderConfigArgs(config: MechanicalChecksConfig, variables: Record<string, string>): MechanicalChecksConfig {
  return {
    ...config,
    checks: config.checks.map((check) => ({
      ...check,
      args: renderStrings(check.args, variables),
      env: Object.fromEntries(Object.entries(check.env).map(([key, value]) => [key, renderString(value, variables)]))
    }))
  }
}

function renderStrings(values: string[], variables: Record<string, string>): string[] {
  return values.map((value) => renderString(value, variables))
}

function renderString(value: string, variables: Record<string, string>): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (match, key) => variables[key] ?? match)
}

function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string | undefined {
  const root = path.resolve(workspaceRoot)
  if (path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath) || path.posix.isAbsolute(relativePath)) return undefined
  const target = path.resolve(root, relativePath)
  const relative = path.relative(root, target)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)) ? target : undefined
}

function runIdFromInput(input: ActionExecutionInput): string | undefined {
  const parts = [input.runId, input.stepId].filter((item): item is string => typeof item === "string" && item.trim().length > 0)
  if (parts.length === 0) return undefined
  return parts.join("-").replace(/[^0-9A-Za-z._-]+/g, "-")
}

function blockedActionResult(profile: string, reason: string): Record<string, unknown> {
  const now = new Date().toISOString()
  return {
    schema_version: "bob-mechanical-check-profile-result/v1",
    run_id: "",
    profile,
    gate: "",
    status: "blocked",
    checks_total: 0,
    passed: 0,
    warnings: 0,
    failed: 0,
    blocked: 1,
    started_at: now,
    finished_at: now,
    artifact_root: "",
    summary_path: "",
    result_path: "",
    summary: reason,
    checks: []
  }
}
