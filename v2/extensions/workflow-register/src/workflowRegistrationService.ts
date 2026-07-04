import * as vscode from "vscode"
import { asSource, loadBobApi } from "./bobApi"
import type { BobSourceLike, BobWorkflowApi } from "./bobApi"
import { createBobWorkflow } from "./bobWorkflowFactory"
import type { WorkflowDefinition } from "./bobWorkflowTypes"
import type { CoreWorkflowDefinition } from "./core/model"
import { formatAttempt, runAttempt } from "./reports"
import { loadWorkspaceWorkflows } from "./workflowDefinitionLoader"

const BOB_EXTENSION_ID = "IBM.bob-code"

export interface RegistrationResult {
  summary: string
  lines: string[]
}

export interface WorkflowRegistrationUpdate {
  result: RegistrationResult
  coreWorkflows: CoreWorkflowDefinition[]
  registeredIds?: Set<string>
  registeredSource?: BobSourceLike
  sourceChanged: boolean
  idsChanged: boolean
}

export interface RegisterWorkflowsInput {
  previousSource?: BobSourceLike
  createRunner: (workflow: WorkflowDefinition) => Parameters<typeof createBobWorkflow>[1]
}

export async function registerWorkflows(input: RegisterWorkflowsInput): Promise<WorkflowRegistrationUpdate> {
  const config = vscode.workspace.getConfiguration("workflowRegister")
  // sourceId/sourceName と workflow id は Bob 側の登録互換性契約なので、設定値を登録 API へ一貫して渡す。
  const sourceId = config.get<string>("sourceId", "workflow-register")
  const sourceName = config.get<string>("sourceName", "Workflow Register")
  const lines: string[] = []
  const loaded = await loadWorkspaceWorkflows(sourceId)
  lines.push(...loaded.diagnostics)
  const coreWorkflows = loaded.coreWorkflows

  if (loaded.workflows.length === 0) {
    await deactivateRegisteredSource(input.previousSource, lines)
    await vscode.commands.executeCommand("setContext", "bob-code.hasWorkflows", false)
    return {
      result: { summary: "No .bob workflows were found.", lines },
      coreWorkflows,
      registeredSource: undefined,
      registeredIds: new Set(),
      sourceChanged: true,
      idsChanged: true
    }
  }

  const bob = await loadBobApi(BOB_EXTENSION_ID)
  lines.push(`- Bob extension found: ${bob.found}`)
  lines.push(`- Bob extension active: ${bob.active}`)
  lines.push(`- Bob activation error: ${bob.activationError}`)
  const api = bob.exportsValue as BobWorkflowApi | undefined
  if (typeof api?.registerSource !== "function") {
    lines.push("- fail: IBM Bob registerSource API is not available.")
    return {
      result: { summary: "Bob workflow registration API is unavailable.", lines },
      coreWorkflows,
      sourceChanged: false,
      idsChanged: false
    }
  }

  // 再登録時は古い source を先に無効化し、Bob 側に存在しない workflow id が残らないようにする。
  await deactivateRegisteredSource(input.previousSource, lines)
  const sourceResult = await runAttempt("registerSource(sourceId, sourceName)", () => api.registerSource?.(sourceId, sourceName))
  lines.push(formatAttempt(sourceResult))
  const source = asSource(sourceResult.value)
  lines.push(`- returned source keys: ${source ? Object.keys(source as Record<string, unknown>).join(",") || "none" : "none"}`)
  lines.push(`- typeof source.registerWorkflow: ${typeof source?.registerWorkflow}`)
  if (!source?.registerWorkflow) {
    return {
      result: { summary: "Bob accepted the source request, but workflows cannot be registered.", lines },
      coreWorkflows,
      registeredSource: undefined,
      sourceChanged: true,
      idsChanged: false
    }
  }

  let registeredCount = 0
  const registeredIds = new Set<string>()
  for (const workflow of loaded.workflows) {
    const attempt = await runAttempt(
      `source.registerWorkflow(${workflow.id})`,
      () => source.registerWorkflow?.(createBobWorkflow(workflow, input.createRunner(workflow)))
    )
    lines.push(formatAttempt(attempt))
    if (attempt.ok) {
      registeredIds.add(workflow.id)
      registeredCount += 1
      source.log?.(`Workflow registered from ${workflow.file.fsPath}: ${workflow.id}`)
    }
  }
  await vscode.commands.executeCommand("setContext", "bob-code.hasWorkflows", registeredIds.size > 0)
  return {
    result: { summary: `Registered ${registeredCount} workflow(s); ${registeredIds.size} workflow(s) are registered in this session.`, lines },
    coreWorkflows,
    registeredSource: source,
    registeredIds,
    sourceChanged: true,
    idsChanged: true
  }
}

export async function deactivateRegisteredSource(source: BobSourceLike | undefined, lines?: string[]): Promise<void> {
  if (!source?.deactivate) return
  const attempt = await runAttempt("previousSource.deactivate()", () => source.deactivate?.())
  lines?.push(formatAttempt(attempt))
}
