import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import type { WorkflowRegisterApi } from "../extension"
import { FileRunStateStore } from "../core/runStateStore"
import { fallbackWorkspaceRootCandidates, findWorkflowRootCandidates, MarkerRootCandidate } from "../core/workspaceRoots"
import { renderOperationHubHtml } from "./operationHubHtml"
import {
  buildOperationHubModel,
  OPERATION_HUB_ALLOWED_ACTIONS,
  OperationHubActionId,
  OperationHubModel,
  OperationHubSetupState
} from "./operationHubModel"

interface OperationHubProviderOptions {
  api: WorkflowRegisterApi
  extensionUri: vscode.Uri
}

interface OperationHubMessage {
  type: "operationHub.action"
  action: OperationHubActionId
  workflowId?: string
  runId?: string
  artifactPath?: string
}

const ACTION_COMMANDS: Partial<Record<OperationHubActionId, string>> = {
  openWorkflowBuilder: "workflowRegister.openWorkflowBuilder",
  validateWorkspaceWorkflows: "workflowRegister.validateWorkspaceWorkflows",
  openRunControl: "workflowRegister.inspectRunControl",
  openBazaarReview: "bobBazaar.openReviewGui",
  openConsistencyWizard: "bobCodeConsistency.openReviewWizard",
  runWorkflow: "workflowRegister.runWorkflow",
  resumeRun: "workflowRegister.resumePausedRun",
  retryCurrentStep: "workflowRegister.retryCurrentStep",
  acceptCurrentStep: "workflowRegister.acceptCurrentStep",
  runNextStep: "workflowRegister.runNextStep",
  openManualStepPanel: "workflowRegister.openManualStepPanel",
  pauseCurrentRun: "workflowRegister.pauseCurrentRun",
  inspectRunControl: "workflowRegister.inspectRunControl"
}

export class OperationHubProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView
  private readonly disposables: vscode.Disposable[] = []

  constructor(private readonly options: OperationHubProviderOptions) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.options.extensionUri] }
    this.disposables.push(webviewView.webview.onDidReceiveMessage((message) => this.handleMessage(message)))
    void this.refresh()
  }

  async open(): Promise<void> {
    await vscode.commands.executeCommand("workbench.view.explorer")
    await vscode.commands.executeCommand("workflowRegister.operationHub.focus")
    await this.refresh()
  }

  async refresh(): Promise<void> {
    if (!this.view) return
    const model = await this.loadModel()
    this.view.webview.html = renderOperationHubHtml({
      cspSource: this.view.webview.cspSource,
      nonce: nonce(),
      model
    })
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose()
  }

  private async handleMessage(rawMessage: unknown): Promise<void> {
    const message = parseOperationHubMessage(rawMessage)
    if (!message) {
      void vscode.window.showWarningMessage("Bob Operation Hub: 不正な画面操作を拒否しました。")
      return
    }
    try {
      if (message.action === "refresh") {
        await this.refresh()
        return
      }
      if (message.action === "openArtifact") {
        await this.openArtifact(message.artifactPath)
        return
      }
      const command = ACTION_COMMANDS[message.action]
      if (!command) {
        throw new Error(`Unsupported Operation Hub action: ${message.action}`)
      }
      await vscode.commands.executeCommand(command, ...commandArgsForAction(message))
      await this.refresh()
    } catch (error) {
      void vscode.window.showErrorMessage(`Bob Operation Hub: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async loadModel(): Promise<OperationHubModel> {
    const folders = vscode.workspace.workspaceFolders ?? []
    const roots = await workflowRootCandidates(folders)
    const runs = await Promise.all(roots.map(async (candidate) => {
      const store = new FileRunStateStore({ workspaceRoot: candidate.root })
      const runStates = await store.listRuns()
      return runStates.map((run) => ({ root: candidate.root, run }))
    }))
    return buildOperationHubModel({
      workspaceName: folders.length === 0 ? "No workspace" : folders.map((folder) => folder.name).join(", "),
      workspaceRoots: roots.map((candidate) => candidate.root),
      extensionStatus: [
        extensionStatus("IBM.bob-code", "IBM Bob"),
        extensionStatus("local.bob-bazaar-review", "Bob Bazaar Review"),
        extensionStatus("local.bob-code-consistency-review", "Bob Code Consistency Review")
      ],
      setup: await setupState(roots),
      workflows: this.options.api.listWorkflows(),
      runs: runs.flat()
    })
  }

  private async openArtifact(artifactPath?: string): Promise<void> {
    if (!artifactPath) throw new Error("artifact path が指定されていません。")
    const roots = (await workflowRootCandidates(vscode.workspace.workspaceFolders ?? [])).map((candidate) => candidate.root)
    const resolved = path.resolve(artifactPath)
    if (!roots.some((root) => isContainedPath(root, resolved))) {
      throw new Error("workspace 外の成果物は開けません。")
    }
    await vscode.window.showTextDocument(vscode.Uri.file(resolved), { preview: false })
  }
}

export function parseOperationHubMessage(message: unknown): OperationHubMessage | undefined {
  if (!message || typeof message !== "object") return undefined
  const candidate = message as Partial<Record<keyof OperationHubMessage, unknown>>
  if (candidate.type !== "operationHub.action") return undefined
  if (typeof candidate.action !== "string" || !isAllowedAction(candidate.action)) return undefined
  return {
    type: "operationHub.action",
    action: candidate.action,
    workflowId: typeof candidate.workflowId === "string" ? candidate.workflowId : undefined,
    runId: typeof candidate.runId === "string" ? candidate.runId : undefined,
    artifactPath: typeof candidate.artifactPath === "string" ? candidate.artifactPath : undefined
  }
}

function commandArgsForAction(message: OperationHubMessage): unknown[] {
  if (message.action === "runWorkflow") return message.workflowId ? [message.workflowId] : []
  if (["resumeRun", "retryCurrentStep", "acceptCurrentStep", "runNextStep", "openManualStepPanel", "pauseCurrentRun", "inspectRunControl", "openRunControl"].includes(message.action)) {
    return message.runId ? [message.runId] : []
  }
  return []
}

async function workflowRootCandidates(folders: readonly vscode.WorkspaceFolder[]): Promise<MarkerRootCandidate[]> {
  if (folders.length === 0) return []
  const markerRoots = await findWorkflowRootCandidates(folders)
  return markerRoots.length > 0 ? markerRoots : fallbackWorkspaceRootCandidates(folders)
}

function extensionStatus(id: string, label: string) {
  return { id, label, available: Boolean(vscode.extensions.getExtension(id)) }
}

async function setupState(roots: readonly MarkerRootCandidate[]): Promise<OperationHubSetupState> {
  const checks = await Promise.all(roots.map(async (candidate) => ({
    bobRootPresent: await exists(path.join(candidate.root, ".bob")),
    workflowsPresent: await exists(path.join(candidate.root, ".bob", "workflows")),
    runStatePresent: await exists(path.join(candidate.root, ".bob", "workflows", "runs")),
    mcpConfigPresent: await exists(path.join(candidate.root, ".bob", "mcp.json")),
    traceabilityPresent: await exists(path.join(candidate.root, ".bob-trace"))
  })))
  return {
    bobRootPresent: checks.some((check) => check.bobRootPresent),
    workflowsPresent: checks.some((check) => check.workflowsPresent),
    runStatePresent: checks.some((check) => check.runStatePresent),
    mcpConfigPresent: checks.some((check) => check.mcpConfigPresent),
    traceabilityPresent: checks.some((check) => check.traceabilityPresent)
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath)
    return true
  } catch {
    return false
  }
}

function isAllowedAction(action: string): action is OperationHubActionId {
  return (OPERATION_HUB_ALLOWED_ACTIONS as readonly string[]).includes(action)
}

function isContainedPath(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function nonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  let value = ""
  for (let i = 0; i < 24; i += 1) value += alphabet[Math.floor(Math.random() * alphabet.length)]
  return value
}
