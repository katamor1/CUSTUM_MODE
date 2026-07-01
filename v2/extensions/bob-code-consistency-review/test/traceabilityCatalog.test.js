const assert = require("node:assert/strict")
const { test } = require("node:test")

const {
  buildReviewInputDraftFromTraceability,
  renderTraceabilityGateReport,
  validateTraceabilityCatalog
} = require("../out/core/traceabilityCatalog")

test("validateTraceabilityCatalog accepts approved sidecar traceability with links", () => {
  const report = validateTraceabilityCatalog(sampleCatalog())

  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.warnings, [])
})

test("validateTraceabilityCatalog reports missing downstream gate links", () => {
  const catalog = sampleCatalog()
  catalog.links = catalog.links.filter((link) => link.link_type !== "satisfies")

  const report = validateTraceabilityCatalog(catalog)

  assert.ok(report.errors.some((item) => item.code === "missing_basic_design"))
  assert.match(renderTraceabilityGateReport(report), /missing_basic_design/)
})

test("validateTraceabilityCatalog accepts approved n/a decisions for missing links", () => {
  const catalog = sampleCatalog()
  catalog.links = catalog.links.filter((link) => link.link_type !== "satisfies")
  catalog.decisions.push({
    subject: "REQ-RS001-PAY-0001",
    gate: "basic_design",
    decision: "n/a",
    reason: "Copy-only wording change with no basic design impact.",
    status: "accepted"
  })

  const report = validateTraceabilityCatalog(catalog)

  assert.deepEqual(report.errors, [])
})

test("validateTraceabilityCatalog rejects accepted items that use unapproved domains", () => {
  const catalog = sampleCatalog()
  catalog.domains[0].status = "proposed"

  const report = validateTraceabilityCatalog(catalog)

  assert.ok(report.errors.some((item) => item.code === "unapproved_domain"))
})

test("buildReviewInputDraftFromTraceability converts accepted catalog items into review-input draft artifacts", () => {
  const result = buildReviewInputDraftFromTraceability(sampleCatalog(), {
    review: {
      id: "REVIEW-PAY-001",
      title: "Payment traceability review",
      change_type: "feature",
      purpose: "Check payment status traceability.",
      base: "main",
      head: "feature/payment",
      vcs: "git"
    },
    review_focus: ["requirement-code-consistency", "design-code-consistency", "test-gap"]
  })

  assert.equal(result.status, "ok")
  assert.deepEqual(result.draft.review.id, "REVIEW-PAY-001")
  assert.deepEqual(result.draft.review_focus, ["requirement-code-consistency", "design-code-consistency", "test-gap"])
  assert.deepEqual(result.draft.artifact_candidates, [
    {
      kind: "requirements",
      path: "docs/requirements-payment.md",
      sections: ["REQ-RS001-PAY-0001"]
    },
    {
      kind: "basic_design",
      path: "docs/basic-design-payment.md",
      sections: ["BD-BD001-PAY-0001"]
    },
    {
      kind: "detailed_design",
      path: "docs/detailed-design-payment.md",
      sections: ["DD-DD001-PAY-0001"]
    },
    {
      kind: "test_spec",
      path: "docs/test-spec-payment.md",
      cases: ["TC-TS001-PAY-0001"]
    }
  ])
})

function sampleCatalog() {
  return {
    schema_version: 1,
    documents: [
      { document_id: "RS001", source_path: "docs/requirements-payment.md", id_source: "extracted" },
      { document_id: "BD001", source_path: "docs/basic-design-payment.md", id_source: "extracted" },
      { document_id: "DD001", source_path: "docs/detailed-design-payment.md", id_source: "extracted" },
      { document_id: "TS001", source_path: "docs/test-spec-payment.md", id_source: "extracted" }
    ],
    domains: [
      { code: "PAY", label: "Payment", status: "accepted" }
    ],
    items: [
      {
        id: "REQ-RS001-PAY-0001",
        proposed_id: "REQ-RS001-PAY-0001",
        type: "requirement",
        source_document_id: "RS001",
        domain: "PAY",
        sequence: 1,
        source_path: "docs/requirements-payment.md",
        status: "accepted"
      },
      {
        id: "BD-BD001-PAY-0001",
        proposed_id: "BD-BD001-PAY-0001",
        type: "basic_design",
        source_document_id: "BD001",
        domain: "PAY",
        sequence: 1,
        source_path: "docs/basic-design-payment.md",
        status: "accepted"
      },
      {
        id: "DD-DD001-PAY-0001",
        proposed_id: "DD-DD001-PAY-0001",
        type: "detailed_design",
        source_document_id: "DD001",
        domain: "PAY",
        sequence: 1,
        source_path: "docs/detailed-design-payment.md",
        status: "accepted"
      },
      {
        id: "TC-TS001-PAY-0001",
        proposed_id: "TC-TS001-PAY-0001",
        type: "test_spec",
        source_document_id: "TS001",
        domain: "PAY",
        sequence: 1,
        source_path: "docs/test-spec-payment.md",
        status: "accepted"
      }
    ],
    links: [
      { from: "REQ-RS001-PAY-0001", to: "BD-BD001-PAY-0001", link_type: "satisfies", status: "accepted" },
      { from: "BD-BD001-PAY-0001", to: "DD-DD001-PAY-0001", link_type: "elaborates", status: "accepted" },
      { from: "DD-DD001-PAY-0001", to: "TC-TS001-PAY-0001", link_type: "verified_by", status: "accepted" },
      { from: "REQ-RS001-PAY-0001", to: "TC-TS001-PAY-0001", link_type: "verified_by", status: "accepted" }
    ],
    decisions: []
  }
}
