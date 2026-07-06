import { ActionExecutionInput, ActionExecutionResult } from "./model"
import { requireWorkspaceTrust, type WorkspaceTrustCheck } from "./workspaceTrust"
import { createMechanicalChecksActionProvider } from "./mechanicalChecks/actionProvider"
import type { ActionProvider } from "./actionTypes"

export type { ActionProvider } from "./actionTypes"

export class ActionRegistry {
  private readonly providers = new Map<string, ActionProvider>()

  register(provider: ActionProvider): void {
    if (!provider.id.trim()) throw new Error("Action provider id is required.")
    this.providers.set(provider.id, provider)
  }

  list(): string[] {
    return Array.from(this.providers.keys()).sort()
  }

  async execute(providerId: string, input: ActionExecutionInput): Promise<ActionExecutionResult> {
    const provider = this.providers.get(providerId)
    if (!provider) return { ok: false, error: `Unsupported action provider: ${providerId}` }
    try {
      const value = await Promise.resolve(provider.execute(input))
      return { ok: true, value }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}

export interface DefaultActionRegistryOptions {
  executeCommand: (command: string, ...args: unknown[]) => Promise<unknown> | unknown
  isWorkspaceTrusted?: WorkspaceTrustCheck
}

export function createDefaultActionRegistry(options?: DefaultActionRegistryOptions): ActionRegistry {
  const registry = new ActionRegistry()
  registry.register(createMechanicalChecksActionProvider({
    isWorkspaceTrusted: options?.isWorkspaceTrusted
  }))
  if (options) {
    registry.register({
      id: "vscode.executeCommand",
      execute: (input) => {
        requireWorkspaceTrust(options.isWorkspaceTrusted, "running VS Code commands")
        const args = argumentList(input.args)
        const command = args.shift()
        if (typeof command !== "string" || !command.trim()) {
          throw new Error("vscode.executeCommand requires the command id as the first argument.")
        }
        injectWorkflowRoot(command, args, input.workflowRoot)
        return options.executeCommand(command, ...args)
      }
    })
  }
  return registry
}

function argumentList(value: unknown): unknown[] {
  if (value === undefined) return []
  return Array.isArray(value) ? [...value] : [value]
}

function injectWorkflowRoot(command: string, args: unknown[], workflowRoot: string | undefined): void {
  if (!workflowRoot || !requiresWorkspaceRoot(command)) return
  const first = args[0]
  if (isRecord(first)) {
    if (typeof first.workspaceRoot !== "string" || !first.workspaceRoot.trim()) {
      args[0] = { ...first, workspaceRoot: workflowRoot }
    }
  } else if (first === undefined) {
    args[0] = { workspaceRoot: workflowRoot }
  }
}

function requiresWorkspaceRoot(command: string): boolean {
  return command.startsWith("bobProcess.") ||
    command.startsWith("bobTemplate.") ||
    command.startsWith("bobCodeConsistency.")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
