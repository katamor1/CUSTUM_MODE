import { pathExists, readTextFile, resolveWorkspacePathForKind, writeJsonFile, writeTextFile } from "./fileSystem"
import { renderTraceabilityGateReport, validateTraceabilityCatalog, type TraceabilityCatalog, type TraceabilityValidationReport } from "./traceabilityCatalog"

export const DEFAULT_TRACEABILITY_CATALOG_PATH = ".bob-trace/traceability-catalog.json"
export const DEFAULT_TRACEABILITY_GATE_REPORT_PATH = ".bob-trace/gate-report.md"

export type ReadTraceabilityCatalogResult =
  | { status: "ok"; catalog: TraceabilityCatalog; catalogPath: string; created: boolean }
  | { status: "error"; catalogPath: string; errors: string[] }

export type WriteTraceabilityCatalogResult =
  | { status: "ok"; catalogPath: string; backupPath?: string }
  | { status: "error"; catalogPath: string; errors: string[] }

export type ValidateAndWriteTraceabilityGateReportResult =
  | { status: "ok"; catalogPath: string; reportPath: string; report: TraceabilityValidationReport; markdown: string }
  | { status: "error"; catalogPath: string; reportPath: string; errors: string[] }

export async function readTraceabilityCatalog(input: {
  workspaceRoot: string
  catalogPath?: string
  textEncoding?: string
}): Promise<ReadTraceabilityCatalogResult> {
  const catalogPath = resolveCatalogPath(input.workspaceRoot, input.catalogPath)
  if (!(await pathExists(catalogPath))) {
    return { status: "ok", catalog: emptyTraceabilityCatalog(), catalogPath, created: true }
  }

  try {
    const parsed = JSON.parse(await readTextFile(catalogPath, input.textEncoding ?? "utf8")) as TraceabilityCatalog
    return { status: "ok", catalog: normalizeCatalog(parsed), catalogPath, created: false }
  } catch (error) {
    return {
      status: "error",
      catalogPath,
      errors: [`traceability catalog JSON parse failed: ${error instanceof Error ? error.message : String(error)}`]
    }
  }
}

export async function writeTraceabilityCatalog(input: {
  workspaceRoot: string
  catalogPath?: string
  catalog: TraceabilityCatalog
  backupExisting?: boolean
}): Promise<WriteTraceabilityCatalogResult> {
  const catalogPath = resolveCatalogPath(input.workspaceRoot, input.catalogPath)
  try {
    let backupPath: string | undefined
    if (input.backupExisting && await pathExists(catalogPath)) {
      backupPath = `${catalogPath}.bak-${timestampForFileName(new Date())}`
      await writeTextFile(backupPath, await readTextFile(catalogPath, "utf8"))
    }
    await writeJsonFile(catalogPath, normalizeCatalog(input.catalog))
    return { status: "ok", catalogPath, backupPath }
  } catch (error) {
    return {
      status: "error",
      catalogPath,
      errors: [`traceability catalog write failed: ${error instanceof Error ? error.message : String(error)}`]
    }
  }
}

export async function validateAndWriteTraceabilityGateReport(input: {
  workspaceRoot: string
  catalogPath?: string
  reportPath?: string
  textEncoding?: string
}): Promise<ValidateAndWriteTraceabilityGateReportResult> {
  const catalogPath = resolveCatalogPath(input.workspaceRoot, input.catalogPath)
  const reportPath = resolveWorkspacePathForKind(input.workspaceRoot, input.reportPath ?? DEFAULT_TRACEABILITY_GATE_REPORT_PATH, "traceability-gate-report")
  const read = await readTraceabilityCatalog({ workspaceRoot: input.workspaceRoot, catalogPath: input.catalogPath, textEncoding: input.textEncoding })
  if (read.status === "error") return { status: "error", catalogPath, reportPath, errors: read.errors }

  const report = validateTraceabilityCatalog(read.catalog)
  const markdown = renderTraceabilityGateReport(report)
  try {
    await writeTextFile(reportPath, markdown)
    return { status: "ok", catalogPath, reportPath, report, markdown }
  } catch (error) {
    return {
      status: "error",
      catalogPath,
      reportPath,
      errors: [`traceability gate report write failed: ${error instanceof Error ? error.message : String(error)}`]
    }
  }
}

export function emptyTraceabilityCatalog(): TraceabilityCatalog {
  return {
    schema_version: 1,
    documents: [],
    domains: [],
    items: [],
    links: [],
    decisions: []
  }
}

export function resolveCatalogPath(workspaceRoot: string, catalogPath = DEFAULT_TRACEABILITY_CATALOG_PATH): string {
  return resolveWorkspacePathForKind(workspaceRoot, catalogPath, "traceability-catalog")
}

function normalizeCatalog(catalog: TraceabilityCatalog): TraceabilityCatalog {
  return {
    schema_version: 1,
    documents: Array.isArray(catalog.documents) ? catalog.documents : [],
    domains: Array.isArray(catalog.domains) ? catalog.domains : [],
    items: Array.isArray(catalog.items) ? catalog.items : [],
    links: Array.isArray(catalog.links) ? catalog.links : [],
    decisions: Array.isArray(catalog.decisions) ? catalog.decisions : []
  }
}

function timestampForFileName(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}
