import type { ReviewFocus, ReviewInputArtifactDraft, ReviewInputDraft } from "./reviewInputBuilder"
import { validateTraceabilityCatalog } from "./traceabilityValidation"
import type {
  TraceabilityCatalog,
  TraceabilityIssue,
  TraceabilityItemType
} from "./traceabilityTypes"

export type BuildReviewInputDraftFromTraceabilityResult =
  | { status: "ok"; draft: ReviewInputDraft; warnings: TraceabilityIssue[] }
  | { status: "error"; errors: TraceabilityIssue[]; warnings: TraceabilityIssue[] }

const ARTIFACT_KIND: Record<TraceabilityItemType, ReviewInputArtifactDraft["kind"]> = {
  requirement: "requirements",
  basic_design: "basic_design",
  detailed_design: "detailed_design",
  test_spec: "test_spec",
  qa_item: "ledgers",
  review_finding: "tickets"
}

export function buildReviewInputDraftFromTraceability(
  catalog: TraceabilityCatalog,
  options: {
    review: ReviewInputDraft["review"]
    review_focus?: ReviewFocus[]
    focus_preset?: ReviewInputDraft["focus_preset"]
    analysis_options?: ReviewInputDraft["analysis_options"]
    bob_options?: ReviewInputDraft["bob_options"]
  }
): BuildReviewInputDraftFromTraceabilityResult {
  const report = validateTraceabilityCatalog(catalog)
  if (report.errors.length > 0) return { status: "error", errors: report.errors, warnings: report.warnings }

  const documents = new Map(catalog.documents.map((document) => [document.document_id, document]))
  const artifactMap = new Map<string, ReviewInputArtifactDraft>()
  for (const item of catalog.items.filter((candidate) => candidate.status === "accepted" && candidate.id)) {
    const document = documents.get(item.source_document_id)
    const artifactPath = item.source_path ?? document?.source_path
    if (!artifactPath || !item.id) continue
    const kind = ARTIFACT_KIND[item.type]
    const key = `${kind}\n${artifactPath}`
    const artifact = artifactMap.get(key) ?? { kind, path: artifactPath }
    if (item.type === "test_spec") uniquePush(artifact.cases ??= [], item.id)
    else if (item.type === "qa_item" || item.type === "review_finding") uniquePush(artifact.rows ??= [], item.id)
    else uniquePush(artifact.sections ??= [], item.id)
    artifactMap.set(key, artifact)
  }

  return {
    status: "ok",
    draft: {
      review: options.review,
      artifact_candidates: Array.from(artifactMap.values()),
      focus_preset: options.focus_preset,
      review_focus: options.review_focus,
      analysis_options: options.analysis_options,
      bob_options: options.bob_options
    },
    warnings: report.warnings
  }
}

function uniquePush(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value)
}
