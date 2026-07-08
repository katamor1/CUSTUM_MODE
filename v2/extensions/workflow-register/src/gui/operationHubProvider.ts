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

type OperationHubOpenInput = string | { runId?: string; stepId?: string; reason?: "stepGate" | "paused" }

const ACTION_COMMANDS: Partial<Record<OperationHubActionId, string>> = {
  openWorkflowBuilder: "workflowRegister.openWorkflowBuilder",
  validateWorkspaceWorkflows: "workflowRegister.validateWorkspaceWorkflows",
  openRunControl: "workflowRegister.inspectRunControl",
  openBazaarReview: "bobBazaar.openReviewGui",
  openConsistencyWizard: "bobCodeConsistency.openReviewWizard",
  runWorkflow: "workflowRegister.runWorkflow",
  startFromArtifacts: "workflowRegister.startFromStepWithArtifacts",
  resumeRun: "workflowRegister.resumePausedRun",
  retryCurrentStep: "workflowRegister.retryCurrentStep",
  acceptCurrentStep: "workflowRegister.acceptCurrentStep",
  acceptAndRunNextStep: "workflowRegister.acceptAndRunNextStep",
  runNextStep: "workflowRegister.runNextStep",
  openManualStepPanel: "workflowRegister.openManualStepPanel",
  pauseCurrentRun: "workflowRegister.pauseCurrentRun",
  inspectRunControl: "workflowRegister.inspectRunControl"
}

const RUN_ID_ACTIONS: readonly OperationHubActionId[] = [
  "resumeRun",
  "retryCurrentStep",
  "acceptCurrentStep",
  "acceptAndRunNextStep",
  "runNextStep",
  "openManualStepPanel",
  "pauseCurrentRun",
  "inspectRunControl",
  "openRunControl"
]

const RUN_MONITOR_WATCH_PATTERNS = [
  ".bob/workflows/runs/**/run.json",
  ".bob/workflows/runs/**/control.json",
  ".bob/workflows/runs/**/artifacts/manifest.json"
] as const

const RUN_MONITOR_REFRESH_DEBOUNCE_MS = 150
const ACTION_REFRESH_DELAYS_MS = [300, 1000, 2500, 5000] as const

export class OperationHubProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView
  private panel?: vscode.WebviewPanel
  private focusedRunId?: string
  private watchedRunRootsKey = ""
  private pendingAutoRefresh?: ReturnType<typeof setTimeout>
  private readonly actionRefreshTimers = new Set<ReturnType<typeof setTimeout>>()
  private readonly runWatcherDisposables: vscode.Disposable[] = []
  private readonly disposables: vscode.Disposable[] = []
  private readonly panelDisposables: vscode.Disposable[] = []

  constructor(private readonly options: OperationHubProviderOptions) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.options.extensionUri] }
    this.disposables.push(webviewView.webview.onDidReceiveMessage((message) => this.handleMessage(message)))
    void this.refresh()
  }

  async open(input?: unknown): Promise<void> {
    const parsed = this.applyOpenInput(input)
    if (parsed && typeof parsed !== "string" && (parsed.reason === "stepGate" || parsed.reason === "paused")) {
      await this.openPanel(parsed)
      return
    }
    await vscode.commands.executeCommand("workbench.view.explorer")
    await vscode.commands.executeCommand("workflowRegister.operationHub.focus")
    await this.refresh()
  }

  async refreshFromCommand(): Promise<void> {
    if (!this.view) {
      await this.open(this.focusedRunId)
      return
    }
    await this.refreshAll()
  }

  async openPanel(input?: unknown): Promise<void> {
    this.applyOpenInput(input)
    this.panel = this.ensurePanel()
    this.panel.reveal(vscode.ViewColumn.One)
    await this.refreshPanel()
  }

  async refresh(): Promise<void> {
    if (!this.view) return
    await this.renderIntoWebview(this.view.webview, "compact")
  }

  async refreshPanel(): Promise<void> {
    if (!this.panel) return
    await this.renderIntoWebview(this.panel.webview, "panel")
  }

  async refreshAll(): Promise<void> {
    await this.refresh()
    await this.refreshPanel()
  }

  dispose(): void {
    this.panel?.dispose()
    this.disposeRunMonitorWatchers()
    this.clearPendingAutoRefresh()
    this.clearActionRefreshTimers()
    while (this.panelDisposables.length > 0) this.panelDisposables.pop()?.dispose()
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
        await this.refreshAll()
        return
      }
      if (message.action === "openOperationHubPanel") {
        await this.openPanel(message.runId ? { runId: message.runId } : undefined)
        await this.refresh()
        return
      }
      if (message.action === "openArtifact") {
        await this.openArtifact(message.artifactPath)
        await this.refreshAll()
        return
      }
      const command = ACTION_COMMANDS[message.action]
      if (!command) {
        throw new Error(`Unsupported Operation Hub action: ${message.action}`)
      }
      this.scheduleActionRefreshes()
      await vscode.commands.executeCommand(command, ...commandArgsForAction(message))
      await this.refreshAll()
    } catch (error) {
      void vscode.window.showErrorMessage(`Bob Operation Hub: ${error instanceof Error ? error.message : String(error)}`)
      await this.refreshAll().catch((refreshError) => {
        console.warn("Bob Operation Hub refresh after action failure failed", refreshError)
      })
    }
  }

  private ensurePanel(): vscode.WebviewPanel {
    if (this.panel) return this.panel
    const panel = vscode.window.createWebviewPanel(
      "workflowRegister.operationHubPanel",
      "Bob Operation Hub",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.options.extensionUri]
      }
    )
    panel.webview.onDidReceiveMessage((message) => this.handleMessage(message), undefined, this.panelDisposables)
    panel.onDidDispose(() => this.disposePanel(), undefined, this.panelDisposables)
    this.panel = panel
    return panel
  }

  private disposePanel(): void {
    this.panel = undefined
    while (this.panelDisposables.length > 0) this.panelDisposables.pop()?.dispose()
  }

  private async renderIntoWebview(webview: vscode.Webview, layout: "compact" | "panel"): Promise<void> {
    const model = await this.loadModel()
    this.syncRunMonitorWatchers(model.home.workspaceRoots)
    webview.html = renderOperationHubHtml({
      cspSource: webview.cspSource,
      nonce: nonce(),
      model,
      refreshedAt: refreshTimestamp(),
      layout
    })
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
      runs: runs.flat(),
      focusedRunId: this.focusedRunId
    })
  }

  private syncRunMonitorWatchers(workspaceRoots: readonly string[]): void {
    const roots = Array.from(new Set(workspaceRoots.map((root) => path.resolve(root)))).sort()
    const nextKey = roots.join("\n")
    if (nextKey === this.watchedRunRootsKey) return

    this.disposeRunMonitorWatchers()
    this.watchedRunRootsKey = nextKey

    for (const root of roots) {
      for (const pattern of RUN_MONITOR_WATCH_PATTERNS) {
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, pattern))
        watcher.onDidCreate(() => this.scheduleRefreshAll())
        watcher.onDidChange(() => this.scheduleRefreshAll())
        watcher.onDidDelete(() => this.scheduleRefreshAll())
        this.runWatcherDisposables.push(watcher)
      }
    }
  }

  private disposeRunMonitorWatchers(): void {
    while (this.runWatcherDisposables.length > 0) {
      this.runWatcherDisposables.pop()?.dispose()
    }
    this.watchedRunRootsKey = ""
  }

  private scheduleRefreshAll(delayMs = RUN_MONITOR_REFRESH_DEBOUNCE_MS): void {
    this.clearPendingAutoRefresh()
    this.pendingAutoRefresh = setTimeout(() => {
      this.pendingAutoRefresh = undefined
      void this.refreshAll()
    }, delayMs)
  }

  private clearPendingAutoRefresh(): void {
    if (!this.pendingAutoRefresh) return
    clearTimeout(this.pendingAutoRefresh)
    this.pendingAutoRefresh = undefined
  }

  private scheduleActionRefreshes(): void {
    for (const delayMs of ACTION_REFRESH_DELAYS_MS) {
      const timer = setTimeout(() => {
        this.actionRefreshTimers.delete(timer)
        void this.refreshAll()
      }, delayMs)
      this.actionRefreshTimers.add(timer)
    }
  }

  private clearActionRefreshTimers(): void {
    for (const timer of this.actionRefreshTimers) clearTimeout(timer)
    this.actionRefreshTimers.clear()
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

  private applyOpenInput(input: unknown): OperationHubOpenInput | undefined {
    const parsed = parseOperationHubOpenInput(input)
    this.focusedRunId = typeof parsed === "string" ? parsed : parsed?.runId
    return parsed
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
  if (message.action === "startFromArtifacts") {
    return message.workflowId ? [message.workflowId, undefined, message.runId] : []
  }
  if (RUN_ID_ACTIONS.includes(message.action)) {
    return message.runId ? [message.runId] : []
  }
  return []
}

function parseOperationHubOpenInput(input: unknown): OperationHubOpenInput | undefined {
  if (typeof input === "string") return input.trim() ? input : undefined
  if (!input || typeof input !== "object") return undefined
  const candidate = input as Partial<Record<"runId" | "stepId" | "reason", unknown>>
  if (typeof candidate.runId !== "string" || candidate.runId.trim().length === 0) return undefined
  const parsed: OperationHubOpenInput = { runId: candidate.runId }
  if (typeof candidate.stepId === "string") parsed.stepId = candidate.stepId
  if (candidate.reason === "stepGate" || candidate.reason === "paused") parsed.reason = candidate.reason
  return parsed
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

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
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

function refreshTimestamp(): string {
  return new Date().toLocaleTimeString()
}

function nonce(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}
