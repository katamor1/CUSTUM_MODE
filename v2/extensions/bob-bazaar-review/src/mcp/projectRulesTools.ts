import { BazaarError } from "../bazaar"
import { renderReviewResultMarkdown } from "../projectRules/markdown"
import { initializeProjectRules, loadProjectChecklist, loadReviewResultSchema } from "../projectRules/io"
import { getLatestReviewResult, getReviewResult } from "../projectRules/reviewResultsStore"
import { ReviewResult } from "../projectRules/types"
import { validateReviewResultJson } from "../projectRules/validator"
import {
  jsonText,
  objectSchema,
  optionalString,
  optionalStringProp,
  RequiredAllowedCwd,
  requiredString,
  stringProp,
  text,
  ToolDef
} from "./toolCommon"

export const ENABLE_WRITE_TOOLS_ENV = "BOB_BAZAAR_ENABLE_WRITE_TOOLS"
export const PROJECT_RULES_WRITE_TOOL_NAMES = new Set(["project_rules_init"])

const PROJECT_RULES_TOOL_NAMES = new Set([
  "project_rules_init",
  "project_rules_get_checklist",
  "project_rules_get_schema",
  "project_rules_validate_review_result",
  "project_rules_render_markdown",
  "project_rules_get_latest_review_result",
  "project_rules_get_review_result"
])

export function createProjectRulesToolDefinitions(): ToolDef[] {
  return [
    {
      name: "project_rules_init",
      description: "Create default .bob/review/checklist.json and review-result.schema.json if they are missing.",
      inputSchema: objectSchema({ cwd: stringProp("Workspace root") }, ["cwd"])
    },
    {
      name: "project_rules_get_checklist",
      description: "Return the project-specific review checklist JSON. Falls back to the built-in default checklist when missing.",
      inputSchema: objectSchema({ cwd: stringProp("Workspace root"), path: optionalStringProp("Optional checklist path, workspace-relative or absolute") }, ["cwd"])
    },
    {
      name: "project_rules_get_schema",
      description: "Return the review result JSON schema. Falls back to the built-in default schema when missing.",
      inputSchema: objectSchema({ cwd: stringProp("Workspace root"), path: optionalStringProp("Optional schema path, workspace-relative or absolute") }, ["cwd"])
    },
    {
      name: "project_rules_validate_review_result",
      description: "Validate normalized review result JSON and return validation issues.",
      inputSchema: objectSchema({ json: stringProp("Review result JSON text") }, ["json"])
    },
    {
      name: "project_rules_render_markdown",
      description: "Render normalized review result JSON as a Markdown checklist summary.",
      inputSchema: objectSchema({ json: stringProp("Review result JSON text") }, ["json"])
    },
    {
      name: "project_rules_get_latest_review_result",
      description: "Return the newest saved review-result JSON from .bob/review/results.",
      inputSchema: objectSchema({ cwd: stringProp("Workspace root") }, ["cwd"])
    },
    {
      name: "project_rules_get_review_result",
      description: "Return a saved review-result JSON from .bob/review/results by review id.",
      inputSchema: objectSchema({ cwd: stringProp("Workspace root"), reviewId: stringProp("Review id or result file basename") }, ["cwd", "reviewId"])
    }
  ]
}

export function isProjectRulesTool(name: string): boolean {
  return PROJECT_RULES_TOOL_NAMES.has(name)
}

export async function callProjectRulesTool(
  name: string,
  args: unknown,
  requiredAllowedCwd: RequiredAllowedCwd,
  writeToolsEnabled: boolean
): Promise<unknown> {
  switch (name) {
    case "project_rules_init":
      requireWriteToolEnabled(name, writeToolsEnabled)
      return text(JSON.stringify(await initializeProjectRules(await requiredAllowedCwd(args, "cwd")), null, 2))
    case "project_rules_get_checklist":
      return jsonText(await loadProjectChecklist(await requiredAllowedCwd(args, "cwd"), optionalString(args, "path")))
    case "project_rules_get_schema":
      return jsonText(await loadReviewResultSchema(await requiredAllowedCwd(args, "cwd"), optionalString(args, "path")))
    case "project_rules_validate_review_result":
      return jsonText(validateReviewResultJson(requiredString(args, "json")))
    case "project_rules_render_markdown": {
      const parsed = JSON.parse(requiredString(args, "json")) as ReviewResult
      const validation = validateReviewResultJson(parsed)
      if (!validation.valid) {
        return jsonText(validation)
      }
      return text(renderReviewResultMarkdown(parsed))
    }
    case "project_rules_get_latest_review_result":
      return jsonText(await readStoredReviewResult(async () => getLatestReviewResult(await requiredAllowedCwd(args, "cwd"))))
    case "project_rules_get_review_result":
      return jsonText(await readStoredReviewResult(async () => getReviewResult(await requiredAllowedCwd(args, "cwd"), requiredString(args, "reviewId"))))
    default:
      throw new BazaarError(`Unknown Bazaar MCP tool: ${name}`)
  }
}

function requireWriteToolEnabled(name: string, writeToolsEnabled: boolean): void {
  if (!writeToolsEnabled) {
    throw new BazaarError(`MCP write tool ${name} is disabled. Set ${ENABLE_WRITE_TOOLS_ENV}=1 to enable it explicitly.`)
  }
}

async function readStoredReviewResult(read: () => Promise<unknown>): Promise<unknown> {
  try {
    return await read()
  } catch (error) {
    throw new BazaarError(error instanceof Error ? error.message : String(error))
  }
}
