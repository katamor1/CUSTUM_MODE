import * as fs from "fs"
import * as path from "path"

export type WorkflowDocumentPathValidationResult =
  | { ok: true; workflowName: string; relativePath: string }
  | { ok: false; reason: string }

const WINDOWS_RESERVED_WORKFLOW_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9"
])

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

export function validateWorkflowDocumentPath(options: { workspaceRoot: string; filePath: string }): WorkflowDocumentPathValidationResult {
  const workspaceRoot = options.workspaceRoot.trim()
  if (!workspaceRoot) return { ok: false, reason: "workspace root is empty" }
  if (!options.filePath.trim()) return { ok: false, reason: "workflow file path is empty" }

  const rootPath = path.resolve(workspaceRoot)
  const targetPath = path.resolve(options.filePath)
  const containment = validatePathInsideWorkspace(rootPath, targetPath)
  if (!containment.ok) return containment

  const relativePath = path.relative(rootPath, targetPath).replace(/\\/g, "/")
  const parts = relativePath.split("/")
  if (parts.length !== 4 || parts[0] !== ".bob" || parts[1] !== "workflows" || parts[3] !== "WORKFLOW.md") {
    return { ok: false, reason: "workflow file must be .bob/workflows/<name>/WORKFLOW.md" }
  }

  const workflowName = parts[2]
  const nameValidation = validateWorkflowFolderName(workflowName)
  if (!nameValidation.ok) return nameValidation

  return { ok: true, workflowName, relativePath }
}

function validateWorkflowFolderName(workflowName: string): WorkflowDocumentPathValidationResult {
  if (!workflowName || workflowName.startsWith(".")) return { ok: false, reason: "workflow folder name must not be empty or hidden" }
  if (/[. ]$/.test(workflowName)) return { ok: false, reason: "workflow folder name must not end with dot or space" }
  if (!/^[A-Za-z0-9._-]+$/.test(workflowName)) return { ok: false, reason: "workflow folder name contains unsupported characters" }
  const reservedBaseName = workflowName.split(".")[0]?.toUpperCase()
  if (reservedBaseName && WINDOWS_RESERVED_WORKFLOW_NAMES.has(reservedBaseName)) return { ok: false, reason: "workflow folder name uses a Windows reserved name" }
  return { ok: true, workflowName, relativePath: `.bob/workflows/${workflowName}/WORKFLOW.md` }
}

function validatePathInsideWorkspace(rootPath: string, targetPath: string): WorkflowDocumentPathValidationResult {
  if (!isInsideOrSame(rootPath, targetPath)) return { ok: false, reason: "workflow file must stay inside the workspace root" }

  const rootRealPath = realpathIfPossible(rootPath) ?? rootPath
  const targetRealBase = realpathIfPossible(targetPath) ?? realpathNearestExistingAncestor(targetPath)
  if (targetRealBase && !isInsideOrSame(rootRealPath, targetRealBase)) {
    return { ok: false, reason: "workflow file resolves outside the workspace root" }
  }

  return { ok: true, workflowName: "", relativePath: "" }
}

function realpathNearestExistingAncestor(filePath: string): string | undefined {
  let current = filePath
  while (true) {
    const real = realpathIfPossible(current)
    if (real) return real
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

function realpathIfPossible(filePath: string): string | undefined {
  try {
    return fs.realpathSync.native(filePath)
  } catch {
    try {
      return fs.realpathSync(filePath)
    } catch {
      return undefined
    }
  }
}

function isInsideOrSame(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}
