import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import YAML from "yaml"
import {
  normalizeChangedFilePathStrict,
  resolveWorkspacePathStrict
} from "../core/fileSystem"
import { formatSchemaErrors, loadSchemaValidator } from "../core/schemaLoader"
import { decodeTextBuffer } from "../core/textEncoding"
import type { ProjectRule } from "./evidenceScopeTypes"
import { parseProjectRules } from "./projectRuleConfig"

export type ProjectRulePackProvenance = {
  id: string
  version: string
  sourcePath: string
  contentHash: string
}

export type LoadedProjectRulePack = ProjectRulePackProvenance & {
  rules: ProjectRule[]
}

export type LoadProjectRulePackInput = {
  workspaceRoot: string
  rulePackPath: unknown
  maxBytes: number
  textEncoding?: string
}

export async function loadProjectRulePack(
  input: LoadProjectRulePackInput
): Promise<LoadedProjectRulePack | undefined> {
  if (input.rulePackPath === undefined || input.rulePackPath === null) return undefined
  if (typeof input.rulePackPath !== "string" || !input.rulePackPath.trim()) {
    throw new Error("evidence scope rule pack path must be a non-empty string")
  }

  const sourcePath = normalizeChangedFilePathStrict(
    input.rulePackPath,
    "evidence scope rule pack path"
  )
  if (!/\.(?:json|ya?ml)$/i.test(sourcePath)) {
    throw new Error(`evidence scope rule pack path must end in .json, .yaml, or .yml: ${sourcePath}`)
  }

  const resolvedPath = resolveWorkspacePathStrict(
    input.workspaceRoot,
    sourcePath,
    "evidence scope rule pack path"
  )
  const rawBytes = await readRulePackBytes(resolvedPath, input.maxBytes, sourcePath)
  const rawText = decodeTextBuffer(rawBytes, input.textEncoding ?? "auto")
  const parsed = parseRulePackText(rawText, sourcePath)
  const validate = await loadSchemaValidator("evidence-scope-rule-pack")
  if (!validate(parsed)) {
    const errors = formatSchemaErrors(validate)
    throw new Error(
      `Invalid evidence scope rule pack (${sourcePath}):\n${errors.map((error) => `- ${error}`).join("\n")}`
    )
  }

  const document = parsed as RulePackDocument
  const parsedRules = parseProjectRules(document.rules)
  if (parsedRules.warnings.length > 0) {
    throw new Error(
      `Invalid evidence scope rule pack (${sourcePath}):\n${parsedRules.warnings.map((warning) => `- ${warning}`).join("\n")}`
    )
  }

  return {
    id: document.rule_pack.id,
    version: document.rule_pack.version,
    sourcePath,
    contentHash: `sha256:${createHash("sha256").update(rawBytes).digest("hex")}`,
    rules: parsedRules.rules
  }
}

export function mergeProjectRules(
  projectRules: ProjectRule[],
  inlineRules: ProjectRule[]
): { rules: ProjectRule[]; warnings: string[] } {
  const rulesById = new Map<string, ProjectRule>()
  for (const rule of [...projectRules].sort(compareRules)) rulesById.set(rule.id, rule)

  const warnings: string[] = []
  for (const rule of [...inlineRules].sort(compareRules)) {
    if (rulesById.has(rule.id)) {
      warnings.push(`duplicate inline evidence scope rule ${rule.id}; project rule pack entry retained.`)
      continue
    }
    rulesById.set(rule.id, rule)
  }

  return {
    rules: [...rulesById.values()].sort(compareRules),
    warnings: [...new Set(warnings)].sort()
  }
}

type RulePackDocument = {
  schema_version: 1
  rule_pack: {
    id: string
    version: string
    description?: string
  }
  rules: unknown[]
}

async function readRulePackBytes(filePath: string, maxBytes: number, sourcePath: string): Promise<Buffer> {
  const normalizedMaxBytes = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : 0
  if (normalizedMaxBytes <= 0) {
    throw new Error(`evidence scope rule pack maxBytes must be positive: ${maxBytes}`)
  }

  const handle = await fs.open(filePath, "r")
  try {
    const before = await handle.stat()
    if (!before.isFile()) {
      throw new Error(`evidence scope rule pack is not a file: ${sourcePath}`)
    }
    if (before.size > normalizedMaxBytes) {
      throw new Error(
        `evidence scope rule pack exceeded maxDocumentBytes (${before.size} > ${normalizedMaxBytes}): ${sourcePath}`
      )
    }

    const buffer = Buffer.alloc(before.size)
    let offset = 0
    while (offset < buffer.length) {
      const read = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (read.bytesRead === 0) break
      offset += read.bytesRead
    }

    const after = await handle.stat()
    if (after.size > normalizedMaxBytes) {
      throw new Error(
        `evidence scope rule pack exceeded maxDocumentBytes (${after.size} > ${normalizedMaxBytes}): ${sourcePath}`
      )
    }
    if (after.size !== before.size || offset !== before.size) {
      throw new Error(`evidence scope rule pack changed while reading: ${sourcePath}`)
    }
    return buffer
  } finally {
    await handle.close()
  }
}

function parseRulePackText(rawText: string, sourcePath: string): unknown {
  try {
    return YAML.parse(rawText) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid evidence scope rule pack (${sourcePath}): YAML/JSON parse failed: ${message}`)
  }
}

function compareRules(left: ProjectRule, right: ProjectRule): number {
  return left.id.localeCompare(right.id)
}
