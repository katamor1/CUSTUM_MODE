import type { ActionExecutionInput } from "./model"

export interface ActionProvider {
  id: string
  execute: (input: ActionExecutionInput) => Promise<unknown> | unknown
}
