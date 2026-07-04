export function isWorkflowDocumentPath(filePath: string): boolean {
  const parts = filePath.replace(/\\/g, "/").split("/")
  if (parts.length < 4) return false
  const [bob, workflows, workflowName, fileName] = parts.slice(-4)
  return bob === ".bob" &&
    workflows === "workflows" &&
    Boolean(workflowName) &&
    !workflowName.startsWith(".") &&
    fileName === "WORKFLOW.md"
}
