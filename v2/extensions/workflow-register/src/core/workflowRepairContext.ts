import { ValidateWorkflowResult, WorkflowDiagnostic } from "./workflowValidator"

export interface WorkflowRepairProblem {
  severity: WorkflowDiagnostic["severity"]
  message: string
  likelyFix?: string
  repairTarget?: string
}

export interface WorkflowRepairContext {
  filePath: string
  status: "valid" | "invalid"
  problems: WorkflowRepairProblem[]
}

export function buildWorkflowRepairContext(filePath: string, result: ValidateWorkflowResult): WorkflowRepairContext {
  return {
    filePath,
    status: result.ok ? "valid" : "invalid",
    problems: result.diagnostics
      .filter((diagnostic) => diagnostic.severity !== "info")
      .map((diagnostic) => ({
        severity: diagnostic.severity,
        message: diagnostic.message,
        likelyFix: likelyFixForDiagnostic(diagnostic.message),
        repairTarget: repairTargetForDiagnostic(diagnostic.message)
      }))
  }
}

export function formatWorkflowRepairContext(context: WorkflowRepairContext): string[] {
  const lines = [`- file: ${context.filePath}`, `- status: ${context.status}`, "", "## Problems"]
  if (context.problems.length === 0) return [...lines, "", "- No workflow problems found."]
  for (const problem of context.problems) {
    lines.push("", `- ${problem.severity}: ${problem.message}`)
    if (problem.repairTarget) lines.push(`  - repairTarget: ${problem.repairTarget}`)
    if (problem.likelyFix) lines.push(`  - likelyFix: ${problem.likelyFix}`)
  }
  lines.push("", "## Repair context JSON", "", "```json", JSON.stringify(context, null, 2), "```")
  return lines
}

export function likelyFixForDiagnostic(message: string): string | undefined {
  if (message.includes("includeState references unknown resultKey")) return "Add a matching resultKey to an earlier command or agent step, or remove the includeState entry."
  if (message.includes("result references unknown stateKey")) return "Change stateKey to an existing resultKey produced by an earlier step."
  if (message.includes("Duplicate step id")) return "Rename one of the duplicate step ids."
  if (message.includes("select but has no options")) return "Add an options array to the select input."
  if (message.includes("producedBy step")) return "Set producedBy to an existing step id."
  if (message.includes("action.provider is empty")) return "Set action.provider to a registered provider such as vscode.executeCommand."
  if (message.includes("both allowed and denied")) return "Keep the command in only one guardrail list."
  if (message.includes("invalid YAML")) return "Fix YAML indentation, quoting, or list markers in the front matter."
  if (message.includes("missing YAML front matter")) return "Wrap the workflow metadata in a leading YAML front matter block delimited by ---."
  return undefined
}

export function repairTargetForDiagnostic(message: string): string | undefined {
  if (message.includes("includeState references unknown resultKey")) return "steps[].includeState"
  if (message.includes("result references unknown stateKey")) return "steps[].result.stateKey"
  if (message.includes("Duplicate step id")) return "steps[].id"
  if (message.includes("select but has no options")) return "inputs.*.options"
  if (message.includes("producedBy step")) return "artifacts[].producedBy"
  if (message.includes("action.provider is empty")) return "steps[].action.provider"
  if (message.includes("both allowed and denied")) return "guardrails.allowedCommands/deniedCommands"
  if (message.includes("invalid YAML") || message.includes("missing YAML front matter")) return "YAML front matter"
  return undefined
}
