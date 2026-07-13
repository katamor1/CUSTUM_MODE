import * as fs from "fs"
import * as path from "path"

export function resolveWorkspaceRootIdentity(workspaceRoot: string): string {
  const resolved = path.resolve(workspaceRoot)
  try {
    return fs.realpathSync.native(resolved)
  } catch {
    return resolved
  }
}

export function normalizeWorkspaceRootIdentity(workspaceRoot: string): string {
  const identity = resolveWorkspaceRootIdentity(workspaceRoot)
  return process.platform === "win32" ? identity.toLowerCase() : identity
}
