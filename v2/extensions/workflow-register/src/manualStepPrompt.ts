import * as vscode from "vscode"
import type { ManualCompletionResult } from "./core/engineTypes"
import type { EngineStep } from "./core/model"

export interface ManualStepCompletionPromptInput {
  workflowLabel: string
  runId: string
  step: Extract<EngineStep, { type: "manual" }>
  inputs?: Record<string, unknown>
  state?: Record<string, string>
  previousFormValues?: Record<string, unknown>
}

export type ManualStepCompletionPromptResult = Pick<
  ManualCompletionResult,
  "formValues" | "approval" | "decision" | "reason" | "comment" | "stateUpdates"
>

export interface ManualStepCompletionPromptProvider {
  collectManualCompletion: (
    input: ManualStepCompletionPromptInput
  ) => Promise<ManualStepCompletionPromptResult | undefined> | ManualStepCompletionPromptResult | undefined
}

export function createVscodeManualStepCompletionPromptProvider(): ManualStepCompletionPromptProvider {
  return {
    collectManualCompletion: async (input) => {
      const formValues = input.step.form
        ? await collectFormValues(input.step, input.previousFormValues)
        : undefined
      if (input.step.form && formValues === undefined) return undefined
      const approval = input.step.approval
        ? await collectApproval(input.step)
        : undefined
      if (input.step.approval && approval === undefined) return undefined
      return { formValues, approval }
    }
  }
}

async function collectFormValues(
  step: Extract<EngineStep, { type: "manual" }>,
  previousValues: Record<string, unknown> | undefined
): Promise<Record<string, unknown> | undefined> {
  const values: Record<string, unknown> = {}
  for (const field of step.form?.fields ?? []) {
    const value = await promptField(step, field, previousValues?.[field.id])
    if (value === undefined) return undefined
    if (value !== "") values[field.id] = value
  }
  return values
}

async function promptField(
  step: Extract<EngineStep, { type: "manual" }>,
  field: NonNullable<Extract<EngineStep, { type: "manual" }>["form"]>["fields"][number],
  previousValue: unknown
): Promise<unknown | undefined> {
  const title = field.title ?? field.id
  if (field.type === "select") {
    const picked = await vscode.window.showQuickPick(
      field.options ?? [],
      { title: `${step.title}: ${title}`, placeHolder: stringifyPrevious(previousValue) }
    )
    return picked
  }
  if (field.type === "boolean") {
    const picked = await vscode.window.showQuickPick(
      [
        { label: "true", value: true },
        { label: "false", value: false }
      ],
      { title: `${step.title}: ${title}`, placeHolder: stringifyPrevious(previousValue) }
    )
    return picked?.value
  }
  const value = await vscode.window.showInputBox({
    title: `${step.title}: ${title}`,
    value: typeof previousValue === "string" ? previousValue : undefined,
    prompt: field.required ? "Required" : undefined
  })
  if (value === undefined) return undefined
  if (field.required && value.trim().length === 0) {
    await vscode.window.showErrorMessage(`Manual field is required: ${title}`)
    return undefined
  }
  if (field.type === "number") {
    if (value.trim().length === 0) return ""
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) {
      await vscode.window.showErrorMessage(`Manual field must be a number: ${title}`)
      return undefined
    }
    return parsed
  }
  return value
}

async function collectApproval(
  step: Extract<EngineStep, { type: "manual" }>
): Promise<NonNullable<ManualCompletionResult["approval"]> | undefined> {
  const approval = step.approval
  if (!approval) return undefined
  const picked = await vscode.window.showQuickPick(
    [
      { label: approval.approveLabel ?? "Approve", value: "approved" as const },
      { label: approval.rejectLabel ?? "Reject", value: "rejected" as const }
    ],
    { title: step.title, placeHolder: approval.message }
  )
  if (!picked) return undefined
  if (picked.value === "approved") return { decision: "approved" }
  const reason = await vscode.window.showInputBox({
    title: `${step.title}: ${approval.rejectLabel ?? "Reject"}`,
    prompt: "Reject reason"
  })
  if (reason === undefined) return undefined
  return { decision: "rejected", reason }
}

function stringifyPrevious(value: unknown): string | undefined {
  if (value === undefined) return undefined
  return typeof value === "string" ? value : JSON.stringify(value)
}
