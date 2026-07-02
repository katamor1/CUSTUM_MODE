import type { TraceabilityItem, TraceabilityItemType } from "./traceabilityTypes"

const TYPE_PREFIX: Record<TraceabilityItemType, string> = {
  requirement: "REQ",
  basic_design: "BD",
  detailed_design: "DD",
  test_spec: "TC",
  qa_item: "QA",
  review_finding: "RV"
}

export function formatTraceabilityItemId(
  item: Pick<TraceabilityItem, "type" | "source_document_id" | "domain" | "sequence">
): string {
  return `${TYPE_PREFIX[item.type]}-${item.source_document_id}-${item.domain}-${String(item.sequence).padStart(4, "0")}`
}
