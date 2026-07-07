const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const { readTraceabilityCatalog } = require("../out/core/traceabilityCatalogStore")

async function makeWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bob-trace-wrapper-"))
}

test("readTraceabilityCatalog reads catalog nested in command result", async () => {
  const workspaceRoot = await makeWorkspace()
  const catalogDir = path.join(workspaceRoot, ".bob-trace")
  await fs.mkdir(catalogDir, { recursive: true })
  await fs.writeFile(path.join(catalogDir, "traceability-catalog.json"), JSON.stringify({
    result: "ok",
    catalog: {
      schema_version: 1,
      documents: [],
      domains: [{ code: "PAY", status: "proposed" }],
      items: [{ proposed_id: "REQ-RS001-PAY-0001", type: "requirement", source_document_id: "RS001", domain: "PAY", sequence: 9, status: "proposed" }],
      links: [],
      decisions: []
    }
  }), "utf8")

  const read = await readTraceabilityCatalog({ workspaceRoot })

  assert.equal(read.status, "ok")
  assert.equal(read.catalog.domains.length, 1)
  assert.equal(read.catalog.items.length, 1)
  assert.equal(read.catalog.items[0].sequence, 1)
})
