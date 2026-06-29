import * as path from "node:path"
import * as vscode from "vscode"
import { captureBobOutput } from "./core/bobOutputCapture"
import { validateBobOutput } from "./core/bobOutputValidator"
import { preprocessReview } from "./core/pipeline"
import { generateHumanTriage } from "./triage/humanTriageHelper"
import { buildCaptureWorkflowOptions } from "./workflowOptions"
import { initializeCodeConsistencyWorkspace } from "./workspaceInitializer"
import { resolveBobWorkspaceRoot } from "./workspaceResolver"

const WORKFLOW_REGISTER_EXTENSION_ID = "local.workflow-register"

interface WorkflowActionExecutionInput {
  args: unknown
  inputs: Record<string, unknown>
  state?: Record<string, string>
  workflowId?: string
  logicalWorkflowId?: string
  workflowRoot?: string
  workflowFile?: string
  workflowFolderName?: string
  bobRoot?: string
  workspaceRoot?: string
  runId?: string
  stepId?: string
}

interface WorkflowActionProvider {
  id: string
  execute: (input: WorkflowActionExecutionInput) => Promise<unknown> | unknown
}

interface WorkflowRegisterApi {
  registerActionProvider: (provider: WorkflowActionProvider) => void
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("bobCodeConsistency.initializeWorkspace", (options?: unknown) => runInitializeWorkspace(context, options)),
    vscode.commands.registerCommand("bobCodeConsistency.preprocess", (options?: unknown) => runPreprocess(options)),
    vscode.commands.registerCommand("bobCodeConsistency.captureBobOutput", (textOrOptions?: unknown) => runCaptureBobOutput(textOrOptions)),
    vscode.commands.registerCommand("bobCodeConsistency.validateOutput", (options?: unknown) => runValidateOutput(options)),
    vscode.commands.registerCommand("bobCodeConsistency.triage", (options?: unknown) => runTriage(options))
  )
  registerWorkflowProviders(context).catch((error) => console.warn("Bob コード整合ワークフロー provider の登録に失敗しました", error))
}

export function deactivate(): void {
  // No background resources are held by this extension.
}

async function registerWorkflowProviders(context: vscode.ExtensionContext): Promise<void> {
  const api = await getWorkflowRegisterApi()
  if (!api) return
  api.registerActionProvider({
    id: "bobCodeConsistency.initializeWorkspace",
    execute: (input) => runInitializeWorkspace(context, mergeWorkflowOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.preprocess",
    execute: (input) => runPreprocess(mergeWorkflowOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.captureBobOutput",
    execute: (input) => {
      const { args, inputs, state } = input
      return runCaptureBobOutput({ ...optionRecord(buildCaptureWorkflowOptions({ args, inputs, state })), ...workflowContextOptions(input) })
    }
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.validateOutput",
    execute: (input) => runValidateOutput(mergeWorkflowOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.triage",
    execute: (input) => runTriage(mergeWorkflowOptions(input))
  })
}

async function getWorkflowRegisterApi(): Promise<WorkflowRegisterApi | undefined> {
  const extension = vscode.extensions.getExtension<WorkflowRegisterApi>(WORKFLOW_REGISTER_EXTENSION_ID)
  if (!extension) {
    console.warn(`workflow-register 拡張機能が見つかりません: ${WORKFLOW_REGISTER_EXTENSION_ID}`)
    return undefined
  }
  const api = extension.isActive ? extension.exports : await extension.activate()
  if (!api?.registerActionProvider) {
    console.warn(`workflow-register 拡張機能が registerActionProvider を公開していません: ${WORKFLOW_REGISTER_EXTENSION_ID}`)
    return undefined
  }
  return api
}

async function runInitializeWorkspace(context: vscode.ExtensionContext, options?: unknown): Promise<unknown> {
  const record = optionRecord(options)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const result = await initializeCodeConsistencyWorkspace({ context, workspaceRoot })
  const suffix = result.backupPath ? `\n既存ファイルのバックアップ: ${result.backupPath}` : ""
  notifyInfo(`${result.message}${suffix}`)
  return result
}

async function runPreprocess(options?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(options)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const inputPath = absolute(workspaceRoot, stringOption(record, "reviewInputPath") ?? config.get<string>("reviewInputPath", "review-input.yaml"))
  const outDir = absolute(workspaceRoot, stringOption(record, "reviewPackagePath") ?? stringOption(record, "outDir") ?? config.get<string>("reviewPackagePath", ".bob-review/review-package"))
  const diffFixturePath = optionalAbsolute(workspaceRoot, stringOption(record, "diffFixturePath"))
  const bzrPath = stringOption(record, "bzrPath") ?? config.get<string>("bzrPath", "bzr")
  const textEncoding = stringOption(record, "textEncoding") ?? config.get<string>("textEncoding", "auto")

  const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "コード整合レビュー用パッケージを作成しています" }, () =>
    preprocessReview({ workspaceRoot, inputPath, outDir, diffFixturePath, bzrPath, textEncoding })
  )
  notifyInfo(result.summary)
  return result
}

async function runCaptureBobOutput(textOrOptions?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(textOrOptions)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const text = firstString(textOrOptions) ?? stringOption(record, "text") ?? await vscode.env.clipboard.readText()
  const bobOutputPath = absolute(workspaceRoot, stringOption(record, "bobOutputPath") ?? config.get<string>("bobOutputPath", ".bob-review/bob-output/bob-output.yaml"))
  const packageDir = absolute(workspaceRoot, stringOption(record, "reviewPackagePath") ?? stringOption(record, "packageDir") ?? config.get<string>("reviewPackagePath", ".bob-review/review-package"))
  const result = await captureBobOutput({ workspaceRoot, text, bobOutputPath, packageDir })
  if (result.status === "ok") notifyInfo(result.message)
  else notifyError(result.message)
  return result
}

async function runValidateOutput(options?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(options)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const packageDir = absolute(workspaceRoot, stringOption(record, "reviewPackagePath") ?? stringOption(record, "packageDir") ?? config.get<string>("reviewPackagePath", ".bob-review/review-package"))
  const bobOutputPath = absolute(workspaceRoot, stringOption(record, "bobOutputPath") ?? config.get<string>("bobOutputPath", ".bob-review/bob-output/bob-output.yaml"))
  const result = await validateBobOutput({ packageDir, bobOutputPath })
  if (result.errors.length === 0) notifyInfo(`Bob 出力 YAML は有効です（warning: ${result.warnings.length} 件）。`)
  else notifyError(`Bob 出力 YAML が無効です: error ${result.errors.length} 件。`)
  return { status: result.errors.length === 0 ? "ok" : "error", ...result }
}

async function runTriage(options?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(options)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const packageDir = absolute(workspaceRoot, stringOption(record, "reviewPackagePath") ?? stringOption(record, "packageDir") ?? config.get<string>("reviewPackagePath", ".bob-review/review-package"))
  const bobOutputPath = absolute(workspaceRoot, stringOption(record, "bobOutputPath") ?? config.get<string>("bobOutputPath", ".bob-review/bob-output/bob-output.yaml"))
  const outDir = absolute(workspaceRoot, stringOption(record, "triagePath") ?? stringOption(record, "outDir") ?? config.get<string>("triagePath", ".bob-review/human-triage"))
  const result = await generateHumanTriage({ packageDir, bobOutputPath, outDir })
  if (result.status === "ok") notifyInfo(`人間確認用 triage ファイルを生成しました: ${outDir}`)
  else notifyError(result.message)
  return result
}

function notifyInfo(message: string): void {
  console.info(message)
  vscode.window.setStatusBarMessage(message, 5000)
}

function notifyError(message: string): void {
  void vscode.window.showErrorMessage(message)
}

async function requireBobWorkspaceRoot(record: Record<string, unknown>): Promise<string> {
  const root = await resolveBobWorkspaceRoot({
    explicitRoot: stringOption(record, "bobRoot") ?? stringOption(record, "workspaceRoot"),
    workflowRoot: stringOption(record, "workflowRoot"),
    allowPick: true,
    title: "Bob ワークスペースを選択"
  })
  if (!root) throw new Error("先にワークスペースフォルダーを開いてください。")
  return root
}

function absolute(root: string, value: string): string {
  return path.isAbsolute(value) ? value : path.join(root, value)
}

function optionalAbsolute(root: string, value: string | undefined): string | undefined {
  return value ? absolute(root, value) : undefined
}

function mergeOptions(inputs: Record<string, unknown>, args: unknown): Record<string, unknown> {
  return { ...inputs, ...optionRecord(args) }
}

function mergeWorkflowOptions(input: WorkflowActionExecutionInput): Record<string, unknown> {
  return { ...mergeOptions(input.inputs, input.args), ...workflowContextOptions(input) }
}

function workflowContextOptions(input: WorkflowActionExecutionInput): Record<string, unknown> {
  return {
    workflowRoot: input.workflowRoot,
    workflowFile: input.workflowFile,
    workflowFolderName: input.workflowFolderName,
    bobRoot: input.bobRoot,
    workspaceRoot: input.workspaceRoot
  }
}

function optionRecord(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return optionRecord(value[0])
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
}

function stringOption(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item)
      if (found) return found
    }
  }
  return undefined
}
