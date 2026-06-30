import { WorkflowAuthoringModel, WorkflowAuthoringStep, nextUniqueId, normalizeId } from "./workflowAuthoringModel"
import { normalizeWorkflowName, WorkflowTemplateKind } from "./workflowScaffold"

export interface CreateAuthoringModelInput {
  name: string
  title?: string
  description: string
  template: WorkflowTemplateKind
}

export function createAuthoringModelFromTemplate(input: CreateAuthoringModelInput): WorkflowAuthoringModel {
  const name = normalizeWorkflowName(input.name)
  const title = input.title?.trim() || titleFromName(name)
  const description = input.description.trim() || `Run ${title}.`
  const base: WorkflowAuthoringModel = {
    metadata: {
      schemaVersion: "workflow-register/v1",
      name,
      title,
      description,
      mode: "agent",
      workspaceRequired: true,
      template: input.template
    },
    inputs: [],
    preflight: [],
    steps: [],
    artifacts: []
  }

  switch (input.template) {
    case "command-then-agent":
      return {
        ...base,
        steps: [
          commandStep("collect-context", "Collect context", "example.commandId", "collectedContext", true),
          agentStep("analyze", "Analyze context", "Analyze the collected context and produce a concise result.", ["collectedContext"])
        ]
      }
    case "manual-checklist":
      return {
        ...base,
        steps: [
          manualStep("prepare", "Prepare inputs", "Confirm that the required inputs and workspace files are ready."),
          manualStep("review", "Review result", "Review the generated or collected result and note any issues."),
          manualStep("finish", "Finish workflow", "Confirm that all follow-up actions are captured before completing the workflow.")
        ]
      }
    case "input-driven-agent":
      return {
        ...base,
        inputs: [
          { id: "target", type: "string", title: "Target path or topic", required: true },
          { id: "outputStyle", type: "select", title: "Output style", required: true, options: ["concise", "detailed"] }
        ],
        steps: [agentStep("analyze", "Analyze input", "Use the provided input values to complete the workflow.\n\nTarget: {{inputs.target}}\nOutput style: {{inputs.outputStyle}}")]
      }
    case "preflight-files":
      return {
        ...base,
        requires: { workspace: true, files: ["package.json"] },
        preflight: [{ id: "required-files", title: "Required files exist", required: true, files: ["package.json"], failurePolicy: "stop" }],
        steps: [agentStep("inspect", "Inspect workspace", "Inspect the required files and summarize whether the workspace is ready.")]
      }
    case "artifact-output":
      return {
        ...base,
        steps: [
          agentStep("analyze", "Analyze", `${description}\n\nProduce a Markdown report.`, [], "analysisReport"),
          resultStep("write-report", "Write report", "analysisReport", `.bob/artifacts/${name}-report.md`)
        ],
        artifacts: [{ id: "report", producedBy: "write-report", path: `.bob/artifacts/${name}-report.md` }],
        completion: { includeArtifacts: true }
      }
    case "guarded-command":
      return {
        ...base,
        guardrails: {
          allowedCommands: ["example.safeCommand"],
          deniedCommands: ["example.destructiveCommand"],
          requireApproval: [{ id: "command-approval", when: "before-command", message: "Confirm that this command is safe for the current workspace." }]
        },
        steps: [
          commandStep("run-safe-command", "Run safe command", "example.safeCommand", "commandResult"),
          agentStep("summarize", "Summarize command result", "Summarize the command result and call out any risks.", ["commandResult"])
        ]
      }
    case "review-workflow":
      return {
        ...base,
        inputs: [{ id: "reviewScope", type: "select", title: "Review scope", required: true, options: ["code", "docs", "workflow"] }],
        steps: [
          commandStep("collect-review-context", "Collect review context", "example.collectReviewContext", "reviewContext"),
          agentStep("review", "Review", "Review the collected context for correctness, maintainability, and missing tests.\nGroup findings by severity and include concrete next actions.", ["reviewContext"])
        ]
      }
    case "simple-agent":
    default:
      return { ...base, steps: [agentStep("analyze", "Analyze", `${description}\n\nSummarize the result clearly and list any follow-up actions.`)] }
  }
}

export function createEmptyAuthoringStep(type: WorkflowAuthoringStep["type"], usedIds: string[]): WorkflowAuthoringStep {
  const id = nextUniqueId(type === "agent" ? "analyze" : type === "command" ? "collect-context" : type === "result" ? "write-result" : "confirm", usedIds)
  if (type === "command") return commandStep(id, titleFromName(id), "example.commandId", `${normalizeId(id)}Result`)
  if (type === "manual") return manualStep(id, titleFromName(id), "Confirm this step before continuing.")
  if (type === "result") return resultStep(id, titleFromName(id), "", `.bob/artifacts/${id}.md`)
  return agentStep(id, titleFromName(id), "Describe the task for Bob to perform.")
}

function commandStep(id: string, title: string, commandId: string, resultKey?: string, required?: boolean): WorkflowAuthoringStep {
  return {
    id,
    title,
    type: "command",
    action: { provider: "vscode.executeCommand", args: [commandId] },
    resultKey,
    required
  }
}

function agentStep(id: string, title: string, prompt: string, includeState: string[] = [], resultKey?: string): WorkflowAuthoringStep {
  return { id, title, type: "agent", prompt, includeState, resultKey }
}

function manualStep(id: string, title: string, prompt: string): WorkflowAuthoringStep {
  return { id, title, type: "manual", prompt }
}

function resultStep(id: string, title: string, stateKey: string, path: string): WorkflowAuthoringStep {
  return {
    id,
    title,
    type: "result",
    result: { source: "state", stateKey, sinks: [{ type: "file", path }] }
  }
}

function titleFromName(name: string): string {
  return name.split(/[._-]+/).filter(Boolean).map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ") || "New Workflow"
}
