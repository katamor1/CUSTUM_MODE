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

test("validateTraceabilityCatalog accepts TBD decisions for missing links and keeps warnings", () => {
  const catalog = sampleCatalog()
  catalog.links = catalog.links.filter((link) => link.link_type !== "satisfies")
  catalog.decisions.push({
    subject: "REQ-RS001-PAY-0001",
    gate: "basic_design",
    decision: "tbd",
    reason: "TBD: basic design trace is not confirmed yet.",
    status: "accepted"
  })

  const report = validateTraceabilityCatalog(catalog)
  const draft = buildReviewInputDraftFromTraceability(catalog, {
    review: {
      id: "REVIEW-PAY-001",
      title: "Payment traceability review",
      change_type: "feature",
      purpose: "Check payment status traceability.",
      base: "main",
      head: "feature/payment",
      vcs: "git"
    }
  })

  assert.deepEqual(report.errors, [])
  assert.ok(report.warnings.some((item) => item.code === "tbd_decision"))
  assert.equal(draft.status, "ok")
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

test("validateTraceabilityCatalog accepts linked QA and resolved review findings", () => {
  const report = validateTraceabilityCatalog(sampleCatalogWithQaAndReview())

  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.warnings, [])
})

test("validateTraceabilityCatalog reports accepted QA items without clarifies links", () => {
  const catalog = sampleCatalogWithQaAndReview()
  catalog.links = catalog.links.filter((link) => link.link_type !== "clarifies")

  const report = validateTraceabilityCatalog(catalog)

  assert.ok(report.errors.some((item) => item.code === "missing_qa_clarifies"))
})

test("validateTraceabilityCatalog reports unlinked or unresolved review findings", () => {
  const catalog = sampleCatalogWithQaAndReview()
  catalog.links = catalog.links.filter((link) => link.link_type !== "reviewed_by")
  catalog.items.find((item) => item.type === "review_finding").review.status = "open"

  const report = validateTraceabilityCatalog(catalog)

  assert.ok(report.errors.some((item) => item.code === "missing_reviewed_by"))
  assert.ok(report.errors.some((item) => item.code === "unresolved_review_finding"))
})

test("validateTraceabilityCatalog accepts TBD decisions for QA and review-finding gates", () => {
  const catalog = sampleCatalogWithQaAndReview()
  catalog.links = catalog.links.filter((link) => link.link_type !== "clarifies" && link.link_type !== "reviewed_by")
  catalog.items.find((item) => item.type === "review_finding").review.status = "open"
  catalog.decisions.push(
    {
      subject: "QA-QA001-PAY-0001",
      gate: "clarifies",
      decision: "tbd",
      reason: "TBD: QA clarification target is not confirmed yet.",
      status: "accepted"
    },
    {
      subject: "RV-RV001-PAY-0001",
      gate: "reviewed_by",
      decision: "tbd",
      reason: "TBD: review finding source item is not confirmed yet.",
      status: "accepted"
    },
    {
      subject: "RV-RV001-PAY-0001",
      gate: "resolution",
      decision: "tbd",
      reason: "TBD: review finding resolution is being tracked outside Traceability Prep.",
      status: "accepted"
    }
  )

  const report = validateTraceabilityCatalog(catalog)

  assert.deepEqual(report.errors, [])
  assert.equal(report.warnings.filter((item) => item.code === "tbd_decision").length, 3)
})

test("buildReviewInputDraftFromTraceability maps accepted QA and review findings into review-input artifacts", () => {
  const result = buildReviewInputDraftFromTraceability(sampleCatalogWithQaAndReview(), {
    review: {
      id: "REVIEW-PAY-001",
      title: "Payment traceability review",
      change_type: "feature",
      purpose: "Check payment status traceability.",
      base: "main",
      head: "feature/payment",
      vcs: "git"
    }
  })

  assert.equal(result.status, "ok")
  assert.deepEqual(result.draft.artifact_candidates.slice(-2), [
    {
      kind: "ledgers",
      path: "docs/qa-payment.xlsx",
      rows: ["QA-QA001-PAY-0001"]
    },
    {
      kind: "tickets",
      path: "docs/review-findings.xlsx",
      rows: ["RV-RV001-PAY-0001"]
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

function sampleCatalogWithQaAndReview() {
  const catalog = sampleCatalog()
  catalog.documents.push(
    { document_id: "QA001", source_path: "docs/qa-payment.xlsx", id_source: "extracted" },
    { document_id: "RV001", source_path: "docs/review-findings.xlsx", id_source: "extracted" }
  )
  catalog.items.push(
    {
      id: "QA-QA001-PAY-0001",
      proposed_id: "QA-QA001-PAY-0001",
      type: "qa_item",
      source_document_id: "QA001",
      domain: "PAY",
      sequence: 1,
      source_path: "docs/qa-payment.xlsx",
      status: "accepted",
      qa: {
        question: "決済ステータスが仕様で定義されているか。",
        answer: "REQ-RS001-PAY-0001 で定義済み。",
        status: "closed"
      }
    },
    {
      id: "RV-RV001-PAY-0001",
      proposed_id: "RV-RV001-PAY-0001",
      type: "review_finding",
      source_document_id: "RV001",
      domain: "PAY",
      sequence: 1,
      source_path: "docs/review-findings.xlsx",
      status: "accepted",
      review: {
        severity: "major",
        action_plan: "要求IDとの対応を確認した。",
        status: "closed"
      }
    }
  )
  catalog.links.push(
    { from: "QA-QA001-PAY-0001", to: "REQ-RS001-PAY-0001", link_type: "clarifies", status: "accepted" },
    { from: "REQ-RS001-PAY-0001", to: "RV-RV001-PAY-0001", link_type: "reviewed_by", status: "accepted" }
  )
  return catalog
}
