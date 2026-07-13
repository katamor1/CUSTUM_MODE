type WorkflowSchemaRoute = "legacy" | "workflow-register/v1"

export function resolveWorkflowSchemaVersion(value: unknown): WorkflowSchemaRoute {
  if (value === undefined || value === "legacy") return "legacy"
  if (value === "workflow-register/v1") return value
  if (typeof value !== "string") {
    throw new Error("field 'schemaVersion' must be a string when provided; supported values are 'workflow-register/v1' and 'legacy'.")
  }
  throw new Error(
    `unsupported schemaVersion ${JSON.stringify(value)}; supported values are 'workflow-register/v1' and 'legacy', or omit the field for legacy workflows.`
  )
}
