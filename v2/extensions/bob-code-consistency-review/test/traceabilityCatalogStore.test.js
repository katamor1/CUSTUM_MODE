const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  DEFAULT_TRACEABILITY_CATALOG_PATH,
  DEFAULT_TRACEABILITY_GATE_REPORT_PATH,
  readTraceabilityCatalog,
  validateAndWriteTraceabilityGateReport,
  writeTraceabilityCatalog
} = require("../out/core/traceabilityCatalogStore")

async function makeWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bob-trace-store-"))
}

test("readTraceabilityCatalog returns an empty sidecar catalog when missing", async () => {
  const workspaceRoot = await makeWorkspace()

  const result = await readTraceabilityCatalog({ workspaceRoot })

  assert.equal(result.status, "ok")
  assert.equal(result.created, true)
  assert.equal(result.catalogPath, path.join(workspaceRoot, DEFAULT_TRACEABILITY_CATALOG_PATH))
  assert.deepEqual(result.catalog, {
    schema_version: 1,
    documents: [],
    domains: [],
    items: [],
    links: [],
    decisions: []
  })
})

test("writeTraceabilityCatalog backs up an existing sidecar before overwrite", async () => {
  const workspaceRoot = await makeWorkspace()
  const first = {
    schema_version: 1,
    documents: [],
    domains: [],
    items: [],
    links: [],
    decisions: []
  }
  const second = {
    ...first,
    documents: [{ document_id: "RS001", source_path: "docs/requirements.md", id_source: "extracted" }]
  }

  await writeTraceabilityCatalog({ workspaceRoot, catalog: first })
  const result = await writeTraceabilityCatalog({ workspaceRoot, catalog: second, backupExisting: true })

  assert.equal(result.status, "ok")
  assert.ok(result.backupPath)
  assert.equal(JSON.parse(await fs.readFile(result.backupPath, "utf8")).documents.length, 0)
  assert.equal(JSON.parse(await fs.readFile(result.catalogPath, "utf8")).documents.length, 1)
})

test("validateAndWriteTraceabilityGateReport writes the markdown gate report", async () => {
  const workspaceRoot = await makeWorkspace()
  await writeTraceabilityCatalog({
    workspaceRoot,
    catalog: {
      schema_version: 1,
      documents: [],
      domains: [],
      items: [],
      links: [],
      decisions: []
    }
  })

  const result = await validateAndWriteTraceabilityGateReport({ workspaceRoot })

  assert.equal(result.status, "ok")
  assert.equal(result.reportPath, path.join(workspaceRoot, DEFAULT_TRACEABILITY_GATE_REPORT_PATH))
  assert.match(await fs.readFile(result.reportPath, "utf8"), /# Traceability Gate Report/)
})
