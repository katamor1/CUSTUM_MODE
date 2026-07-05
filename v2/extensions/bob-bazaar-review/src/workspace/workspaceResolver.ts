import * as path from "path"
import * as vscode from "vscode"
import { findMarkerRoots, MarkerRootCandidate, rootHasMarker } from "./workspaceRoots"

interface ResolveMarkerWorkspaceOptions {
  explicitRoot?: string
  workflowRoot?: string
  allowPick?: boolean
  title?: string
}

export async function resolveBazaarWorkspaceFolder(options: ResolveMarkerWorkspaceOptions = {}): Promise<vscode.WorkspaceFolder | undefined> {
  return resolveMarkerWorkspaceFolder(".bzr", "Bazaar", options)
}

export async function resolveBobWorkspaceFolder(options: ResolveMarkerWorkspaceOptions = {}): Promise<vscode.WorkspaceFolder | undefined> {
  return resolveMarkerWorkspaceFolder(".bob", "Bob", options)
}

async function resolveMarkerWorkspaceFolder(marker: string, label: string, options: ResolveMarkerWorkspaceOptions): Promise<vscode.WorkspaceFolder | undefined> {
  if (options.explicitRoot) {
    const explicitRoot = path.resolve(options.explicitRoot)
    if (await rootHasMarker(explicitRoot, marker)) return folderFromRoot(explicitRoot)
    if (options.allowPick !== false) {
      await vscode.window.showWarningMessage(`${label} 明示rootに ${marker} が見つかりません: ${explicitRoot}`)
    }
    return undefined
  }
  if (options.workflowRoot && await rootHasMarker(options.workflowRoot, marker)) {
    return folderFromRoot(path.resolve(options.workflowRoot))
  }

  const folders = vscode.workspace.workspaceFolders ?? []
  if (folders.length === 0) {
    if (options.allowPick !== false) await vscode.window.showWarningMessage(`${label} ワークスペースフォルダーを先に開いてください。`)
    return undefined
  }

  const candidates = await findMarkerRoots(folders, marker)
  const activeUri = vscode.window.activeTextEditor?.document.uri
  const activeCandidate = activeUri?.scheme === "file" ? candidateForFile(candidates, activeUri.fsPath) : undefined
  if (activeCandidate) return folderFromCandidate(activeCandidate)
  if (candidates.length === 1) return folderFromCandidate(candidates[0])
  if (candidates.length > 1 && options.allowPick !== false) return pickCandidate(candidates, options.title ?? `${label} ワークスペースを選択`)

  if (folders.length === 1) return folders[0]
  if (options.allowPick === false) return undefined
  const picked = await vscode.window.showQuickPick(
    folders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, folder })),
    { title: options.title ?? `${label} ワークスペースを選択` }
  )
  return picked?.folder
}

function candidateForFile(candidates: MarkerRootCandidate[], filePath: string): MarkerRootCandidate | undefined {
  const resolved = path.resolve(filePath)
  return candidates
    .filter((candidate) => isInside(candidate.root, resolved))
    .sort((a, b) => b.root.length - a.root.length)[0]
}

async function pickCandidate(candidates: MarkerRootCandidate[], title: string): Promise<vscode.WorkspaceFolder | undefined> {
  const picked = await vscode.window.showQuickPick(
    candidates.map((candidate) => ({
      label: candidate.name,
      description: candidate.root,
      detail: `${candidate.marker}; ${candidate.depth}; workspace=${candidate.workspaceFolderName}`,
      candidate
    })),
    { title }
  )
  return picked ? folderFromCandidate(picked.candidate) : undefined
}

function folderFromCandidate(candidate: MarkerRootCandidate): vscode.WorkspaceFolder {
  return folderFromRoot(candidate.root, candidate.name)
}

function folderFromRoot(root: string, name = path.basename(root)): vscode.WorkspaceFolder {
  return { uri: vscode.Uri.file(root), name, index: -1 }
}

function isInside(root: string, filePath: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(filePath))
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}
