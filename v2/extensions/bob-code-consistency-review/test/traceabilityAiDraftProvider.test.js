const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  applyAiTraceabilityDraft,
  mergeAiTraceabilityDraft,
  parseAiTraceabilityDraft,
  prepareAiTraceabilityDraftPrompt
} = require("../out/core/traceabilityAiDraftProvider")
const { writeTraceabilityCatalog } = require("../out/core/traceabilityCatalogStore")

async function makeWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bob-trace-ai-"))
}

test("parseAiTraceabilityDraft rejects AI drafts that try to create accepted state", () => {
  assert.throws(() => parseAiTraceabilityDraft(JSON.stringify({
    schema_version: 1,
    documents: [],
    domains: [{ code: "PAY", status: "accepted" }],
    items: [{ id: "REQ-RS001-PAY-0001", type: "requirement", source_document_id: "RS001", domain: "PAY", sequence: 1, status: "accepted" }],
    links: [{ from: "REQ-RS001-PAY-0001", to: "BD-BD001-PAY-0001", link_type: "satisfies", status: "accepted" }],
    decisions: []
  })), /AI draft must not create accepted state/)
})

test("parseAiTraceabilityDraft rejects oversized proposed draft fields and collections", () => {
  const oversizedField = validProposedDraft()
  oversizedField.domains[0].label = "x".repeat(3000)
  assert.throws(() => parseAiTraceabilityDraft(JSON.stringify(oversizedField)), /exceeds max string length/)

  const oversizedCollection = validProposedDraft()
  oversizedCollection.items = Array.from({ length: 1001 }, (_, index) => ({
    proposed_id: `REQ-RS001-PAY-${String(index + 1).padStart(4, "0")}`,
    type: "requirement",
    source_document_id: "RS001",
    domain: "PAY",
    sequence: index + 1,
    status: "proposed"
  }))
  assert.throws(() => parseAiTraceabilityDraft(JSON.stringify(oversizedCollection)), /items exceeds max count/)
})

test("parseAiTraceabilityDraft prefers JSON fences over Mermaid fences", () => {
  const draft = parseAiTraceabilityDraft(`
### summary

\`\`\`mermaid
graph LR
  A --> B
\`\`\`

\`\`\`json
{
  "schema_version": 1,
  "documents": [],
  "domains": [{ "code": "PAY", "status": "proposed" }],
  "items": [{ "proposed_id": "REQ-RS001-PAY-0001", "type": "requirement", "source_document_id": "RS001", "domain": "PAY", "sequence": 1, "status": "proposed" }],
  "links": [],
  "decisions": []
}
\`\`\`
`)

  assert.equal(draft.domains[0].code, "PAY")
  assert.equal(draft.items[0].proposed_id, "REQ-RS001-PAY-0001")
})

test("parseAiTraceabilityDraft rejects multiple JSON candidates", () => {
  const first = JSON.stringify(validProposedDraft())
  const second = JSON.stringify({
    ...validProposedDraft(),
    domains: [{ code: "AUTH", status: "proposed" }],
    items: [{
      proposed_id: "REQ-RS001-AUTH-0001",
      type: "requirement",
      source_document_id: "RS001",
      domain: "AUTH",
      sequence: 1,
      status: "proposed"
    }]
  })
  assert.throws(() => parseAiTraceabilityDraft(`\`\`\`json\n${first}\n\`\`\`\n\`\`\`json\n${second}\n\`\`\``), /multiple JSON candidates/)
})


test("mergeAiTraceabilityDraft preserves accepted catalog entries and replaces proposed candidates", () => {
  const existing = {
    schema_version: 1,
    documents: [{ document_id: "RS001", source_path: "docs/requirements.md", id_source: "extracted" }],
    domains: [
      { code: "PAY", status: "accepted" },
      { code: "AUTH", status: "proposed", label: "old" }
    ],
    items: [
      acceptedRequirement(),
      {
        proposed_id: "REQ-RS001-AUTH-0001",
        type: "requirement",
        source_document_id: "RS001",
        domain: "AUTH",
        sequence: 1,
        status: "proposed",
        text_summary: "old proposed"
      }
    ],
    links: [],
    decisions: []
  }
  const draft = parseAiTraceabilityDraft(JSON.stringify({
    schema_version: 1,
    documents: [{ document_id: "BD001", source_path: "docs/basic-design.md", id_source: "extracted" }],
    domains: [
      { code: "PAY", status: "proposed", label: "AI must not overwrite accepted domain" },
      { code: "AUTH", status: "proposed", label: "new" }
    ],
    items: [
      {
        proposed_id: "REQ-RS001-PAY-0001",
        type: "requirement",
        source_document_id: "RS001",
        domain: "PAY",
        sequence: 1,
        status: "proposed",
        text_summary: "must not overwrite accepted"
      },
      {
        proposed_id: "REQ-RS001-AUTH-0001",
        type: "requirement",
        source_document_id: "RS001",
        domain: "AUTH",
        sequence: 1,
        status: "proposed",
        text_summary: "new proposed"
      }
    ],
    links: [{ proposed_from: "REQ-RS001-AUTH-0001", proposed_to: "REQ-RS001-PAY-0001", link_type: "references", status: "proposed" }],
    decisions: []
  }))

  const result = mergeAiTraceabilityDraft(existing, draft)

  assert.equal(result.status, "ok")
  assert.equal(result.catalog.domains.find((domain) => domain.code === "PAY").label, undefined)
  assert.equal(result.catalog.domains.find((domain) => domain.code === "AUTH").label, "new")
  assert.equal(result.catalog.items.find((item) => item.id === "REQ-RS001-PAY-0001").text_summary, "accepted")
  assert.equal(result.catalog.items.find((item) => item.proposed_id === "REQ-RS001-AUTH-0001").text_summary, "new proposed")
  assert.equal(result.catalog.links.length, 1)
})

test("applyAiTraceabilityDraft writes a proposed-only draft into the sidecar catalog", async () => {
  const workspaceRoot = await makeWorkspace()

  const result = await applyAiTraceabilityDraft({
    workspaceRoot,
    text: JSON.stringify({
      schema_version: 1,
      documents: [{ document_id: "RS001", source_path: "docs/requirements.md", id_source: "extracted" }],
      domains: [{ code: "PAY", status: "proposed" }],
      items: [{
        proposed_id: "REQ-RS001-PAY-0001",
        type: "requirement",
        source_document_id: "RS001",
        domain: "PAY",
        sequence: 1,
        status: "proposed"
      }],
      links: [],
      decisions: []
    })
  })

  assert.equal(result.status, "ok")
  assert.match(result.revision, /^sha256:[a-f0-9]{64}$/)
  const written = JSON.parse(await fs.readFile(result.catalogPath, "utf8"))
  assert.equal(written.items[0].proposed_id, "REQ-RS001-PAY-0001")
  assert.equal(written.items[0].status, "proposed")
})

test("concurrent AI draft applications preserve one winner and surface one stale conflict", async () => {
  const workspaceRoot = await makeWorkspace()
  await writeTraceabilityCatalog({
    workspaceRoot,
    catalog: { schema_version: 1, documents: [], domains: [], items: [], links: [], decisions: [] }
  })
  const draftA = validProposedDraft()
  const draftB = validProposedDraft()
  draftB.domains = [{ code: "AUTH", status: "proposed" }]
  draftB.items = [{
    proposed_id: "REQ-RS001-AUTH-0001",
    type: "requirement",
    source_document_id: "RS001",
    domain: "AUTH",
    sequence: 1,
    status: "proposed"
  }]

  const results = await Promise.all([
    applyAiTraceabilityDraft({ workspaceRoot, text: JSON.stringify(draftA) }),
    applyAiTraceabilityDraft({ workspaceRoot, text: JSON.stringify(draftB) })
  ])

  assert.deepEqual(results.map((result) => result.status).sort(), ["error", "ok"])
  const conflict = results.find((result) => result.status === "error")
  const winner = results.find((result) => result.status === "ok")
  assert.equal(conflict.code, "stale_revision")
  assert.ok(conflict.errors.some((error) => /stale|refresh|再読込|更新/i.test(error)))
  const written = JSON.parse(await fs.readFile(path.join(workspaceRoot, ".bob-trace", "traceability-catalog.json"), "utf8"))
  assert.deepEqual(written.domains, winner.catalog.domains)
})

test("applyAiTraceabilityDraft rejects draft source paths outside the workspace before writing", async () => {
  const workspaceRoot = await makeWorkspace()
  const result = await applyAiTraceabilityDraft({
    workspaceRoot,
    text: JSON.stringify({
      schema_version: 1,
      documents: [{ document_id: "RS001", source_path: "../outside.md", id_source: "extracted" }],
      domains: [{ code: "PAY", status: "proposed" }],
      items: [{
        proposed_id: "REQ-RS001-PAY-0001",
        type: "requirement",
        source_document_id: "RS001",
        domain: "PAY",
        sequence: 1,
        source_path: "../outside.md",
        status: "proposed"
      }],
      links: [],
      decisions: []
    })
  })

  assert.equal(result.status, "error")
  assert.ok(result.errors.some((error) => error.includes("source_path")))
  await assert.rejects(fs.readFile(path.join(workspaceRoot, ".bob-trace", "traceability-catalog.json"), "utf8"), /ENOENT/)
})

test("prepareAiTraceabilityDraftPrompt writes a proposed-only sidecar catalog prompt", async () => {
  const workspaceRoot = await makeWorkspace()
  await fs.mkdir(path.join(workspaceRoot, "docs"), { recursive: true })
  await fs.writeFile(path.join(workspaceRoot, "docs", "requirements.md"), "REQ-RS001-PAY-0001\n", "utf8")
  await fs.writeFile(path.join(workspaceRoot, "docs", "qa-table.md"), "QA-QA001-PAY-0001\n", "utf8")
  await fs.writeFile(path.join(workspaceRoot, "docs", "review-findings.md"), "RV-RV001-PAY-0001\n", "utf8")
  await fs.writeFile(path.join(workspaceRoot, "diff.json"), JSON.stringify({
    vcs: "git",
    base: "main",
    head: "feature/payment",
    files: [{ path: "src/payment.c", status: "modified", additions: 3, deletions: 1 }],
    unifiedDiff: "diff --git a/src/payment.c b/src/payment.c\n+payment_status();\n",
    warnings: []
  }), "utf8")

  const result = await prepareAiTraceabilityDraftPrompt({
    workspaceRoot,
    outputDir: ".bob-trace/ai-traceability-draft",
    base: "main",
    head: "feature/payment",
    vcs: "git",
    diffFixturePath: path.join(workspaceRoot, "diff.json"),
    textEncoding: "utf8"
  })

  assert.equal(result.status, "ok")
  assert.match(result.prompt, /REQ \/ BD \/ DD \/ TC \/ QA \/ RV/)
  assert.match(result.prompt, /proposed_id/)
  assert.match(result.prompt, /acceptedは禁止/)
  assert.match(result.prompt, /docs\/qa-table\.md/)
  assert.match(result.prompt, /QA-QA001-PAY-0001/)
  assert.match(result.prompt, /src\/payment\.c/)
  assert.equal(await fs.readFile(result.promptPath, "utf8"), result.prompt)
})

function acceptedRequirement() {
  return {
    id: "REQ-RS001-PAY-0001",
    proposed_id: "REQ-RS001-PAY-0001",
    type: "requirement",
    source_document_id: "RS001",
    domain: "PAY",
    sequence: 1,
    status: "accepted",
    text_summary: "accepted"
  }
}

function validProposedDraft() {
  return {
    schema_version: 1,
    documents: [{ document_id: "RS001", source_path: "docs/requirements.md", id_source: "extracted" }],
    domains: [{ code: "PAY", status: "proposed" }],
    items: [{
      proposed_id: "REQ-RS001-PAY-0001",
      type: "requirement",
      source_document_id: "RS001",
      domain: "PAY",
      sequence: 1,
      status: "proposed"
    }],
    links: [],
    decisions: []
  }
}
