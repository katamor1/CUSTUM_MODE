import * as path from "node:path"
import * as vscode from "vscode"
import { captureBobOutput } from "./core/bobOutputCapture"
import { validateBobOutput } from "./core/bobOutputValidator"
import { preprocessReview } from "./core/pipeline"
import { generateHumanTriage } from "./triage/humanTriageHelper"
import { buildCaptureWorkflowOptions } from "./workflowOptions"

const WORKFLOW_REGISTER_EXTENSION_ID = "local.workflow-register"

interface WorkflowActionExecutionInput {
  args: unknown
  inputs: Record<string, unknown>
  state?: Record<string, string>
  workflowId?: string
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
    vscode.commands.registerCommand("bobCodeConsistency.preprocess", (options?: unknown) => runPreprocess(options)),
    vscode.commands.registerCommand("bobCodeConsistency.captureBobOutput", (textOrOptions?: unknown) => runCaptureBobOutput(textOrOptions)),
    vscode.commands.registerCommand("bobCodeConsistency.validateOutput", (options?: unknown) => runValidateOutput(options)),
    vscode.commands.registerCommand("bobCodeConsistency.triage", (options?: unknown) => runTriage(options))
  )
  registerWorkflowProviders(context).catch((error) => console.warn("Bob code consistency workflow provider registration failed", error))
}

export function deactivate(): void {
  // No background resources are held by this extension.
}

async function registerWorkflowProviders(_context: vscode.ExtensionContext): Promise<void> {
  const api = await getWorkflowRegisterApi()
  if (!api) return
  api.registerActionProvider({
    id: "bobCodeConsistency.preprocess",
    execute: ({ args, inputs }) => runPreprocess(mergeOptions(inputs, args))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.captureBobOutput",
    execute: ({ args, inputs, state }) => runCaptureBobOutput(buildCaptureWorkflowOptions({ args, inputs, state }))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.validateOutput",
    execute: ({ args, inputs }) => runValidateOutput(mergeOptions(inputs, args))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.triage",
    execute: ({ args, inputs }) => runTriage(mergeOptions(inputs, args))
  })
}

async function getWorkflowRegisterApi(): Promise<WorkflowRegisterApi | undefined> {
  const extension = vscode.extensions.getExtension<WorkflowRegisterApi>(WORKFLOW_REGISTER_EXTENSION_ID)
  if (!extension) {
    console.warn(`Workflow register extension is not installed: ${WORKFLOW_REGISTER_EXTENSION_ID}`)
    return undefined
  }
  const api = extension.isActive ? extension.exports : await extension.activate()
  if (!api?.registerActionProvider) {
    console.warn(`Workflow register extension does not expose registerActionProvider: ${WORKFLOW_REGISTER_EXTENSION_ID}`)
    return undefined
  }
  return api
}

async function runPreprocess(options?: unknown): Promise<unknown> {
  const workspaceRoot = requireWorkspaceRoot()
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(options)
  const inputPath = absolute(workspaceRoot, stringOption(record, "reviewInputPath") ?? config.get<string>("reviewInputPath", "review-input.yaml"))
  const outDir = absolute(workspaceRoot, stringOption(record, "reviewPackagePath") ?? stringOption(record, "outDir") ?? config.get<string>("reviewPackagePath", ".bob-review/review-package"))
  const diffFixturePath = optionalAbsolute(workspaceRoot, stringOption(record, "diffFixturePath"))

  const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Preparing code consistency review package" }, () =>
    preprocessReview({ workspaceRoot, inputPath, outDir, diffFixturePath })
  )
  await vscode.window.showInformationMessage(result.summary)
  return result
}

async function runCaptureBobOutput(textOrOptions?: unknown): Promise<unknown> {
  const workspaceRoot = requireWorkspaceRoot()
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(textOrOptions)
  const text = firstString(textOrOptions) ?? stringOption(record, "text") ?? await vscode.env.clipboard.readText()
  const bobOutputPath = absolute(workspaceRoot, stringOption(record, "bobOutputPath") ?? config.get<string>("bobOutputPath", ".bob-review/bob-output/bob-output.yaml"))
  const result = await captureBobOutput({ workspaceRoot, text, bobOutputPath })
  if (result.status === "ok") await vscode.window.showInformationMessage(result.message)
  else await vscode.window.showErrorMessage(result.message)
  return result
}

async function runValidateOutput(options?: unknown): Promise<unknown> {
  const workspaceRoot = requireWorkspaceRoot()
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(options)
  const packageDir = absolute(workspaceRoot, stringOption(record, "reviewPackagePath") ?? stringOption(record, "packageDir") ?? config.get<string>("reviewPackagePath", ".bob-review/review-package"))
  const bobOutputPath = absolute(workspaceRoot, stringOption(record, "bobOutputPath") ?? config.get<string>("bobOutputPath", ".bob-review/bob-output/bob-output.yaml"))
  const result = await validateBobOutput({ packageDir, bobOutputPath })
  if (result.errors.length === 0) await vscode.window.showInformationMessage(`Bob output is valid (${result.warnings.length} warning(s)).`)
  else await vscode.window.showErrorMessage(`Bob output is invalid: ${result.errors.length} error(s).`)
  return { status: result.errors.length === 0 ? "ok" : "error", ...result }
}

async function runTriage(options?: unknown): Promise<unknown> {
  const workspaceRoot = requireWorkspaceRoot()
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(options)
  const packageDir = absolute(workspaceRoot, stringOption(record, "reviewPackagePath") ?? stringOption(record, "packageDir") ?? config.get<string>("reviewPackagePath", ".bob-review/review-package"))
  const bobOutputPath = absolute(workspaceRoot, stringOption(record, "bobOutputPath") ?? config.get<string>("bobOutputPath", ".bob-review/bob-output/bob-output.yaml"))
  const outDir = absolute(workspaceRoot, stringOption(record, "triagePath") ?? stringOption(record, "outDir") ?? config.get<string>("triagePath", ".bob-review/human-triage"))
  const result = await generateHumanTriage({ packageDir, bobOutputPath, outDir })
  await vscode.window.showInformationMessage(`Generated human triage files: ${outDir}`)
  return result
}

function requireWorkspaceRoot(): string {
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (!folder) throw new Error("Open a workspace folder first.")
  return folder.uri.fsPath
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
