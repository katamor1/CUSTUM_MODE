import { BazaarClient, BazaarError } from "../bazaar"
import { callBazaarTool, createBazaarToolDefinitions, isBazaarTool } from "./bazaarTools"
import {
  callProjectRulesTool,
  createProjectRulesToolDefinitions,
  ENABLE_WRITE_TOOLS_ENV,
  isProjectRulesTool,
  PROJECT_RULES_WRITE_TOOL_NAMES
} from "./projectRulesTools"
import { RequiredAllowedCwd, ToolDef } from "./toolCommon"

export interface McpToolRegistryOptions {
  requiredAllowedCwd: RequiredAllowedCwd
  writeToolsEnabled?: boolean
  env?: NodeJS.ProcessEnv
}

export class McpToolRegistry {
  private readonly client: BazaarClient
  private readonly toolDefinitions = [
    ...createBazaarToolDefinitions(),
    ...createProjectRulesToolDefinitions()
  ]
  private readonly writeToolsEnabled: boolean

  constructor(private readonly options: McpToolRegistryOptions) {
    const env = options.env ?? process.env
    this.client = new BazaarClient({
      bzrPath: env.BZR_PATH || "bzr",
      maxBuffer: Number(env.BZR_MAX_BUFFER || 10 * 1024 * 1024),
      textEncoding: env.BZR_TEXT_ENCODING || "auto"
    })
    this.writeToolsEnabled = options.writeToolsEnabled ?? env[ENABLE_WRITE_TOOLS_ENV] === "1"
  }

  availableTools(): ToolDef[] {
    if (this.writeToolsEnabled) {
      return this.toolDefinitions
    }
    return this.toolDefinitions.filter((tool) => !PROJECT_RULES_WRITE_TOOL_NAMES.has(tool.name))
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    if (isBazaarTool(name)) {
      return callBazaarTool(name, args, this.client, this.options.requiredAllowedCwd)
    }
    if (isProjectRulesTool(name)) {
      return callProjectRulesTool(name, args, this.options.requiredAllowedCwd, this.writeToolsEnabled)
    }
    throw new BazaarError(`Unknown Bazaar MCP tool: ${name}`)
  }
}

export function createMcpToolRegistry(options: McpToolRegistryOptions): McpToolRegistry {
  return new McpToolRegistry(options)
}
