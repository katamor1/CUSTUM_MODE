import * as path from "node:path"
import * as vscode from "vscode"
import { findMarkerRoots, MarkerRootCandidate, rootHasMarker } from "./workspaceRoots"

interface ResolveBobWorkspaceOptions {
  explicitRoot?: string
  workflowRoot?: string
  allowPick?: boolean
  title?: string
}

export async function resolveBobWorkspaceRoot(options: ResolveBobWorkspaceOptions = {}): Promise<string | undefined> {
  if (options.explicitRoot) return path.resolve(options.explicitRoot)
  if (options.workflowRoot && await rootHasMarker(options.workflowRoot, ".bob")) return path.resolve(options.workflowRoot)

  const folders = vscode.workspace.workspaceFolders ?? []
  if (folders.length === 0) return undefined

  const candidates = await findMarkerRoots(folders, ".bob")
  const activeUri = vscode.window.activeTextEditor?.document.uri
  const activeCandidate = activeUri?.scheme === "file" ? candidateForFile(candidates, activeUri.fsPath) : undefined
  if (activeCandidate) return activeCandidate.root
  if (candidates.length === 1) return candidates[0].root
  if (candidates.length > 1 && options.allowPick !== false) return pickCandidate(candidates, options.title ?? "Select Bob workspace")

  if (folders.length === 1) return folders[0].uri.fsPath
  if (options.allowPick === false) return undefined
  const picked = await vscode.window.showQuickPick(
    folders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, root: folder.uri.fsPath })),
    { title: options.title ?? "Select Bob workspace" }
  )
  return picked?.root
}

function candidateForFile(candidates: MarkerRootCandidate[], filePath: string): MarkerRootCandidate | undefined {
  const resolved = path.resolve(filePath)
  return candidates
    .filter((candidate) => isInside(candidate.root, resolved))
    .sort((a, b) => b.root.length - a.root.length)[0]
}

async function pickCandidate(candidates: MarkerRootCandidate[], title: string): Promise<string | undefined> {
  const picked = await vscode.window.showQuickPick(
    candidates.map((candidate) => ({
      label: candidate.name,
      description: candidate.root,
      detail: `${candidate.marker}; ${candidate.depth}; workspace=${candidate.workspaceFolderName}`,
      candidate
    })),
    { title }
  )
  return picked?.candidate.root
}

function isInside(root: string, filePath: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(filePath))
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}
