import * as path from "path"
import * as vscode from "vscode"
import {
  fallbackWorkspaceRootCandidates,
  findWorkflowRootCandidates,
  relativePathFromRoot
} from "./core/workspaceRoots"
import type { MarkerRootCandidate } from "./core/workspaceRoots"

export interface WorkflowFileCandidate {
  root: MarkerRootCandidate
  file: vscode.Uri
  relativePath: string
  folderName: string
}

export interface WorkflowDiscoveryResult {
  files: WorkflowFileCandidate[]
  diagnostics: string[]
}

export async function discoverWorkspaceWorkflowFiles(): Promise<WorkflowDiscoveryResult> {
  const diagnostics: string[] = []
  const candidates: WorkflowFileCandidate[] = []
  const folders = vscode.workspace.workspaceFolders ?? []
  const roots = await findWorkflowRootCandidates(folders)
  const searchRoots = roots.length > 0 ? roots : fallbackWorkspaceRootCandidates(folders)
  for (const root of searchRoots) {
    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(root.root, ".bob/workflows/*/WORKFLOW.md")
    )
    diagnostics.push(
      `- workspace: ${root.workspaceFolderName}; workflowRoot=${root.root}; marker=${root.marker}; depth=${root.depth}; workflow files: ${files.length}`
    )
    for (const file of files) {
      candidates.push({
        root,
        file,
        relativePath: relativePathFromRoot(root.root, file.fsPath),
        folderName: path.basename(path.dirname(file.fsPath))
      })
    }
  }
  return { files: candidates, diagnostics }
}
