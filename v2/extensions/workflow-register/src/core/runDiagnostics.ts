import { RunStepState, WorkflowRunState } from "./model"

export interface WorkflowRunDiagnosticReport {
  title: string
  summary: string
  lines: string[]
}

export function buildWorkflowRunDiagnosticReport(runs: WorkflowRunState[]): WorkflowRunDiagnosticReport {
  const lines = runs.length === 0 ? ["- No workflow runs were found."] : runs.flatMap((run) => [...formatWorkflowRunDiagnostics(run), ""])
  if (lines[lines.length - 1] === "") lines.pop()
  const failed = runs.filter((run) => run.status === "failed").length
  const held = runs.filter((run) => run.status === "held").length
  return {
    title: "Workflow Run Diagnostics",
    summary: `${runs.length} run(s); ${failed} failed; ${held} held.`,
    lines
  }
}

export function formatWorkflowRunDiagnostics(run: WorkflowRunState): string[] {
  const lines = [
    `## ${run.runId}`,
    "",
    `- status: ${run.status}`,
    `- workflow: ${run.workflowId}`,
    `- workflow name: ${run.workflowName}`,
    `- current step: ${run.currentStep ?? "none"}`,
    `- updated: ${run.updatedAt}`
  ]
  if (run.error) {
    lines.push(`- error: ${run.error}`)
    const hint = workflowRunFailureHint(run.error)
    if (hint) lines.push(`- suggested fix: ${hint}`)
  }
  const failedStep = currentProblemStep(run)
  if (failedStep) {
    lines.push("", "Failed or held step:", `- id: ${failedStep.id}`, `- title: ${failedStep.title}`, `- type: ${failedStep.type}`, `- status: ${failedStep.status}`)
    if (failedStep.error) {
      lines.push(`- step error: ${failedStep.error}`)
      const hint = workflowRunFailureHint(failedStep.error)
      if (hint) lines.push(`- step suggested fix: ${hint}`)
    }
  }
  const stateKeys = Object.keys(run.state).sort()
  lines.push("", "State:", stateKeys.length === 0 ? "- no state values captured" : `- keys: ${stateKeys.join(", ")}`)
  if (run.state["workflow.preflightWarnings"]) lines.push(`- preflight warnings: ${run.state["workflow.preflightWarnings"]}`)
  lines.push("", "Steps:")
  for (const step of run.steps) lines.push(`- ${step.id}: ${step.status}${step.error ? `; error=${step.error}` : ""}`)
  return lines
}

export function workflowRunFailureHint(error: string): string | undefined {
  if (error.includes("Unsupported action provider")) return "Register an ActionProvider for this provider id, or replace the command step with vscode.executeCommand."
  if (error.includes("vscode.executeCommand requires the command id")) return "Put the VS Code command id as the first item in action.args."
  if (error.includes("Command is denied by workflow guardrails")) return "Remove the command from deniedCommands or choose a safer command."
  if (error.includes("Command is not allowed by workflow guardrails")) return "Add the provider id to allowedCommands or remove the allowlist."
  if (error.includes("Agent provider is required")) return "Configure workflowRegister.agentCommand or register an AgentProvider through the extension API."
  if (error.includes("Workflow preflight failed")) return "Fix missing required files or failing preflight checks before running the workflow again."
  if (error.includes("Required workflow file is missing")) return "Create the missing file or remove it from requires.files/preflight.files."
  if (error.includes("Workflow state is missing")) return "Check resultKey/stateKey spelling and ensure the producing step runs before the consuming step."
  if (error.includes("Result file path escapes the workspace")) return "Use a relative artifact or result path inside the workspace."
  if (error.includes("Unsupported result sink")) return "Register a result sink for this sink type or use the built-in file sink."
  if (error.includes("Unsupported result command")) return "Allow or replace the command result sink. File sinks are usually safer for generated artifacts."
  return undefined
}

function currentProblemStep(run: WorkflowRunState): RunStepState | undefined {
  return run.steps.find((step) => step.id === run.currentStep && (step.status === "failed" || step.status === "held"))
    ?? run.steps.find((step) => step.status === "failed" || step.status === "held")
}
