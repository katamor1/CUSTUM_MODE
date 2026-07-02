import * as vscode from "vscode"
import type { RunStateStore } from "./core/runStateStore"
import type { MarkerRootCandidate } from "./core/workspaceRoots"

export interface RunSelection {
  root: string
  runId: string
  run?: Awaited<ReturnType<RunStateStore["loadRun"]>>
}

export async function listRunSelections(
  roots: MarkerRootCandidate[],
  createRunStore: (workspaceRoot: string) => RunStateStore
): Promise<RunSelection[]> {
  const nested = await Promise.all(roots.map(async (candidate) => {
    const runStore = createRunStore(candidate.root)
    const runs = await runStore.listRuns()
    return runs.map((run) => ({ root: candidate.root, runId: run.runId, run }))
  }))
  return nested.flat().sort((a, b) => (b.run?.updatedAt ?? "").localeCompare(a.run?.updatedAt ?? ""))
}

export async function pickRunSelection(
  roots: MarkerRootCandidate[],
  createRunStore: (workspaceRoot: string) => RunStateStore
): Promise<RunSelection | undefined> {
  const selections = await listRunSelections(roots, createRunStore)
  if (selections.length === 0) return undefined
  const picked = await vscode.window.showQuickPick(selections.map((selection) => ({
    label: selection.runId,
    description: selection.run?.status,
    detail: `${selection.run?.workflowId}; root=${selection.root}; currentStep=${selection.run?.currentStep ?? "none"}`,
    selection
  })), { title: "Workflow Run" })
  return picked?.selection
}

export async function findRunSelection(
  runId: string,
  roots: MarkerRootCandidate[],
  createRunStore: (workspaceRoot: string) => RunStateStore
): Promise<RunSelection | undefined> {
  return (await listRunSelections(roots, createRunStore)).find((selection) => selection.runId === runId)
}
