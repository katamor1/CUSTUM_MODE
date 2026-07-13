import * as vscode from "vscode"
import { ARTIFACT_MANIFEST_STATE_KEY, ARTIFACT_REUSE_STATE_KEY } from "../core/artifacts"
import type { WorkflowRunState } from "../core/model"
import { FileRunStateStore, isWorkflowRunStateWritable } from "../core/runStateStore"
import { fallbackWorkspaceRootCandidates, findWorkflowRootCandidates } from "../core/workspaceRoots"
import type { MarkerRootCandidate } from "../core/workspaceRoots"

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
    const artifactStatus = artifactStatusForRun(item.run)
    const writable = isWorkflowRunStateWritable(item.run)
    const treeItem = new vscode.TreeItem(item.run.runId, vscode.TreeItemCollapsibleState.None)
    treeItem.description = [
      item.run.status,
      writable ? undefined : "read-only",
      item.run.currentStep,
      artifactStatus.description
    ].filter(Boolean).join(" / ")
    treeItem.tooltip = [
      `runId: ${item.run.runId}`,
      `workflow: ${item.run.workflowId}`,
      `status: ${item.run.status}`,
      `run state schema: ${item.run.schemaVersion ?? "unversioned"}`,
      writable ? undefined : "run state access: read-only",
      `currentStep: ${item.run.currentStep ?? "none"}`,
      artifactStatus.tooltip,
      `root: ${item.root}`,
      `updatedAt: ${item.run.updatedAt}`
    ].filter(Boolean).join("\n")
    treeItem.iconPath = new vscode.ThemeIcon(writable ? iconForRun(item.run) : "lock")
    treeItem.contextValue = writable ? `workflowRun.${item.run.status}` : "workflowRun.readOnly"
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
    const active = this.latestItems.filter((item) => isWorkflowRunStateWritable(item.run) && (
      item.run.status === "running"
      || item.run.status === "paused"
      || item.run.status === "reviewing"
      || item.run.status === "held"
    ))
    const running = active.filter((item) => item.run.status === "running").length
    const paused = active.filter((item) => item.run.status === "paused").length
    const reviewing = active.filter((item) => item.run.status === "reviewing").length
    const held = active.filter((item) => item.run.status === "held").length
    const reused = this.latestItems.filter((item) => Boolean(item.run.state[ARTIFACT_REUSE_STATE_KEY])).length
    const readOnly = this.latestItems.filter((item) => !isWorkflowRunStateWritable(item.run)).length
    this.statusBar.text = active.length === 0
      ? reused > 0 ? `$(check) Bob Workflow / ${reused} reused${readOnly > 0 ? ` / ${readOnly} read-only` : ""}` : `$(check) Bob Workflow${readOnly > 0 ? ` / ${readOnly} read-only` : ""}`
      : `$(debug-pause) Bob Workflow ${running}r/${paused}p/${reviewing}v/${held}h${reused > 0 ? `/${reused}u` : ""}${readOnly > 0 ? `/${readOnly}ro` : ""}`
    this.statusBar.tooltip = active.length === 0
      ? reused > 0 ? `No active Bob workflow runs; ${reused} run(s) reused artifacts${readOnly > 0 ? `; ${readOnly} read-only run(s)` : ""}` : `No active Bob workflow runs${readOnly > 0 ? `; ${readOnly} read-only run(s)` : ""}`
      : `Active Bob workflow runs: ${running} running, ${paused} paused, ${reviewing} reviewing, ${held} held${reused > 0 ? `; ${reused} reused artifact run(s)` : ""}${readOnly > 0 ? `; ${readOnly} read-only run(s)` : ""}`
  }
}

function artifactStatusForRun(run: WorkflowRunState): { description?: string; tooltip?: string } {
  const reuse = parseReuse(run.state[ARTIFACT_REUSE_STATE_KEY])
  if (reuse) {
    const reusedStepCount = Array.isArray(reuse.reusedStepIds) ? reuse.reusedStepIds.length : 0
    const hydratedKeyCount = Array.isArray(reuse.hydratedKeys) ? reuse.hydratedKeys.length : 0
    return {
      description: `reused ${reusedStepCount}`,
      tooltip: `artifact reuse: ${reusedStepCount} step(s), ${hydratedKeyCount} state key(s), source=${reuse.sourceRunId ?? "unknown"}, start=${reuse.startStepId ?? "unknown"}`
    }
  }
  if (typeof run.state[ARTIFACT_MANIFEST_STATE_KEY] === "string") {
    return {
      description: "artifacts",
      tooltip: "artifact manifest is available for skip resume"
    }
  }
  return {}
}

function iconForRun(run: WorkflowRunState): string {
  if (run.state[ARTIFACT_REUSE_STATE_KEY]) return "references"
  if (run.state[ARTIFACT_MANIFEST_STATE_KEY]) return "archive"
  return iconForStatus(run.status)
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

function parseReuse(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string") return undefined
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

async function workflowRootCandidates(): Promise<MarkerRootCandidate[]> {
  const folders = vscode.workspace.workspaceFolders ?? []
  if (folders.length === 0) return []
  const markerRoots = await findWorkflowRootCandidates(folders)
  return markerRoots.length > 0 ? markerRoots : fallbackWorkspaceRootCandidates(folders)
}
