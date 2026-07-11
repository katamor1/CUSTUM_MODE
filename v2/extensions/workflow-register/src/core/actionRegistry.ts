import { ActionExecutionInput, ActionExecutionResult } from "./model"
import { requireWorkspaceTrust, type WorkspaceTrustCheck } from "./workspaceTrust"
import { createMechanicalChecksActionProvider } from "./mechanicalChecks/actionProvider"
import type { ActionProvider, ActionProviderRegistration } from "./actionTypes"

export type { ActionProvider, ActionProviderRegistration } from "./actionTypes"

interface RegisteredActionProvider {
  provider: ActionProvider
  sourceId: string
  token: symbol
}

const DEFAULT_PROVIDER_SOURCE_ID = "anonymous"
const WORKFLOW_REGISTER_PROVIDER_SOURCE_ID = "local.workflow-register"

export class ActionRegistry {
  private readonly providers = new Map<string, RegisteredActionProvider>()

  register(provider: ActionProvider): ActionProviderRegistration {
    const id = provider.id.trim()
    if (!id) throw new Error("Action provider id is required.")
    const sourceId = normalizedSourceId(provider.sourceId)
    const existing = this.providers.get(id)
    if (existing) {
      throw new Error(
        `Action provider '${id}' is already registered by '${existing.sourceId}' and cannot be replaced by '${sourceId}'.`
      )
    }

    const token = Symbol(id)
    this.providers.set(id, {
      provider: { ...provider, id, sourceId },
      sourceId,
      token
    })

    let disposed = false
    return {
      dispose: () => {
        if (disposed) return
        disposed = true
        const current = this.providers.get(id)
        if (current?.token === token) this.providers.delete(id)
      }
    }
  }

  list(): string[] {
    return Array.from(this.providers.keys()).sort()
  }

  async execute(providerId: string, input: ActionExecutionInput): Promise<ActionExecutionResult> {
    const registration = this.providers.get(providerId)
    if (!registration) return { ok: false, error: `Unsupported action provider: ${providerId}` }
    try {
      const value = await Promise.resolve(registration.provider.execute(input))
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
  registry.register({
    ...createMechanicalChecksActionProvider({
      isWorkspaceTrusted: options?.isWorkspaceTrusted
    }),
    sourceId: WORKFLOW_REGISTER_PROVIDER_SOURCE_ID
  })
  if (options) {
    registry.register({
      id: "vscode.executeCommand",
      sourceId: WORKFLOW_REGISTER_PROVIDER_SOURCE_ID,
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

function normalizedSourceId(value: string | undefined): string {
  return typeof value === "string" && value.trim() ? value.trim() : DEFAULT_PROVIDER_SOURCE_ID
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
