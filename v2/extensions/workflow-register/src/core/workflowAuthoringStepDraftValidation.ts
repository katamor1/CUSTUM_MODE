import { analyzeAuthoringReferences } from "./workflowAuthoringReferenceAnalysis"
import type { ResultSinkDefinition, ResultSourceDefinition } from "./model"
import type { WorkflowAuthoringModel, WorkflowAuthoringStep } from "./workflowAuthoringModel"

export type StepDraftDiagnosticSeverity = "error" | "warning" | "info"

export interface StepDraftDiagnostic {
  severity: StepDraftDiagnosticSeverity
  code: string
  message: string
  field?: string
  targetStepId?: string
}

export interface StepDraftReferenceImpact {
  severity: StepDraftDiagnosticSeverity
  code: string
  message: string
  sourceField: "id" | "resultKey" | "includeState" | "type" | "artifact" | "result"
  targetId?: string
}

export interface StepDraftValidationResult {
  status: "ok" | "warning" | "error"
  diagnostics: StepDraftDiagnostic[]
  affectedReferences: StepDraftReferenceImpact[]
}

export interface StepDraftValidationInput {
  model: WorkflowAuthoringModel
  originalStep?: WorkflowAuthoringStep
  draftStep: WorkflowAuthoringStep
  stepIndex: number
}

const STEP_TYPES = new Set(["agent", "command", "manual", "result"])

/**
 * Webview が draft edit を main authoring model へ反映する前に、選択中 step を検証する。
 *
 * step 単体の不整合と downstream reference への影響をここで捕捉し、
 * whole-workflow save まで問題が見えない状態を避ける。
 */
export function validateStepDraft(input: StepDraftValidationInput): StepDraftValidationResult {
  const diagnostics: StepDraftDiagnostic[] = []
  const affectedReferences: StepDraftReferenceImpact[] = []
  const { model, originalStep, draftStep, stepIndex } = input

  validateCommonFields(draftStep, diagnostics)
  validateTypeSpecificFields(draftStep, diagnostics)
  analyzeOriginalFieldChanges(model, originalStep, draftStep, stepIndex, affectedReferences)
  analyzeDraftReferenceState(model, draftStep, stepIndex, diagnostics, affectedReferences)

  const status = diagnostics.some((item) => item.severity === "error") || affectedReferences.some((item) => item.severity === "error")
    ? "error"
    : diagnostics.some((item) => item.severity === "warning") || affectedReferences.some((item) => item.severity === "warning")
      ? "warning"
      : "ok"

  return { status, diagnostics, affectedReferences }
}

export function stepDraftResultHasBlockingError(result: StepDraftValidationResult): boolean {
  return result.status === "error"
}

export function formatStepDraftValidationSummary(result: StepDraftValidationResult): string {
  const errors = countSeverity(result, "error")
  const warnings = countSeverity(result, "warning")
  if (errors > 0) return `error: ${errors} 件, warning: ${warnings} 件`
  if (warnings > 0) return `warning: ${warnings} 件`
  return "ok"
}

function countSeverity(result: StepDraftValidationResult, severity: StepDraftDiagnosticSeverity): number {
  return result.diagnostics.filter((item) => item.severity === severity).length + result.affectedReferences.filter((item) => item.severity === severity).length
}

function validateCommonFields(step: WorkflowAuthoringStep, diagnostics: StepDraftDiagnostic[]): void {
  if (!nonEmpty(step.id)) {
    diagnostics.push(error("step.id.required", "step id は必須です。", "id"))
  } else if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(step.id.trim())) {
    diagnostics.push(error("step.id.invalid", "step id は英数字で始め、英数字・`.`・`_`・`-` だけを使用してください。", "id"))
  }

  if (!nonEmpty(step.title)) diagnostics.push(error("step.title.required", "step title は必須です。", "title"))
  if (!nonEmpty(step.type)) diagnostics.push(error("step.type.required", "step type は必須です。", "type"))
  else if (!STEP_TYPES.has(step.type)) diagnostics.push(error("step.type.invalid", `未対応の step type です: ${step.type}`, "type"))

  if (step.maxResultBytes !== undefined && step.maxResultBytes !== null) {
    const value = Number(step.maxResultBytes)
    if (!Number.isFinite(value) || value <= 0) diagnostics.push(error("step.maxResultBytes.invalid", "maxResultBytes は正の数を指定してください。", "maxResultBytes"))
  }

  if (step.stateRequired === true && (!step.includeState || step.includeState.length === 0)) {
    diagnostics.push(error("step.stateRequired.withoutIncludeState", "stateRequired が true の場合は includeState を1件以上指定してください。", "stateRequired"))
  }
}

function validateTypeSpecificFields(step: WorkflowAuthoringStep, diagnostics: StepDraftDiagnostic[]): void {
  switch (step.type) {
    case "agent":
      validatePromptStep(step, diagnostics, "agent")
      break
    case "manual":
      validateManualStep(step, diagnostics)
      if (step.completeOnSuccess !== undefined) {
        diagnostics.push(warning("manual.completeOnSuccess.unusual", "manual step では completeOnSuccess の指定は通常不要です。手動完了との関係を確認してください。", "completeOnSuccess"))
      }
      break
    case "command":
      validateCommandStep(step, diagnostics)
      break
    case "result":
      validateResultStep(step, diagnostics)
      break
  }
}

function validatePromptStep(step: WorkflowAuthoringStep, diagnostics: StepDraftDiagnostic[], type: "agent" | "manual"): void {
  if (!nonEmpty(step.prompt)) diagnostics.push(error(`${type}.prompt.required`, `${type} step では prompt が必須です。`, "prompt"))
  if (step.includeState && step.includeState.length > 0 && !containsStateHint(step.prompt)) {
    diagnostics.push(warning(`${type}.prompt.stateHintMissing`, "includeState を指定しています。prompt 内で state をどう使うか明示することを推奨します。", "prompt"))
  }
}

function validateManualStep(step: Extract<WorkflowAuthoringStep, { type: "manual" }>, diagnostics: StepDraftDiagnostic[]): void {
  const message = step.userAction?.message
  if (!nonEmpty(step.prompt) && !nonEmpty(message)) {
    diagnostics.push(warning("manual.userAction.message.missing", "手動 step ですが、利用者向け操作メッセージがありません。", "userAction.message"))
  }
  if (step.includeState && step.includeState.length > 0 && !containsStateHint([step.prompt, message].filter(Boolean).join("\n"))) {
    diagnostics.push(warning("manual.prompt.stateHintMissing", "includeState を指定しています。操作メッセージ内で state をどう使うか明示することを推奨します。", "userAction.message"))
  }
  if (step.userAction?.completeLabel && step.userAction.completeLabel.length > 24) {
    diagnostics.push(warning("manual.userAction.completeLabel.long", "ボタン文言が長いため GUI で折り返される可能性があります。", "userAction.completeLabel"))
  }
  if (step.userAction?.confirmOnComplete === true && !nonEmpty(step.userAction.confirmMessage)) {
    diagnostics.push(info("manual.userAction.confirmMessage.default", "既定の確認文を使います。", "userAction.confirmMessage"))
  }
  if (typeof message === "string" && /command:/i.test(message)) {
    diagnostics.push(warning("manual.userAction.commandUri.ignored", "メッセージ内の command URI はリンクとして実行されません。", "userAction.message"))
  }
}

function validateCommandStep(step: Extract<WorkflowAuthoringStep, { type: "command" }>, diagnostics: StepDraftDiagnostic[]): void {
  const provider = step.action?.provider
  if (!nonEmpty(provider)) {
    diagnostics.push(error("command.provider.required", "command step では action.provider が必須です。", "action.provider"))
  }

  const args = Array.isArray(step.action?.args) ? step.action.args : []
  if (provider === "vscode.executeCommand" && !nonEmpty(args[0])) {
    diagnostics.push(error("command.commandId.required", "provider が vscode.executeCommand の場合は args[0] に command id が必要です。", "action.args[0]"))
  }

  if (step.sendResult === true && !nonEmpty(step.resultKey)) {
    diagnostics.push(warning("command.sendResult.withoutResultKey", "sendResult が true ですが resultKey が未設定です。後続 step から参照する場合は resultKey を指定してください。", "resultKey"))
  }

  if (step.sendResult === true && step.maxResultBytes === undefined) {
    diagnostics.push(warning("command.sendResult.withoutMaxResultBytes", "sendResult が true の command step では、巨大出力対策として maxResultBytes の指定を推奨します。", "maxResultBytes"))
  }

  if (step.completeOnSuccess === true && step.required === false) {
    diagnostics.push(warning("command.optionalCompleteOnSuccess", "required: false かつ completeOnSuccess: true です。任意 step の完了条件として意図通りか確認してください。", "completeOnSuccess"))
  }
}

function validateResultStep(step: Extract<WorkflowAuthoringStep, { type: "result" }>, diagnostics: StepDraftDiagnostic[]): void {
  const result = step.result
  if (!result) {
    diagnostics.push(error("result.required", "result step では result 定義が必須です。", "result"))
    return
  }

  if (result.source === "state" && !nonEmpty(result.stateKey)) {
    diagnostics.push(error("result.stateKey.required", "result.source が state の場合は result.stateKey が必須です。", "result.stateKey"))
  }

  if (result.source === "literal" && !nonEmpty(result.text)) {
    diagnostics.push(error("result.literal.required", "result.source が literal の場合は literal text が必須です。", "result.text"))
  }

  validateResultSinks(result, diagnostics)

  if (result.source === "state" && result.stateKey && step.resultKey && result.stateKey === step.resultKey) {
    diagnostics.push(error("result.stateKey.selfReference", "result.stateKey が同一 step の resultKey を参照しています。自己参照はできません。", "result.stateKey"))
  }
}

function validateResultSinks(result: ResultSourceDefinition, diagnostics: StepDraftDiagnostic[]): void {
  const sinks = Array.isArray(result.sinks) ? result.sinks : []
  if (sinks.length === 0) {
    diagnostics.push(warning("result.sinks.empty", "result step に sink がありません。結果をファイルや後続処理へ渡す必要があるか確認してください。", "result.sinks"))
  }
  sinks.forEach((sink: ResultSinkDefinition, index) => {
    if (sink.type !== "file") return
    if (!nonEmpty(sink.path)) diagnostics.push(error("result.fileSink.path.required", `file sink #${index + 1} の path は必須です。`, `result.sinks[${index}].path`))
    if (typeof sink.path === "string" && isWorkspaceEscapePath(sink.path)) diagnostics.push(error("result.fileSink.path.outsideWorkspace", `file sink #${index + 1} は workspace 外へ出ない相対パスを指定してください。`, `result.sinks[${index}].path`))
  })
}

function analyzeOriginalFieldChanges(
  model: WorkflowAuthoringModel,
  originalStep: WorkflowAuthoringStep | undefined,
  draftStep: WorkflowAuthoringStep,
  stepIndex: number,
  affectedReferences: StepDraftReferenceImpact[]
): void {
  if (!originalStep) return

  if (originalStep.type && draftStep.type && originalStep.type !== draftStep.type) {
    affectedReferences.push({
      severity: "warning",
      code: "step.type.changed",
      sourceField: "type",
      targetId: originalStep.id,
      message: `step type を ${originalStep.type} から ${draftStep.type} へ変更します。type 固有の field が削除または無視されないか確認してください。`
    })
  }

  if (nonEmpty(originalStep.id) && nonEmpty(draftStep.id) && originalStep.id !== draftStep.id) {
    for (const artifact of model.artifacts ?? []) {
      if (artifact.producedBy === originalStep.id) {
        affectedReferences.push({
          severity: "error",
          code: "step.id.change.breaksArtifact",
          sourceField: "id",
          targetId: artifact.id,
          message: `step id の変更により artifact '${artifact.id}' の producedBy が孤立します。`
        })
      }
    }
  }

  if (nonEmpty(originalStep.resultKey) && originalStep.resultKey !== draftStep.resultKey) {
    for (let index = stepIndex + 1; index < model.steps.length; index += 1) {
      const step = model.steps[index]
      if (step.includeState?.includes(originalStep.resultKey)) {
        affectedReferences.push({
          severity: "error",
          code: "step.resultKey.change.breaksIncludeState",
          sourceField: "resultKey",
          targetId: step.id,
          message: `resultKey の変更により step '${step.id}' の includeState '${originalStep.resultKey}' が孤立します。`
        })
      }
      if (step.type === "result" && step.result.source === "state" && step.result.stateKey === originalStep.resultKey) {
        affectedReferences.push({
          severity: "error",
          code: "step.resultKey.change.breaksResultStateKey",
          sourceField: "resultKey",
          targetId: step.id,
          message: `resultKey の変更により result step '${step.id}' の stateKey '${originalStep.resultKey}' が孤立します。`
        })
      }
    }
  }
}

function analyzeDraftReferenceState(
  model: WorkflowAuthoringModel,
  draftStep: WorkflowAuthoringStep,
  stepIndex: number,
  diagnostics: StepDraftDiagnostic[],
  affectedReferences: StepDraftReferenceImpact[]
): void {
  const draftModel: WorkflowAuthoringModel = {
    ...model,
    steps: model.steps.map((step, index) => index === stepIndex ? draftStep : step)
  }

  const duplicateIds = new Set<string>()
  const seen = new Set<string>()
  for (const step of draftModel.steps) {
    if (!step.id) continue
    if (seen.has(step.id)) duplicateIds.add(step.id)
    seen.add(step.id)
  }
  for (const id of duplicateIds) diagnostics.push(error("step.id.duplicate", `step id '${id}' が重複しています。`, "id"))

  const issues = analyzeAuthoringReferences(draftModel)
  const draftKeys = new Set<string>([draftStep.resultKey, ...(draftStep.includeState ?? [])].filter((key): key is string => Boolean(key)))
  for (const issue of issues) {
    const relatesToDraft = issue.stepIndex === stepIndex || issue.stepId === draftStep.id || Boolean(issue.key && draftKeys.has(issue.key))
    if (!relatesToDraft && !issue.artifactId) continue
    affectedReferences.push({
      severity: issue.severity,
      code: issue.kind,
      sourceField: issue.kind === "unknown-artifact-producer" ? "artifact" : "includeState",
      targetId: issue.stepId ?? issue.artifactId,
      message: issue.message
    })
  }
}

function containsStateHint(value: string | undefined): boolean {
  if (!value) return false
  return /state|includeState|入力|前段|結果|参照/.test(value)
}

function isWorkspaceEscapePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.split(/[\\/]+/).includes("..")
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function error(code: string, message: string, field?: string): StepDraftDiagnostic {
  return { severity: "error", code, message, field }
}

function warning(code: string, message: string, field?: string): StepDraftDiagnostic {
  return { severity: "warning", code, message, field }
}

function info(code: string, message: string, field?: string): StepDraftDiagnostic {
  return { severity: "info", code, message, field }
}
