import * as fs from "fs/promises"
import * as path from "path"

export interface WorkspaceFolderLike {
  name: string
  uri: { fsPath: string }
}

export interface MarkerRootCandidate {
  root: string
  name: string
  marker: string
  depth: "direct" | "child"
  workspaceFolderName: string
  workspaceFolderRoot: string
}

export async function findWorkflowRootCandidates(folders: readonly WorkspaceFolderLike[]): Promise<MarkerRootCandidate[]> {
  return findMarkerRoots(folders, ".bob")
}

export async function findMarkerRoots(folders: readonly WorkspaceFolderLike[], marker: string): Promise<MarkerRootCandidate[]> {
  const direct: MarkerRootCandidate[] = []
  for (const folder of folders) {
    const root = path.resolve(folder.uri.fsPath)
    if (await rootHasMarker(root, marker)) {
      direct.push(candidate(root, folder.name, marker, "direct", folder))
    }
  }
  if (direct.length > 0) return sortCandidates(direct)

  const child: MarkerRootCandidate[] = []
  for (const folder of folders) {
    const root = path.resolve(folder.uri.fsPath)
    for (const entry of await safeReadDir(root)) {
      if (!entry.isDirectory()) continue
      const childRoot = path.join(root, entry.name)
      if (await rootHasMarker(childRoot, marker)) {
        child.push(candidate(childRoot, entry.name, marker, "child", folder))
      }
    }
  }
  return sortCandidates(child)
}

export async function rootHasMarker(root: string, marker: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(root, marker))
    return stat.isDirectory()
  } catch {
    return false
  }
}

export function workspaceRootFromFile(filePath: string, marker: string): string | undefined {
  const resolved = path.resolve(filePath)
  const parts = resolved.split(path.sep)
  const markerIndex = parts.lastIndexOf(marker)
  if (markerIndex <= 0) return undefined
  const root = parts.slice(0, markerIndex).join(path.sep)
  return root || path.parse(resolved).root
}

export function relativePathFromRoot(root: string, filePath: string): string {
  return path.relative(root, filePath).replace(/\\/g, "/")
}

export function fallbackWorkspaceRootCandidates(folders: readonly WorkspaceFolderLike[]): MarkerRootCandidate[] {
  return sortCandidates(folders.map((folder) => candidate(path.resolve(folder.uri.fsPath), folder.name, ".bob", "direct", folder)))
}

function candidate(root: string, name: string, marker: string, depth: "direct" | "child", folder: WorkspaceFolderLike): MarkerRootCandidate {
  return {
    root,
    name,
    marker,
    depth,
    workspaceFolderName: folder.name,
    workspaceFolderRoot: path.resolve(folder.uri.fsPath)
  }
}

async function safeReadDir(root: string): Promise<Array<{ name: string; isDirectory: () => boolean }>> {
  try {
    return await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
}

function sortCandidates(candidates: MarkerRootCandidate[]): MarkerRootCandidate[] {
  return [...candidates].sort((a, b) => a.root.localeCompare(b.root))
}
