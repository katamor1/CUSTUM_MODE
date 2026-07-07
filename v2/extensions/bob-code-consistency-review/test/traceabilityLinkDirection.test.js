const assert = require("node:assert/strict")
const test = require("node:test")

const { parseAiTraceabilityDraft } = require("../out/core/traceabilityAiDraftProvider")

test("parseAiTraceabilityDraft canonicalizes reverse proposed link directions", () => {
  const draft = parseAiTraceabilityDraft(JSON.stringify({
    schema_version: 1,
    documents: [
      { document_id: "RS001", source_path: "docs/requirements.md", id_source: "extracted" },
      { document_id: "BD001", source_path: "docs/basic-design.md", id_source: "extracted" },
      { document_id: "DD001", source_path: "docs/detailed-design.md", id_source: "extracted" },
      { document_id: "TC001", source_path: "docs/test-spec.md", id_source: "extracted" },
      { document_id: "QA001", source_path: "docs/qa.md", id_source: "extracted" },
      { document_id: "RV001", source_path: "docs/review.md", id_source: "extracted" }
    ],
    domains: [{ code: "PAY", status: "proposed" }],
    items: [
      { proposed_id: "REQ-RS001-PAY-0001", type: "requirement", source_document_id: "RS001", domain: "PAY", sequence: 1, status: "proposed" },
      { proposed_id: "BD-BD001-PAY-0001", type: "basic_design", source_document_id: "BD001", domain: "PAY", sequence: 1, status: "proposed" },
      { proposed_id: "DD-DD001-PAY-0001", type: "detailed_design", source_document_id: "DD001", domain: "PAY", sequence: 1, status: "proposed" },
      { proposed_id: "TC-TC001-PAY-0001", type: "test_spec", source_document_id: "TC001", domain: "PAY", sequence: 1, status: "proposed" },
      { proposed_id: "QA-QA001-PAY-0001", type: "qa_item", source_document_id: "QA001", domain: "PAY", sequence: 1, status: "proposed" },
      { proposed_id: "RV-RV001-PAY-0001", type: "review_finding", source_document_id: "RV001", domain: "PAY", sequence: 1, status: "proposed" }
    ],
    links: [
      { proposed_from: "BD-BD001-PAY-0001", proposed_to: "REQ-RS001-PAY-0001", link_type: "satisfies", status: "proposed" },
      { proposed_from: "DD-DD001-PAY-0001", proposed_to: "BD-BD001-PAY-0001", link_type: "elaborates", status: "proposed" },
      { proposed_from: "TC-TC001-PAY-0001", proposed_to: "REQ-RS001-PAY-0001", link_type: "verified_by", status: "proposed" },
      { proposed_from: "REQ-RS001-PAY-0001", proposed_to: "QA-QA001-PAY-0001", link_type: "clarifies", status: "proposed" },
      { proposed_from: "RV-RV001-PAY-0001", proposed_to: "REQ-RS001-PAY-0001", link_type: "reviewed_by", status: "proposed" }
    ],
    decisions: []
  }))

  assert.ok(hasLink(draft, "REQ-RS001-PAY-0001", "BD-BD001-PAY-0001", "satisfies"))
  assert.ok(hasLink(draft, "BD-BD001-PAY-0001", "DD-DD001-PAY-0001", "elaborates"))
  assert.ok(hasLink(draft, "REQ-RS001-PAY-0001", "TC-TC001-PAY-0001", "verified_by"))
  assert.ok(hasLink(draft, "DD-DD001-PAY-0001", "TC-TC001-PAY-0001", "verified_by"))
  assert.ok(hasLink(draft, "QA-QA001-PAY-0001", "REQ-RS001-PAY-0001", "clarifies"))
  assert.ok(hasLink(draft, "REQ-RS001-PAY-0001", "RV-RV001-PAY-0001", "reviewed_by"))
})

function hasLink(catalog, from, to, linkType) {
  return catalog.links.some((link) => link.proposed_from === from && link.proposed_to === to && link.link_type === linkType)
}
