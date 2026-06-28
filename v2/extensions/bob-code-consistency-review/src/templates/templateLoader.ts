import * as path from "node:path"
import { readTextFile } from "../core/fileSystem"

export type PromptTemplates = {
  system: string
  task: string
  outputFormat: string
  bobInputTemplate: string
}

export async function loadPromptTemplates(): Promise<PromptTemplates> {
  const dir = path.join(__dirname, "..", "..", "resources", "templates", "prompts", "consistency-review-v1")
  const [system, task, outputFormat, bobInputTemplate] = await Promise.all([
    readTextFile(path.join(dir, "system.md")),
    readTextFile(path.join(dir, "task.md")),
    readTextFile(path.join(dir, "output-format.md")),
    readTextFile(path.join(dir, "bob-input.template.md"))
  ])
  return { system, task, outputFormat, bobInputTemplate }
}

export function applyTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, key) => values[String(key).trim()] ?? "")
}
