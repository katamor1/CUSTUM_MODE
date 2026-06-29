import * as vscode from "vscode"
import { fallbackWorkspaceRootCandidates, findWorkflowRootCandidates, relativePathFromRoot, workspaceRootFromFile } from "../core/workspaceRoots"

export async function pickWorkflowRoot(title: string): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? []
  if (folders.length === 0) return undefined
  const markerRoots = await findWorkflowRootCandidates(folders)
  const candidates = markerRoots.length > 0 ? markerRoots : fallbackWorkspaceRootCandidates(folders)
  if (candidates.length === 1) return candidates[0].root
  const picked = await vscode.window.showQuickPick(candidates.map((candidate) => ({
    label: candidate.name,
    description: candidate.root,
    detail: `${candidate.marker}; ${candidate.depth}; workspace=${candidate.workspaceFolderName}`,
    candidate
  })), { title })
  return picked?.candidate.root
}

export function workflowRootForUri(uri: vscode.Uri): string | undefined {
  return uri.scheme === "file" ? workspaceRootFromFile(uri.fsPath, ".bob") : undefined
}

export async function pickWorkflowRootForUri(uri: vscode.Uri, title: string): Promise<string | undefined> {
  return workflowRootForUri(uri) ?? await pickWorkflowRoot(title)
}

export function workflowRelativePath(uri: vscode.Uri): string {
  const root = workflowRootForUri(uri)
  return root ? relativePathFromRoot(root, uri.fsPath) : vscode.workspace.asRelativePath(uri, false)
}
