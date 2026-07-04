import * as vscode from "vscode"
import type { WorkflowDefinition } from "./bobWorkflowTypes"
import { collectWorkflowInputsWithResolver } from "./core/inputCollector"
import type { CoreWorkflowDefinition, WorkflowInputDefinition } from "./core/model"

export async function collectCoreWorkflowInputs(
  workflow: CoreWorkflowDefinition,
  provided: Record<string, unknown>
): Promise<Record<string, unknown> | undefined> {
  return collectWorkflowInputsWithResolver({
    inputs: workflow.inputs,
    provided,
    prompt: promptForWorkflowInput
  })
}

export async function collectBobWorkflowInputs(
  workflow: WorkflowDefinition,
  provided: Record<string, unknown>
): Promise<Record<string, unknown> | undefined> {
  return collectWorkflowInputsWithResolver({
    inputs: workflow.inputs,
    provided,
    prompt: promptForWorkflowInput
  })
}

async function promptForWorkflowInput(
  key: string,
  definition: WorkflowInputDefinition,
  required: boolean
): Promise<unknown> {
  const title = definition.title ?? key
  if (definition.type === "boolean") {
    const picked = await vscode.window.showQuickPick(["true", "false"], { title })
    if (picked === undefined && required) return undefined
    return picked === undefined ? undefined : picked === "true"
  }
  if (definition.type === "select") {
    return vscode.window.showQuickPick(definition.options ?? [], { title })
  }
  const value = await vscode.window.showInputBox({
    title,
    value: definition.default === undefined ? undefined : String(definition.default)
  })
  if (value === undefined) return undefined
  if (definition.type === "number") return Number(value)
  return value
}
