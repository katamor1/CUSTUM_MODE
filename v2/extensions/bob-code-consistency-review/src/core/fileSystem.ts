import * as fs from "node:fs/promises"
import * as path from "node:path"
import { decodeTextBuffer } from "./textEncoding"

export async function readTextFile(filePath: string, encoding = "auto"): Promise<string> {
  return decodeTextBuffer(await fs.readFile(filePath), encoding)
}

export async function writeTextFile(filePath: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, text, "utf8")
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeTextFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export function resolveWorkspacePath(workspaceRoot: string, value: string): string {
  return path.isAbsolute(value) ? value : path.join(workspaceRoot, value)
}

export function resolveWorkspacePathStrict(workspaceRoot: string, value: string, label = "path"): string {
  const root = path.resolve(workspaceRoot)
  const resolved = path.resolve(path.isAbsolute(value) ? value : path.join(root, value))
  if (!isInsidePath(root, resolved)) throw new Error(`${label} escapes workspace: ${value}`)
  return resolved
}

export function isInsidePath(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

export function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/")
}

export function relativePosix(from: string, to: string): string {
  return toPosixPath(path.relative(from, to)) || "."
}
