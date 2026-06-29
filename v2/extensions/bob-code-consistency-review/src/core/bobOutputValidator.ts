import * as path from "node:path"
import YAML from "yaml"
import { readBobOutputText } from "./bobOutputSource"
import { pathExists, readTextFile } from "./fileSystem"
import { formatSchemaErrors, loadSchemaValidator } from "./schemaLoader"
import type { ValidationReport } from "./types"

export async function validateBobOutput(input: { packageDir: string; bobOutputPath: string }): Promise<ValidationReport> {
  const errors: string[] = []
  const warnings: string[] = []
  let parsed: any

  const loaded = await readBobOutputText(input)
  if (!loaded.ok) return { errors: [loaded.error], warnings }
  if (loaded.usedFallback) warnings.push(`Bob output YAML fallback used: ${toForwardSlash(path.relative(path.dirname(input.packageDir), loaded.sourcePath) || loaded.sourcePath)}`)

  try {
    parsed = YAML.parse(loaded.text)
  } catch (error) {
    return { errors: [`Invalid YAML (${loaded.sourcePath}): ${error instanceof Error ? error.message : String(error)}`], warnings }
  }

  const validate = await loadSchemaValidator("bob-output")
  if (!validate(parsed)) errors.push(...formatSchemaErrors(validate))

  const evidencePath = path.join(input.packageDir, "evidence-index.json")
  if (!(await pathExists(evidencePath))) {
    errors.push(`evidence-index.json not found: ${evidencePath}`)
    return { errors, warnings }
  }

  const evidenceIndex = JSON.parse(await readTextFile(evidencePath)) as { evidence?: Array<{ evidence_id?: string; ref?: string; type?: string }> }
  const evidenceIds = new Set((evidenceIndex.evidence ?? []).map((item) => item.evidence_id).filter((id): id is string => typeof id === "string"))
  for (const issue of outputEvidenceRefs(parsed)) {
    if (!issue.evidence_id) {
      errors.push(`${issue.path} is missing evidence_id`)
    } else if (!evidenceIds.has(issue.evidence_id)) {
      errors.push(`${issue.path} references unknown evidence_id: ${issue.evidence_id}`)
    }
  }

  if ((parsed?.findings?.length ?? 0) > 30) warnings.push("findings contains more than 30 items.")
  if ((parsed?.questions?.length ?? 0) > 30) warnings.push("questions contains more than 30 items.")
  return { errors, warnings }
}

function toForwardSlash(value: string): string {
  return value.replace(/\\/g, "/")
}

function outputEvidenceRefs(parsed: any): Array<{ path: string; evidence_id?: string }> {
  const result: Array<{ path: string; evidence_id?: string }> = []
  for (const [collectionName, collection] of [["findings", parsed?.findings], ["questions", parsed?.questions]] as const) {
    if (!Array.isArray(collection)) continue
    collection.forEach((item, itemIndex) => {
      if (!Array.isArray(item?.evidence)) return
      item.evidence.forEach((evidence: any, evidenceIndex: number) => {
        result.push({ path: `$.${collectionName}[${itemIndex}].evidence[${evidenceIndex}]`, evidence_id: evidence?.evidence_id })
      })
    })
  }
  return result
}
