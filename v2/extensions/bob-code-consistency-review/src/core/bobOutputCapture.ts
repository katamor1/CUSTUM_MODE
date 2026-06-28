import * as path from "node:path"
import YAML from "yaml"
import { writeTextFile } from "./fileSystem"

export type CaptureBobOutputResult = {
  status: "ok" | "error"
  bobOutputPath?: string
  reviewId?: string
  message: string
}

export async function captureBobOutput(input: { workspaceRoot: string; text: string; bobOutputPath: string }): Promise<CaptureBobOutputResult> {
  const yamlText = extractYamlFromText(input.text)
  if (!yamlText) return { status: "error", message: "No YAML object was found in Bob output." }

  let parsed: any
  try {
    parsed = YAML.parse(yamlText)
  } catch (error) {
    return { status: "error", message: `Invalid YAML: ${error instanceof Error ? error.message : String(error)}` }
  }
  const normalized = `${YAML.stringify(parsed)}`
  await writeTextFile(input.bobOutputPath, normalized)
  return {
    status: "ok",
    bobOutputPath: path.resolve(input.bobOutputPath),
    reviewId: parsed?.review_summary?.review_id,
    message: `Captured Bob output to ${input.bobOutputPath}`
  }
}

export function extractYamlFromText(text: string): string | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  const fenced = trimmed.match(/```(?:yaml|yml|YAML)?\s*\r?\n([\s\S]*?)\r?\n```/)
  if (fenced) return fenced[1].trim()
  if (/^schema_version\s*:/m.test(trimmed)) return trimmed
  const start = trimmed.search(/^schema_version\s*:/m)
  return start >= 0 ? trimmed.slice(start).trim() : undefined
}
