import { BazaarClient, BazaarError } from "../bazaar/bazaar"
import {
  commandText,
  optionalString,
  requiredString,
  text
} from "./toolCommon"
import {
  BAZAAR_CAT_REVISION_INPUT_SCHEMA,
  BAZAAR_DIFF_RANGE_INPUT_SCHEMA,
  BAZAAR_DIFF_REVISION_INPUT_SCHEMA,
  BAZAAR_DIFF_WORKING_TREE_INPUT_SCHEMA,
  BAZAAR_LOG_INPUT_SCHEMA,
  BAZAAR_REVNO_INPUT_SCHEMA,
  BAZAAR_ROOT_INPUT_SCHEMA,
  BAZAAR_STATUS_INPUT_SCHEMA
} from "./toolSchemas"
import type { McpToolResponse, RequiredAllowedCwd, ToolDef } from "./toolTypes"

const BAZAAR_TOOL_NAMES = new Set([
  "bazaar_root",
  "bazaar_revno",
  "bazaar_log",
  "bazaar_diff_revision",
  "bazaar_diff_range",
  "bazaar_diff_working_tree",
  "bazaar_cat_revision",
  "bazaar_status"
])

export function createBazaarToolDefinitions(): ToolDef[] {
  return [
    {
      name: "bazaar_root",
      description: "Return the Bazaar repository root for a working directory. The server always executes bzr with --no-aliases.",
      inputSchema: BAZAAR_ROOT_INPUT_SCHEMA
    },
    {
      name: "bazaar_revno",
      description: "Return the current Bazaar revno for a repository. The server always executes bzr with --no-aliases.",
      inputSchema: BAZAAR_REVNO_INPUT_SCHEMA
    },
    {
      name: "bazaar_log",
      description: "Return Bazaar log output. Equivalent to bzr --no-aliases log. When revision is supplied, returns that revision log.",
      inputSchema: BAZAAR_LOG_INPUT_SCHEMA
    },
    {
      name: "bazaar_diff_revision",
      description: "Return unified diff for a single Bazaar revision, equivalent to bzr --no-aliases diff -c REV.",
      inputSchema: BAZAAR_DIFF_REVISION_INPUT_SCHEMA
    },
    {
      name: "bazaar_diff_range",
      description: "Return unified diff between two Bazaar revisions, equivalent to bzr --no-aliases diff -r BASE..TARGET.",
      inputSchema: BAZAAR_DIFF_RANGE_INPUT_SCHEMA
    },
    {
      name: "bazaar_diff_working_tree",
      description: "Return unified diff for the current working tree, optionally since a base revision. Equivalent to bzr --no-aliases diff.",
      inputSchema: BAZAAR_DIFF_WORKING_TREE_INPUT_SCHEMA
    },
    {
      name: "bazaar_cat_revision",
      description: "Return a file's content at a Bazaar revision, equivalent to bzr --no-aliases cat -r REV PATH.",
      inputSchema: BAZAAR_CAT_REVISION_INPUT_SCHEMA
    },
    {
      name: "bazaar_status",
      description: "Return Bazaar status for a repository, equivalent to bzr --no-aliases status.",
      inputSchema: BAZAAR_STATUS_INPUT_SCHEMA
    }
  ]
}

export function isBazaarTool(name: string): boolean {
  return BAZAAR_TOOL_NAMES.has(name)
}

export async function callBazaarTool(
  name: string,
  args: unknown,
  client: BazaarClient,
  requiredAllowedCwd: RequiredAllowedCwd
): Promise<McpToolResponse> {
  switch (name) {
    case "bazaar_root":
      return text(await client.root(await requiredAllowedCwd(args, "cwd")))
    case "bazaar_revno":
      return text(await client.revno(await requiredAllowedCwd(args, "cwd")))
    case "bazaar_log":
      return commandText(await client.log(await requiredAllowedCwd(args, "cwd"), optionalString(args, "revision")))
    case "bazaar_diff_revision":
      return commandText(await client.diffRevision(await requiredAllowedCwd(args, "cwd"), requiredString(args, "revision")))
    case "bazaar_diff_range":
      return commandText(await client.diffRange(await requiredAllowedCwd(args, "cwd"), requiredString(args, "baseRevision"), requiredString(args, "targetRevision")))
    case "bazaar_diff_working_tree":
      return commandText(await client.diffWorkingTree(await requiredAllowedCwd(args, "cwd"), optionalString(args, "baseRevision")))
    case "bazaar_cat_revision":
      return commandText(await client.cat(await requiredAllowedCwd(args, "cwd"), requiredString(args, "revision"), requiredString(args, "path")))
    case "bazaar_status":
      return commandText(await client.status(await requiredAllowedCwd(args, "cwd")))
    default:
      throw new BazaarError(`Unknown Bazaar MCP tool: ${name}`)
  }
}
