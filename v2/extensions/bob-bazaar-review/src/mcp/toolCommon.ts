import { BazaarError } from "../bazaar/bazaar"
import type { BazaarCommandResult, McpToolResponse } from "./toolTypes"

export function requiredString(args: unknown, name: string): string {
  const value = (args as Record<string, unknown> | undefined)?.[name]
  if (typeof value !== "string" || !value.trim()) {
    throw new BazaarError(`Missing required string argument: ${name}`)
  }
  return value
}

export function optionalString(args: unknown, name: string): string | undefined {
  const value = (args as Record<string, unknown> | undefined)?.[name]
  if (value === undefined || value === null || value === "") {
    return undefined
  }
  if (typeof value !== "string") {
    throw new BazaarError(`Expected string argument: ${name}`)
  }
  return value
}

export function commandText(result: BazaarCommandResult): McpToolResponse {
  const body = [
    `cwd: ${result.cwd}`,
    `command: ${result.command} ${result.args.join(" ")}`,
    result.stderr.trim() ? `stderr:\n${result.stderr}` : "",
    result.stdout
  ].filter(Boolean).join("\n\n")
  return text(body)
}

export function text(value: string): McpToolResponse {
  return { content: [{ type: "text", text: value }] }
}

export function jsonText(value: unknown): McpToolResponse {
  return text(JSON.stringify(value, null, 2))
}

export function objectSchema(properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false }
}

export function stringProp(description: string): Record<string, unknown> {
  return { type: "string", description }
}

export function optionalStringProp(description: string): Record<string, unknown> {
  return { type: "string", description }
}
