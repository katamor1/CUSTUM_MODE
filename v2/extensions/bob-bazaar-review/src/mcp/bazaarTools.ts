import { BazaarClient, BazaarError } from "../bazaar"
import {
  commandText,
  objectSchema,
  optionalString,
  optionalStringProp,
  RequiredAllowedCwd,
  requiredString,
  stringProp,
  text,
  ToolDef
} from "./toolCommon"

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
      inputSchema: objectSchema({ cwd: stringProp("Working directory inside the Bazaar repository") }, ["cwd"])
    },
    {
      name: "bazaar_revno",
      description: "Return the current Bazaar revno for a repository. The server always executes bzr with --no-aliases.",
      inputSchema: objectSchema({ cwd: stringProp("Bazaar repository root or child directory") }, ["cwd"])
    },
    {
      name: "bazaar_log",
      description: "Return Bazaar log output. Equivalent to bzr --no-aliases log. When revision is supplied, returns that revision log.",
      inputSchema: objectSchema({ cwd: stringProp("Bazaar repository root"), revision: optionalStringProp("Optional Bazaar revision") }, ["cwd"])
    },
    {
      name: "bazaar_diff_revision",
      description: "Return unified diff for a single Bazaar revision, equivalent to bzr --no-aliases diff -c REV.",
      inputSchema: objectSchema({ cwd: stringProp("Bazaar repository root"), revision: stringProp("Bazaar revision to review") }, ["cwd", "revision"])
    },
    {
      name: "bazaar_diff_range",
      description: "Return unified diff between two Bazaar revisions, equivalent to bzr --no-aliases diff -r BASE..TARGET.",
      inputSchema: objectSchema({ cwd: stringProp("Bazaar repository root"), baseRevision: stringProp("Base Bazaar revision"), targetRevision: stringProp("Target Bazaar revision") }, ["cwd", "baseRevision", "targetRevision"])
    },
    {
      name: "bazaar_diff_working_tree",
      description: "Return unified diff for the current working tree, optionally since a base revision. Equivalent to bzr --no-aliases diff.",
      inputSchema: objectSchema({ cwd: stringProp("Bazaar repository root"), baseRevision: optionalStringProp("Optional base Bazaar revision") }, ["cwd"])
    },
    {
      name: "bazaar_cat_revision",
      description: "Return a file's content at a Bazaar revision, equivalent to bzr --no-aliases cat -r REV PATH.",
      inputSchema: objectSchema({ cwd: stringProp("Bazaar repository root"), revision: stringProp("Bazaar revision"), path: stringProp("Repository-relative file path") }, ["cwd", "revision", "path"])
    },
    {
      name: "bazaar_status",
      description: "Return Bazaar status for a repository, equivalent to bzr --no-aliases status.",
      inputSchema: objectSchema({ cwd: stringProp("Bazaar repository root") }, ["cwd"])
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
): Promise<unknown> {
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
