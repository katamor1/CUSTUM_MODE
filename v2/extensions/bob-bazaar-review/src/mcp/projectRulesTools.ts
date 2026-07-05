import { BazaarError } from "../bazaar/bazaar"
import { renderReviewResultMarkdown } from "../projectRules/markdown"
import { initializeProjectRules, loadProjectChecklist, loadReviewResultSchema } from "../projectRules/io"
import { getLatestReviewResult, getReviewResult } from "../projectRules/reviewResultsStore"
import { ReviewResult } from "../projectRules/types"
import { validateReviewResultJson } from "../projectRules/validator"
import {
  jsonText,
  optionalString,
  requiredString,
  text
} from "./toolCommon"
import {
  PROJECT_RULES_INIT_INPUT_SCHEMA,
  PROJECT_RULES_LATEST_RESULT_INPUT_SCHEMA,
  PROJECT_RULES_OPTIONAL_PATH_INPUT_SCHEMA,
  PROJECT_RULES_REVIEW_JSON_INPUT_SCHEMA,
  PROJECT_RULES_SCHEMA_PATH_INPUT_SCHEMA,
  PROJECT_RULES_STORED_RESULT_INPUT_SCHEMA
} from "./toolSchemas"
import type { McpToolResponse, RequiredAllowedCwd, ToolDef } from "./toolTypes"

/**
 * MCP write tool を有効化する明示 opt-in の環境変数。
 *
 * read-only tool と違い project_rules_init は workspace に副作用を持つため、
 * host 起動時の環境で許可された場合だけ実行可能にする。
 */
export const ENABLE_WRITE_TOOLS_ENV = "BOB_BAZAAR_ENABLE_WRITE_TOOLS"
/**
 * 副作用を持つ project rules MCP tool の allowlist。
 *
 * tool 追加時に read/write の境界を見落とさないよう、書き込み系は名前で固定して
 * requireWriteToolEnabled を通過させる。
 */
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
      inputSchema: PROJECT_RULES_INIT_INPUT_SCHEMA
    },
    {
      name: "project_rules_get_checklist",
      description: "Return the project-specific review checklist JSON. Falls back to the built-in default checklist when missing.",
      inputSchema: PROJECT_RULES_OPTIONAL_PATH_INPUT_SCHEMA
    },
    {
      name: "project_rules_get_schema",
      description: "Return the review result JSON schema. Falls back to the built-in default schema when missing.",
      inputSchema: PROJECT_RULES_SCHEMA_PATH_INPUT_SCHEMA
    },
    {
      name: "project_rules_validate_review_result",
      description: "Validate normalized review result JSON and return validation issues.",
      inputSchema: PROJECT_RULES_REVIEW_JSON_INPUT_SCHEMA
    },
    {
      name: "project_rules_render_markdown",
      description: "Render normalized review result JSON as a Markdown checklist summary.",
      inputSchema: PROJECT_RULES_REVIEW_JSON_INPUT_SCHEMA
    },
    {
      name: "project_rules_get_latest_review_result",
      description: "Return the newest saved review-result JSON from .bob/review/results.",
      inputSchema: PROJECT_RULES_LATEST_RESULT_INPUT_SCHEMA
    },
    {
      name: "project_rules_get_review_result",
      description: "Return a saved review-result JSON from .bob/review/results by review id.",
      inputSchema: PROJECT_RULES_STORED_RESULT_INPUT_SCHEMA
    }
  ]
}

export function isProjectRulesTool(name: string): boolean {
  return PROJECT_RULES_TOOL_NAMES.has(name)
}

/**
 * Project rules 用 MCP tool を host 権限で実行する入口。
 *
 * cwd は requiredAllowedCwd で許可済み workspace に制限し、Webview や AI が渡した
 * args は tool ごとの validator と write-tool opt-in を通すまで信頼しない。
 */
export async function callProjectRulesTool(
  name: string,
  args: unknown,
  requiredAllowedCwd: RequiredAllowedCwd,
  writeToolsEnabled: boolean
): Promise<McpToolResponse> {
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
