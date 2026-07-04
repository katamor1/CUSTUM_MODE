import * as path from "node:path"
import { pathExists, readTextFile } from "./fileSystem"

export type BobOutputTextResult =
  | { ok: true; text: string; sourcePath: string; usedFallback: boolean }
  | { ok: false; error: string; checkedPaths: string[] }

export async function readBobOutputText(input: { bobOutputPath: string; packageDir?: string; includePrimary?: boolean; allowPackageFallback?: boolean }): Promise<BobOutputTextResult> {
  const candidates = bobOutputCandidatePaths(input)
  const checkedPaths: string[] = []
  const readErrors: string[] = []

  for (const candidate of candidates) {
    checkedPaths.push(candidate)
    if (!(await pathExists(candidate))) continue
    try {
      return {
        ok: true,
        text: await readTextFile(candidate),
        sourcePath: candidate,
        usedFallback: path.resolve(candidate) !== path.resolve(input.bobOutputPath)
      }
    } catch (error) {
      readErrors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const checked = checkedPaths.length > 0 ? checkedPaths.join(", ") : "(no candidate paths)"
  const suffix = readErrors.length > 0 ? ` Read errors: ${readErrors.join("; ")}` : ""
  return { ok: false, error: `Bob output YAML not found. Checked: ${checked}.${suffix}`, checkedPaths }
}

export function bobOutputCandidatePaths(input: { bobOutputPath: string; packageDir?: string; includePrimary?: boolean; allowPackageFallback?: boolean }): string[] {
  const candidates: string[] = []
  if (input.includePrimary !== false) candidates.push(input.bobOutputPath)
  if (input.packageDir && input.allowPackageFallback === true) candidates.push(path.join(input.packageDir, "bob-output.yaml"))
  return uniqueResolvedPaths(candidates)
}

function uniqueResolvedPaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of paths) {
    const resolved = path.resolve(item)
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved
    if (seen.has(key)) continue
    seen.add(key)
    result.push(resolved)
  }
  return result
}
