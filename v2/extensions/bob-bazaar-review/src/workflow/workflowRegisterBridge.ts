import * as vscode from "vscode"
import type { CaptureReviewResultOptions } from "../projectRules/resultCaptureTypes"
import type { BazaarReviewInitialTarget } from "../ui/reviewGuiTypes"

export const WORKFLOW_REGISTER_EXTENSION_ID = "local.workflow-register"

export interface WorkflowActionExecutionInput {
  args: unknown
  inputs: Record<string, unknown>
  state?: Record<string, string>
  workflowId?: string
  logicalWorkflowId?: string
  workflowRoot?: string
  workflowFile?: string
  workflowFolderName?: string
  bazaarRoot?: string
  repositoryRoot?: string
  runId?: string
  stepId?: string
}

export interface WorkflowActionProvider {
  id: string
  execute: (input: WorkflowActionExecutionInput) => Promise<unknown> | unknown
}

export interface WorkflowRegisterApi {
  registerActionProvider: (provider: WorkflowActionProvider) => void
}

export async function getWorkflowRegisterApi(extensionId = WORKFLOW_REGISTER_EXTENSION_ID): Promise<WorkflowRegisterApi | undefined> {
  const extension = vscode.extensions.getExtension<WorkflowRegisterApi>(extensionId)
  if (!extension) {
    console.warn(`workflow-register 拡張機能が見つかりません: ${extensionId}`)
    return undefined
  }
  const api = extension.isActive ? extension.exports : await extension.activate()
  if (!api?.registerActionProvider) {
    console.warn(`workflow-register 拡張機能が registerActionProvider を公開していません: ${extensionId}`)
    return undefined
  }
  return api
}

export function isWorkflowRegisterExtensionAvailable(extensionId = WORKFLOW_REGISTER_EXTENSION_ID): boolean {
  return Boolean(vscode.extensions.getExtension(extensionId))
}

export function firstStringArg(args: unknown): string | undefined {
  const values = Array.isArray(args) ? args : args === undefined ? [] : [args]
  const first = values[0]
  return typeof first === "string" ? first : undefined
}

export function initialTargetFromWorkflowInputs(inputs: Record<string, unknown>, input?: WorkflowActionExecutionInput): BazaarReviewInitialTarget | undefined {
  const explicitBazaarRoot =
    stringInput(input?.bazaarRoot) ??
    stringInput(input?.repositoryRoot) ??
    stringInput(inputs.bazaarRoot) ??
    stringInput(inputs.repositoryRoot)
  const target: BazaarReviewInitialTarget = {
    revisionMode: targetMode(inputs.revisionMode),
    revision: stringInput(inputs.revision),
    baseRevision: stringInput(inputs.baseRevision),
    targetRevision: stringInput(inputs.targetRevision),
    bazaarRoot: explicitBazaarRoot,
    repositoryRoot: stringInput(inputs.repositoryRoot),
    workflowRoot: stringInput(input?.workflowRoot),
    runId: stringInput(input?.runId),
    stepId: stringInput(input?.stepId)
  }
  const hasInitialTarget =
    target.revisionMode ||
    target.revision ||
    target.baseRevision ||
    target.targetRevision ||
    target.bazaarRoot ||
    target.repositoryRoot ||
    target.workflowRoot ||
    target.runId ||
    target.stepId
  return hasInitialTarget ? target : undefined
}

function targetMode(value: unknown): BazaarReviewInitialTarget["revisionMode"] | undefined {
  if (value === "singleRevision" || value === "revisionRange" || value === "workingTreeSinceRevision") return value
  return undefined
}

export function stringInput(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

export function captureOptionsFromCommandArgs(args: unknown[]): CaptureReviewResultOptions {
  const context = recordInput(args[args.length - 1])
  if (!context) return {}
  return captureOptionsFromWorkflowContext(context)
}

function captureOptionsFromWorkflowContext(context: Record<string, unknown>): CaptureReviewResultOptions {
  const workflowState = recordStringMap(context.state)
  return {
    expectedChecklistItems: expectedChecklistItemsFromState(workflowState),
    expectedRuleIds: expectedRuleIdsFromState(workflowState),
    reviewResultSchema: reviewResultSchemaFromState(workflowState),
    workspaceRoot: stringInput(context.workflowRoot),
    workflowRunId: stringInput(context.runId),
    workflowState
  }
}

function recordStringMap(value: unknown): Record<string, string> | undefined {
  const record = recordInput(value)
  if (!record) return undefined
  const entries = Object.entries(record)
  return entries.every(([, item]) => typeof item === "string")
    ? Object.fromEntries(entries) as Record<string, string>
    : undefined
}

function recordInput(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function expectedChecklistItemsFromState(state: Record<string, string> | undefined): number | undefined {
  const reviewRules = reviewRulesFromState(state)
  const checklistItems = reviewRules?.checklistItems
  return Number.isInteger(checklistItems) && (checklistItems as number) >= 0 ? checklistItems as number : undefined
}

function expectedRuleIdsFromState(state: Record<string, string> | undefined): string[] | undefined {
  const reviewRules = reviewRulesFromState(state)
  const ruleIds = reviewRules?.ruleIds
  if (!Array.isArray(ruleIds)) return undefined
  const normalized = ruleIds.map((ruleId) => typeof ruleId === "string" ? ruleId.trim() : "").filter(Boolean)
  return normalized.length > 0 ? normalized : undefined
}

function reviewResultSchemaFromState(state: Record<string, string> | undefined): unknown | undefined {
  const reviewRules = reviewRulesFromState(state)
  return reviewRules?.reviewResultSchema
}

function reviewRulesFromState(state: Record<string, string> | undefined): Record<string, unknown> | undefined {
  return parseStateObject(state?.reviewRules)
}

function parseStateObject(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}
