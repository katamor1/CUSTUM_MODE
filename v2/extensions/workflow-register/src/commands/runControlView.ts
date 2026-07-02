import * as vscode from "vscode"
import { FileRunStateStore } from "../core/runStateStore"
import { fallbackWorkspaceRootCandidates, findWorkflowRootCandidates, MarkerRootCandidate } from "../core/workspaceRoots"
import { WorkflowRunState } from "../core/model"

interface RunViewItem {
  root: string
  run: WorkflowRunState
}

export class WorkflowRunControlView implements vscode.Disposable, vscode.TreeDataProvider<RunViewItem> {
  private readonly changeEmitter = new vscode.EventEmitter<RunViewItem | undefined | void>()
  readonly onDidChangeTreeData = this.changeEmitter.event
  private readonly statusBar: vscode.StatusBarItem
  private readonly disposables: vscode.Disposable[] = []
  private refreshTimer?: NodeJS.Timeout
  private latestItems: RunViewItem[] = []

  constructor() {
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
    this.statusBar.command = "workflowRegister.inspectRuns"
    this.statusBar.tooltip = "Bob Workflow Runs"
    this.disposables.push(this.statusBar)
  }

  start(): void {
    this.statusBar.show()
    void this.refresh()
    this.refreshTimer = setInterval(() => void this.refresh(), 15_000)
    this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refresh()))
  }

  async refresh(): Promise<void> {
    this.latestItems = await this.loadItems()
    this.updateStatusBar()
    this.changeEmitter.fire()
  }

  getTreeItem(item: RunViewItem): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(item.run.runId, vscode.TreeItemCollapsibleState.None)
    treeItem.description = `${item.run.status}${item.run.currentStep ? ` / ${item.run.currentStep}` : ""}`
    treeItem.tooltip = [
      `runId: ${item.run.runId}`,
      `workflow: ${item.run.workflowId}`,
      `status: ${item.run.status}`,
      `currentStep: ${item.run.currentStep ?? "none"}`,
      `root: ${item.root}`,
      `updatedAt: ${item.run.updatedAt}`
    ].join("\n")
    treeItem.iconPath = new vscode.ThemeIcon(iconForStatus(item.run.status))
    treeItem.contextValue = `workflowRun.${item.run.status}`
    treeItem.command = {
      command: "workflowRegister.inspectRunControl",
      title: "Inspect Run Control",
      arguments: [item.run.runId]
    }
    return treeItem
  }

  async getChildren(): Promise<RunViewItem[]> {
    if (this.latestItems.length === 0) this.latestItems = await this.loadItems()
    return this.latestItems
  }

  dispose(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer)
    this.changeEmitter.dispose()
    for (const disposable of this.disposables) disposable.dispose()
  }

  private async loadItems(): Promise<RunViewItem[]> {
    const roots = await workflowRootCandidates()
    const nested = await Promise.all(roots.map(async (candidate) => {
      const store = new FileRunStateStore({ workspaceRoot: candidate.root })
      const runs = await store.listRuns()
      return runs.slice(0, 25).map((run) => ({ root: candidate.root, run }))
    }))
    return nested.flat().sort((a, b) => b.run.updatedAt.localeCompare(a.run.updatedAt)).slice(0, 50)
  }

  private updateStatusBar(): void {
    const active = this.latestItems.filter((item) => item.run.status === "running" || item.run.status === "paused" || item.run.status === "reviewing" || item.run.status === "held")
    const running = active.filter((item) => item.run.status === "running").length
    const paused = active.filter((item) => item.run.status === "paused").length
    const reviewing = active.filter((item) => item.run.status === "reviewing").length
    const held = active.filter((item) => item.run.status === "held").length
    this.statusBar.text = active.length === 0
      ? "$(check) Bob Workflow"
      : `$(debug-pause) Bob Workflow ${running}r/${paused}p/${reviewing}v/${held}h`
    this.statusBar.tooltip = active.length === 0
      ? "No active Bob workflow runs"
      : `Active Bob workflow runs: ${running} running, ${paused} paused, ${reviewing} reviewing, ${held} held`
  }
}

function iconForStatus(status: WorkflowRunState["status"]): string {
  switch (status) {
    case "running": return "sync~spin"
    case "paused": return "debug-pause"
    case "reviewing": return "eye"
    case "held": return "watch"
    case "failed": return "error"
    case "completed": return "check"
    default: return "circle-outline"
  }
}

async function workflowRootCandidates(): Promise<MarkerRootCandidate[]> {
  const folders = vscode.workspace.workspaceFolders ?? []
  if (folders.length === 0) return []
  const markerRoots = await findWorkflowRootCandidates(folders)
  return markerRoots.length > 0 ? markerRoots : fallbackWorkspaceRootCandidates(folders)
}
