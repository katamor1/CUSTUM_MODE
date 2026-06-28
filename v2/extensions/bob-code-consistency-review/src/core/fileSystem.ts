import * as fs from "node:fs/promises"
import * as path from "node:path"

export async function readTextFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8")
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

export function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/")
}

export function relativePosix(from: string, to: string): string {
  return toPosixPath(path.relative(from, to)) || "."
}
