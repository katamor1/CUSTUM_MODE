import { readTextFile } from "../core/file-system.js";

export type PromptTemplates = {
  system: string;
  task: string;
  outputFormat: string;
  bobInputTemplate: string;
};

const templateDir = "docs/workflows/code-consistency-review/templates/prompts/consistency-review-v1";

export async function loadPromptTemplates(): Promise<PromptTemplates> {
  return {
    system: await readTextFile(`${templateDir}/system.md`),
    task: await readTextFile(`${templateDir}/task.md`),
    outputFormat: await readTextFile(`${templateDir}/output-format.md`),
    bobInputTemplate: await readTextFile(`${templateDir}/bob-input.template.md`),
  };
}

export function applyTemplate(template: string, values: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}
