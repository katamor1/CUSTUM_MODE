const assert = require("node:assert/strict")
const test = require("node:test")

const {
  applyTraceabilityPrepAction,
  buildTraceabilityPrepModel
} = require("../out/core/traceabilityPrepController")

test("applyTraceabilityPrepAction approves proposed items and links into accepted endpoints", () => {
  const catalog = proposedCatalog()

  const itemResult = applyTraceabilityPrepAction(catalog, { type: "approveItem", proposed_id: "REQ-RS001-PAY-0001" })
  assert.equal(itemResult.status, "ok")
  assert.equal(itemResult.catalog.items[0].status, "accepted")
  assert.equal(itemResult.catalog.items[0].id, "REQ-RS001-PAY-0001")

  const linkResult = applyTraceabilityPrepAction(itemResult.catalog, {
    type: "approveLink",
    proposed_from: "REQ-RS001-PAY-0001",
    proposed_to: "BD-BD001-PAY-0001",
    link_type: "satisfies"
  })
  assert.equal(linkResult.status, "ok")
  assert.equal(linkResult.catalog.links[0].status, "accepted")
  assert.equal(linkResult.catalog.links[0].from, "REQ-RS001-PAY-0001")
  assert.equal(linkResult.catalog.links[0].to, "BD-BD001-PAY-0001")
})

test("applyTraceabilityPrepAction restores item status and generated fields from the original catalog", () => {
  const originalCatalog = proposedCatalog()

  const approved = applyTraceabilityPrepAction(originalCatalog, {
    type: "approveItem",
    proposed_id: "REQ-RS001-PAY-0001"
  })
  const restoredApproved = applyTraceabilityPrepAction(approved.catalog, {
    type: "restoreItem",
    id: "REQ-RS001-PAY-0001"
  }, originalCatalog)
  assert.equal(restoredApproved.status, "ok")
  assert.equal(restoredApproved.catalog.items[0].status, "proposed")
  assert.equal(restoredApproved.catalog.items[0].id, undefined)

  const deprecated = applyTraceabilityPrepAction(originalCatalog, {
    type: "deprecateItem",
    id: "BD-BD001-PAY-0001"
  })
  const restoredDeprecated = applyTraceabilityPrepAction(deprecated.catalog, {
    type: "restoreItem",
    id: "BD-BD001-PAY-0001"
  }, originalCatalog)
  assert.equal(restoredDeprecated.status, "ok")
  assert.equal(restoredDeprecated.catalog.items[1].status, "accepted")
})

test("applyTraceabilityPrepAction restores link endpoints from the original catalog", () => {
  const originalCatalog = proposedCatalog()
  const approved = applyTraceabilityPrepAction(originalCatalog, {
    type: "approveLink",
    proposed_from: "REQ-RS001-PAY-0001",
    proposed_to: "BD-BD001-PAY-0001",
    link_type: "satisfies"
  })

  const restored = applyTraceabilityPrepAction(approved.catalog, {
    type: "restoreLink",
    from: "REQ-RS001-PAY-0001",
    to: "BD-BD001-PAY-0001",
    link_type: "satisfies"
  }, originalCatalog)

  assert.equal(restored.status, "ok")
  assert.equal(restored.catalog.links[0].status, "proposed")
  assert.equal(restored.catalog.links[0].from, undefined)
  assert.equal(restored.catalog.links[0].to, undefined)
})

test("applyTraceabilityPrepAction rejects n/a approval without a reason", () => {
  const catalog = proposedCatalog()
  catalog.decisions.push({ subject: "REQ-RS001-PAY-0001", gate: "basic_design", decision: "n/a", status: "proposed" })

  const result = applyTraceabilityPrepAction(catalog, {
    type: "approveDecision",
    subject: "REQ-RS001-PAY-0001",
    gate: "basic_design"
  })

  assert.equal(result.status, "error")
  assert.match(result.message, /reason/)
})

test("applyTraceabilityPrepAction defers eligible gate errors as accepted TBD decisions", () => {
  const catalog = proposedCatalog()
  const before = buildTraceabilityPrepModel(catalog)
  assert.ok(before.report.errors.some((item) => item.code === "missing_detailed_design"))

  const result = applyTraceabilityPrepAction(catalog, {
    type: "deferIssue",
    code: "missing_detailed_design",
    subject: "BD-BD001-PAY-0001",
    message: "basic design still needs a detailed design trace"
  })

  assert.equal(result.status, "ok")
  assert.equal(result.catalog.decisions[0].decision, "tbd")
  assert.equal(result.catalog.decisions[0].gate, "detailed_design")
  assert.equal(result.catalog.decisions[0].status, "accepted")
  assert.ok(result.model.report.warnings.some((item) => item.code === "tbd_decision"))
  assert.ok(!result.model.report.errors.some((item) => item.code === "missing_detailed_design"))
})

test("buildTraceabilityPrepModel exposes QA and review gate issues for the Webview", () => {
  const catalog = proposedCatalog()
  catalog.items.push({
    id: "QA-QA001-PAY-0001",
    proposed_id: "QA-QA001-PAY-0001",
    type: "qa_item",
    source_document_id: "QA001",
    domain: "PAY",
    sequence: 1,
    status: "accepted",
    qa: { question: "Q", answer: "A", status: "answered" }
  })
  catalog.documents.push({ document_id: "QA001", source_path: "docs/qa.xlsx", id_source: "extracted" })

  const model = buildTraceabilityPrepModel(catalog)

  assert.ok(model.report.errors.some((item) => item.code === "missing_qa_clarifies"))
  assert.ok(model.report.warnings.some((item) => item.code === "qa_answered_not_closed"))
})

function proposedCatalog() {
  return {
    schema_version: 1,
    documents: [
      { document_id: "RS001", source_path: "docs/requirements.md", id_source: "extracted" },
      { document_id: "BD001", source_path: "docs/basic-design.md", id_source: "extracted" }
    ],
    domains: [{ code: "PAY", status: "accepted" }],
    items: [
      {
        proposed_id: "REQ-RS001-PAY-0001",
        type: "requirement",
        source_document_id: "RS001",
        domain: "PAY",
        sequence: 1,
        status: "proposed"
      },
      {
        id: "BD-BD001-PAY-0001",
        proposed_id: "BD-BD001-PAY-0001",
        type: "basic_design",
        source_document_id: "BD001",
        domain: "PAY",
        sequence: 1,
        status: "accepted"
      }
    ],
    links: [
      {
        proposed_from: "REQ-RS001-PAY-0001",
        proposed_to: "BD-BD001-PAY-0001",
        link_type: "satisfies",
        status: "proposed"
      }
    ],
    decisions: []
  }
}
