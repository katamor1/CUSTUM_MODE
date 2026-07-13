import * as vscode from "vscode"
import type {
  LoadResult,
  WorkflowDefinition
} from "./bobWorkflowTypes"
import type { CoreWorkflowDefinition } from "./core/model"
import {
  compileWorkflowDocument,
  formatWorkflowDiagnostics
} from "./core/workflowCompiler"
import {
  adaptCoreWorkflowForBob,
  qualifyDuplicateWorkflowIds
} from "./workflowAdapter"
import {
  discoverWorkspaceWorkflowFiles,
  type WorkflowFileCandidate
} from "./workflowDiscovery"
import { validateAndDescribeWorkflow } from "./workflowDiagnostics"

export async function loadWorkspaceWorkflows(sourceId: string): Promise<LoadResult> {
  const diagnostics: string[] = []
  const workflows: WorkflowDefinition[] = []
  const coreWorkflows: CoreWorkflowDefinition[] = []
  const discovered = await discoverWorkspaceWorkflowFiles()
  diagnostics.push(...discovered.diagnostics)
  for (const candidate of discovered.files) {
    const result = await loadWorkflowFile(sourceId, candidate)
    diagnostics.push(...result.diagnostics)
    if (result.workflow) workflows.push(result.workflow)
    if (result.coreWorkflow) coreWorkflows.push(result.coreWorkflow)
  }
  qualifyDuplicateWorkflowIds(workflows, coreWorkflows)
  return { workflows, coreWorkflows, diagnostics }
}

async function loadWorkflowFile(
  sourceId: string,
  candidate: WorkflowFileCandidate
): Promise<{
  workflow?: WorkflowDefinition
  coreWorkflow?: CoreWorkflowDefinition
  diagnostics: string[]
}> {
  const diagnostics: string[] = []
  const text = Buffer.from(await vscode.workspace.fs.readFile(candidate.file))
    .toString("utf8")
  const compiled = compileWorkflowDocument({ sourceId, filePath: candidate.relativePath, text, strict: true })
  diagnostics.push(...formatWorkflowDiagnostics(compiled))
  if (!compiled.ok || !compiled.workflow) return { diagnostics }
  const coreWorkflow = {
    ...compiled.workflow,
    logicalWorkflowId: compiled.workflow.id,
    workflowRoot: candidate.root.root,
    workflowFile: candidate.file.fsPath,
    workflowFolderName: candidate.root.name
  }
  const workflow = adaptCoreWorkflowForBob(coreWorkflow, candidate.file)
  const workflowDiagnostics = validateAndDescribeWorkflow({
    relativePath: candidate.relativePath,
    folderName: candidate.folderName,
    parsedWorkflowName: compiled.workflow.name,
    workflow
  })
  diagnostics.push(...workflowDiagnostics.diagnostics)
  if (!workflowDiagnostics.ok) return { diagnostics }
  return { workflow, coreWorkflow, diagnostics }
}
