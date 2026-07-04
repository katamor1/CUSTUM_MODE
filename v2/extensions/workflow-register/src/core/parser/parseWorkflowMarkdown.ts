import { ParseWorkflowRequest, ParseWorkflowResult } from "../model"
import { parseLegacyWorkflow } from "./parseLegacyWorkflow"
import { parseV1Workflow } from "./parseV1Workflow"
import { asRecord, formatError } from "./yamlFields"

const yaml = require("js-yaml") as { load(text: string): unknown }

export function parseWorkflowMarkdown(request: ParseWorkflowRequest): ParseWorkflowResult {
  const split = splitMarkdownFrontMatter(request.text)
  if (!split) return { ok: false, diagnostics: [`- fail: ${request.filePath}: missing YAML front matter.`] }

  let fields: Record<string, unknown>
  try {
    fields = asRecord(yaml.load(split.frontMatter))
  } catch (error) {
    return { ok: false, diagnostics: [`- fail: ${request.filePath}: invalid YAML: ${formatError(error)}`] }
  }

  try {
    if (fields.schemaVersion === "workflow-register/v1") return parseV1Workflow(request, fields, split.body, request.text)
    return parseLegacyWorkflow(request, fields, split.body, request.text)
  } catch (error) {
    return { ok: false, diagnostics: [`- fail: ${request.filePath}: ${formatError(error)}`] }
  }
}

function splitMarkdownFrontMatter(text: string): { frontMatter: string; body: string } | undefined {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  return match ? { frontMatter: match[1], body: match[2] } : undefined
}
