import type { ActionExecutionInput } from "./model"

/**
 * workflow action provider registration owned by one extension or subsystem.
 *
 * `sourceId` is optional for source compatibility, but public extension providers
 * should always set it so duplicate diagnostics identify both owners.
 */
export interface ActionProvider {
  id: string
  sourceId?: string
  execute: (input: ActionExecutionInput) => Promise<unknown> | unknown
}

/** Structural disposable returned for one provider registration. */
export interface ActionProviderRegistration {
  dispose: () => void
}
