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
  assert.equal(result.revision, null)
  assert.deepEqual(result.catalog, {
    schema_version: 1,
    documents: [],
    domains: [],
    items: [],
    links: [],
    decisions: []
  })
})

test("readTraceabilityCatalog returns an opaque raw-content revision for an existing catalog", async () => {
  const workspaceRoot = await makeWorkspace()
  const written = await writeTraceabilityCatalog({ workspaceRoot, catalog: catalogWithDocument("initial") })

  const read = await readTraceabilityCatalog({ workspaceRoot })

  assert.equal(read.status, "ok")
  assert.match(read.revision, /^sha256:[a-f0-9]{64}$/)
  assert.equal(read.revision, written.revision)
  assert.equal(Object.hasOwn(read.catalog, "revision"), false)
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

test("gate report commit-time CAS preserves a catalog changed while the report temp file is pending", async () => {
  const workspaceRoot = await makeWorkspace()
  const catalogPath = path.join(workspaceRoot, DEFAULT_TRACEABILITY_CATALOG_PATH)
  const reportPath = path.join(workspaceRoot, DEFAULT_TRACEABILITY_GATE_REPORT_PATH)
  const initial = await writeTraceabilityCatalog({ workspaceRoot, catalog: catalogWithDocument("initial") })
  assert.equal(initial.status, "ok")
  await fs.mkdir(path.dirname(reportPath), { recursive: true })
  const existingReport = Buffer.from("existing report must survive\n", "utf8")
  await fs.writeFile(reportPath, existingReport)
  const externalBytes = Buffer.from(`${JSON.stringify(catalogWithDocument("external-winner"), null, 2)}\n`, "utf8")
  const barrier = installTargetTempOpenBarrier(reportPath)

  try {
    const pendingReport = validateAndWriteTraceabilityGateReport({
      workspaceRoot,
      expectedRevision: initial.revision
    })
    await barrier.waitUntilEntered()
    await fs.writeFile(catalogPath, externalBytes)
    barrier.release()

    const result = await pendingReport
    assert.equal(result.status, "error")
    assert.equal(result.code, "stale_revision")
    assert.deepEqual(await fs.readFile(catalogPath), externalBytes)
    assert.deepEqual(await fs.readFile(reportPath), existingReport)
    const names = await fs.readdir(path.dirname(reportPath))
    assert.equal(names.some((name) => name.endsWith(".tmp")), false)
  } finally {
    barrier.release()
    barrier.restore()
  }
})

test("gate reports reject a report file alias that resolves to the catalog itself", async (t) => {
  const workspaceRoot = await makeWorkspace()
  const catalogPath = path.join(workspaceRoot, DEFAULT_TRACEABILITY_CATALOG_PATH)
  const initial = await writeTraceabilityCatalog({ workspaceRoot, catalog: catalogWithDocument("catalog-must-survive") })
  assert.equal(initial.status, "ok")
  const catalogBytes = await fs.readFile(catalogPath)
  const reportRelativePath = ".custom/catalog-report-alias.md"
  const reportAliasPath = path.join(workspaceRoot, reportRelativePath)
  if (!await createCatalogFileAlias(t, catalogPath, reportAliasPath)) return

  const result = await validateAndWriteTraceabilityGateReport({
    workspaceRoot,
    reportPath: reportRelativePath,
    expectedRevision: initial.revision
  })

  assert.equal(result.status, "error")
  assert.match(result.errors.join("\n"), /same physical target|catalog/i)
  assert.deepEqual(await fs.readFile(catalogPath), catalogBytes)
  assert.equal((await fs.lstat(reportAliasPath)).isSymbolicLink(), true)
})

test("catalog compare-and-set allows one A/B writer and rejects the stale writer without another backup", async () => {
  const workspaceRoot = await makeWorkspace()
  await writeTraceabilityCatalog({ workspaceRoot, catalog: catalogWithDocument("initial") })
  const readerA = await readTraceabilityCatalog({ workspaceRoot })
  const readerB = await readTraceabilityCatalog({ workspaceRoot })
  assert.equal(readerA.status, "ok")
  assert.equal(readerB.status, "ok")
  assert.equal(readerA.revision, readerB.revision)

  const [writeA, writeB] = await Promise.all([
    writeTraceabilityCatalog({
      workspaceRoot,
      catalog: catalogWithDocument("writer-a"),
      backupExisting: true,
      expectedRevision: readerA.revision
    }),
    writeTraceabilityCatalog({
      workspaceRoot,
      catalog: catalogWithDocument("writer-b"),
      backupExisting: true,
      expectedRevision: readerB.revision
    })
  ])

  const winner = writeA.status === "ok" ? { result: writeA, label: "writer-a" } : { result: writeB, label: "writer-b" }
  const loser = writeA.status === "error" ? writeA : writeB
  assert.equal(winner.result.status, "ok")
  assert.match(winner.result.revision, /^sha256:[a-f0-9]{64}$/)
  assert.equal(loser.status, "error")
  assert.equal(loser.code, "stale_revision")
  assert.ok(loser.errors.some((error) => /stale|refresh|再読込|更新/i.test(error)))

  const final = JSON.parse(await fs.readFile(path.join(workspaceRoot, DEFAULT_TRACEABILITY_CATALOG_PATH), "utf8"))
  assert.equal(final.documents[0].document_id, winner.label)
  const backupNames = (await fs.readdir(path.join(workspaceRoot, ".bob-trace")))
    .filter((name) => name.includes("traceability-catalog.json.bak-"))
  assert.equal(backupNames.length, 1)
  const backup = JSON.parse(await fs.readFile(path.join(workspaceRoot, ".bob-trace", backupNames[0]), "utf8"))
  assert.equal(backup.documents[0].document_id, "initial")
})

test("catalog backups remain unique across same-second successful writes", async () => {
  const workspaceRoot = await makeWorkspace()
  const initial = await writeTraceabilityCatalog({ workspaceRoot, catalog: catalogWithDocument("initial") })
  const first = await writeTraceabilityCatalog({
    workspaceRoot,
    catalog: catalogWithDocument("first"),
    backupExisting: true,
    expectedRevision: initial.revision
  })
  assert.equal(first.status, "ok")
  const second = await writeTraceabilityCatalog({
    workspaceRoot,
    catalog: catalogWithDocument("second"),
    backupExisting: true,
    expectedRevision: first.revision
  })
  assert.equal(second.status, "ok")

  assert.notEqual(first.backupPath, second.backupPath)
  assert.equal(JSON.parse(await fs.readFile(first.backupPath, "utf8")).documents[0].document_id, "initial")
  assert.equal(JSON.parse(await fs.readFile(second.backupPath, "utf8")).documents[0].document_id, "first")
})

test("commit-time CAS preserves an external update made while the candidate temp file is pending", async () => {
  const workspaceRoot = await makeWorkspace()
  const catalogPath = path.join(workspaceRoot, DEFAULT_TRACEABILITY_CATALOG_PATH)
  const initial = await writeTraceabilityCatalog({ workspaceRoot, catalog: catalogWithDocument("initial") })
  assert.equal(initial.status, "ok")
  const externalBytes = Buffer.from(`${JSON.stringify(catalogWithDocument("external-winner"), null, 2)}\n`, "utf8")
  const barrier = installTargetTempOpenBarrier(catalogPath)

  try {
    const pendingWrite = writeTraceabilityCatalog({
      workspaceRoot,
      catalog: catalogWithDocument("stale-candidate"),
      backupExisting: true,
      expectedRevision: initial.revision
    })
    await barrier.waitUntilEntered()
    await fs.writeFile(catalogPath, externalBytes)
    barrier.release()

    const result = await pendingWrite
    assert.equal(result.status, "error")
    assert.equal(result.code, "stale_revision")
    assert.deepEqual(await fs.readFile(catalogPath), externalBytes)
    const names = await fs.readdir(path.dirname(catalogPath))
    assert.equal(names.some((name) => name.endsWith(".tmp")), false)
    assert.equal(names.some((name) => name.includes("traceability-catalog.json.bak-")), false)
  } finally {
    barrier.release()
    barrier.restore()
  }
})

test("commit-time CAS treats a missing catalog that appears while the candidate temp file is pending as stale", async () => {
  const workspaceRoot = await makeWorkspace()
  const catalogPath = path.join(workspaceRoot, DEFAULT_TRACEABILITY_CATALOG_PATH)
  const initial = await readTraceabilityCatalog({ workspaceRoot })
  assert.equal(initial.status, "ok")
  assert.equal(initial.revision, null)
  const externalBytes = Buffer.from(`${JSON.stringify(catalogWithDocument("external-create"), null, 2)}\n`, "utf8")
  const barrier = installTargetTempOpenBarrier(catalogPath)

  try {
    const pendingWrite = writeTraceabilityCatalog({
      workspaceRoot,
      catalog: catalogWithDocument("stale-create"),
      backupExisting: true,
      expectedRevision: initial.revision
    })
    await barrier.waitUntilEntered()
    await fs.writeFile(catalogPath, externalBytes)
    barrier.release()

    const result = await pendingWrite
    assert.equal(result.status, "error")
    assert.equal(result.code, "stale_revision")
    assert.deepEqual(await fs.readFile(catalogPath), externalBytes)
    const names = await fs.readdir(path.dirname(catalogPath))
    assert.equal(names.some((name) => name.endsWith(".tmp")), false)
    assert.equal(names.some((name) => name.includes("traceability-catalog.json.bak-")), false)
  } finally {
    barrier.release()
    barrier.restore()
  }
})

test("gate report expected revision rejects a changed catalog without writing a stale report", async () => {
  const workspaceRoot = await makeWorkspace()
  const initial = await writeTraceabilityCatalog({ workspaceRoot, catalog: catalogWithDocument("initial") })
  await writeTraceabilityCatalog({ workspaceRoot, catalog: catalogWithDocument("winner") })

  const result = await validateAndWriteTraceabilityGateReport({
    workspaceRoot,
    expectedRevision: initial.revision
  })

  assert.equal(result.status, "error")
  assert.equal(result.code, "stale_revision")
  await assert.rejects(fs.readFile(path.join(workspaceRoot, DEFAULT_TRACEABILITY_GATE_REPORT_PATH), "utf8"), /ENOENT/)
})

test("physical catalog aliases share one CAS queue for an existing target", async (t) => {
  const workspaceRoot = await makeWorkspace()
  const initial = await writeTraceabilityCatalog({ workspaceRoot, catalog: catalogWithDocument("initial") })
  const aliasPath = await createCatalogDirectoryAlias(t, workspaceRoot)
  if (!aliasPath) return
  const directRead = await readTraceabilityCatalog({ workspaceRoot })
  const aliasRead = await readTraceabilityCatalog({ workspaceRoot, catalogPath: aliasPath })
  assert.equal(directRead.status, "ok")
  assert.equal(aliasRead.status, "ok")
  assert.equal(directRead.revision, initial.revision)
  assert.equal(aliasRead.revision, initial.revision)

  const results = await Promise.all([
    writeTraceabilityCatalog({
      workspaceRoot,
      catalog: catalogWithDocument("direct-winner-candidate"),
      expectedRevision: directRead.revision
    }),
    writeTraceabilityCatalog({
      workspaceRoot,
      catalogPath: aliasPath,
      catalog: catalogWithDocument("alias-winner-candidate"),
      expectedRevision: aliasRead.revision
    })
  ])

  assert.deepEqual(results.map((result) => result.status).sort(), ["error", "ok"])
  assert.equal(results.find((result) => result.status === "error").code, "stale_revision")
})

test("physical catalog aliases share one CAS queue while the target is missing", async (t) => {
  const workspaceRoot = await makeWorkspace()
  await fs.mkdir(path.join(workspaceRoot, ".bob-trace"), { recursive: true })
  const aliasPath = await createCatalogDirectoryAlias(t, workspaceRoot)
  if (!aliasPath) return
  const directRead = await readTraceabilityCatalog({ workspaceRoot })
  const aliasRead = await readTraceabilityCatalog({ workspaceRoot, catalogPath: aliasPath })
  assert.equal(directRead.status, "ok")
  assert.equal(aliasRead.status, "ok")
  assert.equal(directRead.revision, null)
  assert.equal(aliasRead.revision, null)

  const results = await Promise.all([
    writeTraceabilityCatalog({
      workspaceRoot,
      catalog: catalogWithDocument("direct-create-candidate"),
      expectedRevision: directRead.revision
    }),
    writeTraceabilityCatalog({
      workspaceRoot,
      catalogPath: aliasPath,
      catalog: catalogWithDocument("alias-create-candidate"),
      expectedRevision: aliasRead.revision
    })
  ])

  assert.deepEqual(results.map((result) => result.status).sort(), ["error", "ok"])
  assert.equal(results.find((result) => result.status === "error").code, "stale_revision")
})

test("a file-symlink catalog alias writes the physical target without forking CAS state", async (t) => {
  const workspaceRoot = await makeWorkspace()
  const directWrite = await writeTraceabilityCatalog({
    workspaceRoot,
    catalog: catalogWithDocument("initial")
  })
  assert.equal(directWrite.status, "ok")
  const directPath = path.join(workspaceRoot, DEFAULT_TRACEABILITY_CATALOG_PATH)
  const aliasRelativePath = ".custom/catalog-file-alias.json"
  const aliasPath = path.join(workspaceRoot, aliasRelativePath)
  await fs.mkdir(path.dirname(aliasPath), { recursive: true })
  try {
    await fs.symlink(directPath, aliasPath, "file")
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP", "UNKNOWN"].includes(error.code)) {
      t.skip(`file symlink unavailable: ${error.code}`)
      return
    }
    throw error
  }
  const aliasReader = await readTraceabilityCatalog({ workspaceRoot, catalogPath: aliasRelativePath })
  const directReader = await readTraceabilityCatalog({ workspaceRoot })
  assert.equal(aliasReader.status, "ok")
  assert.equal(directReader.status, "ok")
  assert.equal(aliasReader.revision, directReader.revision)

  const aliasWinner = await writeTraceabilityCatalog({
    workspaceRoot,
    catalogPath: aliasRelativePath,
    catalog: catalogWithDocument("alias-winner"),
    backupExisting: true,
    expectedRevision: aliasReader.revision
  })
  const directLoser = await writeTraceabilityCatalog({
    workspaceRoot,
    catalog: catalogWithDocument("direct-stale"),
    backupExisting: true,
    expectedRevision: directReader.revision
  })

  assert.equal(aliasWinner.status, "ok")
  assert.equal(aliasWinner.catalogPath, aliasPath)
  assert.equal(directLoser.status, "error")
  assert.equal(directLoser.code, "stale_revision")
  assert.equal((await fs.lstat(aliasPath)).isSymbolicLink(), true)
  assert.equal(normalizePhysicalPath(await fs.realpath(aliasPath)), normalizePhysicalPath(await fs.realpath(directPath)))
  const aliasBytes = await fs.readFile(aliasPath)
  const directBytes = await fs.readFile(directPath)
  assert.deepEqual(aliasBytes, directBytes)
  assert.equal(JSON.parse(aliasBytes.toString("utf8")).documents[0].document_id, "alias-winner")
  assert.equal(path.dirname(aliasWinner.backupPath), path.dirname(directPath))
  assert.equal(JSON.parse(await fs.readFile(aliasWinner.backupPath, "utf8")).documents[0].document_id, "initial")
  const physicalBackups = (await fs.readdir(path.dirname(directPath))).filter((name) => name.includes("traceability-catalog.json.bak-"))
  assert.equal(physicalBackups.length, 1)
})

test("standalone catalog reads reject a file alias retargeted outside after lexical validation", async (t) => {
  const workspaceRoot = await makeWorkspace()
  const directPath = path.join(workspaceRoot, DEFAULT_TRACEABILITY_CATALOG_PATH)
  const initial = await writeTraceabilityCatalog({ workspaceRoot, catalog: catalogWithDocument("inside") })
  assert.equal(initial.status, "ok")

  const aliasRelativePath = ".custom/read-race-catalog.json"
  const aliasPath = path.join(workspaceRoot, aliasRelativePath)
  if (!await createCatalogFileAlias(t, directPath, aliasPath)) return
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bob-trace-store-outside-read-"))
  const outsidePath = path.join(outsideRoot, "victim.json")
  const outsideBytes = Buffer.from(`${JSON.stringify(catalogWithDocument("outside-victim"), null, 2)}\n`, "utf8")
  await fs.writeFile(outsidePath, outsideBytes)

  const barrier = installPathIoBarrier(aliasPath)
  try {
    const pendingRead = readTraceabilityCatalog({ workspaceRoot, catalogPath: aliasRelativePath })
    await barrier.waitUntilEntered()
    await retargetCatalogFileAlias(aliasPath, outsidePath)
    barrier.release()

    await assert.rejects(pendingRead, /outside workspace|target changed/i)
    assert.deepEqual(await fs.readFile(outsidePath), outsideBytes)
  } finally {
    barrier.release()
    barrier.restore()
  }
})

test("catalog writes reject a file alias retargeted outside after lexical validation", async (t) => {
  const workspaceRoot = await makeWorkspace()
  const directPath = path.join(workspaceRoot, DEFAULT_TRACEABILITY_CATALOG_PATH)
  const initial = await writeTraceabilityCatalog({ workspaceRoot, catalog: catalogWithDocument("inside") })
  assert.equal(initial.status, "ok")

  const aliasRelativePath = ".custom/write-race-catalog.json"
  const aliasPath = path.join(workspaceRoot, aliasRelativePath)
  if (!await createCatalogFileAlias(t, directPath, aliasPath)) return
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bob-trace-store-outside-write-"))
  const outsidePath = path.join(outsideRoot, "victim.json")
  const outsideBytes = Buffer.from(`${JSON.stringify(catalogWithDocument("outside-victim"), null, 2)}\n`, "utf8")
  await fs.writeFile(outsidePath, outsideBytes)

  const barrier = installPathIoBarrier(aliasPath)
  try {
    const pendingWrite = writeTraceabilityCatalog({
      workspaceRoot,
      catalogPath: aliasRelativePath,
      catalog: catalogWithDocument("must-not-escape"),
      expectedRevision: initial.revision
    })
    await barrier.waitUntilEntered()
    await retargetCatalogFileAlias(aliasPath, outsidePath)
    barrier.release()

    await assert.rejects(pendingWrite, /outside workspace|target changed/i)
    assert.deepEqual(await fs.readFile(outsidePath), outsideBytes)
  } finally {
    barrier.release()
    barrier.restore()
  }
})

test("catalog reads reject aliases that already resolve outside the physical workspace", async (t) => {
  const workspaceRoot = await makeWorkspace()
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bob-trace-store-outside-alias-"))
  const outsidePath = path.join(outsideRoot, "catalog.json")
  await fs.writeFile(outsidePath, `${JSON.stringify(catalogWithDocument("outside"), null, 2)}\n`, "utf8")
  const aliasRelativePath = ".custom/outside-catalog.json"
  const aliasPath = path.join(workspaceRoot, aliasRelativePath)
  if (!await createCatalogFileAlias(t, outsidePath, aliasPath)) return

  await assert.rejects(
    readTraceabilityCatalog({ workspaceRoot, catalogPath: aliasRelativePath }),
    /resolves outside workspace/i
  )
})

test("catalog reads and writes reject dangling file aliases", async (t) => {
  const workspaceRoot = await makeWorkspace()
  const aliasRelativePath = ".custom/dangling-catalog.json"
  const aliasPath = path.join(workspaceRoot, aliasRelativePath)
  const missingTarget = path.join(workspaceRoot, ".bob-trace", "missing-catalog.json")
  if (!await createCatalogFileAlias(t, missingTarget, aliasPath)) return

  await assert.rejects(
    readTraceabilityCatalog({ workspaceRoot, catalogPath: aliasRelativePath }),
    /dangling symbolic link/i
  )
  await assert.rejects(
    writeTraceabilityCatalog({
      workspaceRoot,
      catalogPath: aliasRelativePath,
      catalog: catalogWithDocument("must-not-write")
    }),
    /dangling symbolic link/i
  )
})

function catalogWithDocument(documentId) {
  return {
    schema_version: 1,
    documents: [{ document_id: documentId, source_path: `docs/${documentId}.md`, id_source: "extracted" }],
    domains: [],
    items: [],
    links: [],
    decisions: []
  }
}

async function createCatalogDirectoryAlias(t, workspaceRoot) {
  const customRoot = path.join(workspaceRoot, ".custom")
  const aliasDirectory = path.join(customRoot, "catalog-alias")
  await fs.mkdir(customRoot, { recursive: true })
  try {
    await fs.symlink(
      path.join(workspaceRoot, ".bob-trace"),
      aliasDirectory,
      process.platform === "win32" ? "junction" : "dir"
    )
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP", "UNKNOWN"].includes(error.code)) {
      t.skip(`directory alias unavailable: ${error.code}`)
      return undefined
    }
    throw error
  }
  return ".custom/catalog-alias/traceability-catalog.json"
}

async function createCatalogFileAlias(t, targetPath, aliasPath) {
  await fs.mkdir(path.dirname(aliasPath), { recursive: true })
  try {
    await fs.symlink(targetPath, aliasPath, "file")
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP", "UNKNOWN"].includes(error.code)) {
      t.skip(`file symlink unavailable: ${error.code}`)
      return false
    }
    throw error
  }
  return true
}

async function retargetCatalogFileAlias(aliasPath, targetPath) {
  await fs.unlink(aliasPath)
  await fs.symlink(targetPath, aliasPath, "file")
}

function installPathIoBarrier(targetPath) {
  const originalRealpath = fs.realpath
  const originalReadFile = fs.readFile
  let enteredResolve
  let releaseResolve
  let triggered = false
  const entered = new Promise((resolve) => { enteredResolve = resolve })
  const released = new Promise((resolve) => { releaseResolve = resolve })
  const intercept = async (original, args) => {
    const candidate = typeof args[0] === "string" ? normalizePhysicalPath(args[0]) : undefined
    if (!triggered && candidate === normalizePhysicalPath(targetPath)) {
      triggered = true
      enteredResolve()
      await released
    }
    return Reflect.apply(original, fs, args)
  }
  fs.realpath = (...args) => intercept(originalRealpath, args)
  fs.readFile = (...args) => intercept(originalReadFile, args)
  return {
    waitUntilEntered: () => entered,
    release: () => releaseResolve(),
    restore: () => {
      fs.realpath = originalRealpath
      fs.readFile = originalReadFile
    }
  }
}

function installTargetTempOpenBarrier(targetPath) {
  const originalOpen = fs.open
  const expectedDirectory = normalizePhysicalPath(path.dirname(targetPath))
  const tempPrefix = `.${path.basename(targetPath)}.`
  let enteredResolve
  let releaseResolve
  let triggered = false
  const entered = new Promise((resolve) => { enteredResolve = resolve })
  const released = new Promise((resolve) => { releaseResolve = resolve })
  fs.open = async (...args) => {
    const candidate = typeof args[0] === "string" ? args[0] : undefined
    if (
      !triggered &&
      candidate &&
      normalizePhysicalPath(path.dirname(candidate)) === expectedDirectory &&
      path.basename(candidate).startsWith(tempPrefix) &&
      path.basename(candidate).endsWith(".tmp")
    ) {
      triggered = true
      enteredResolve()
      await released
    }
    return Reflect.apply(originalOpen, fs, args)
  }
  return {
    waitUntilEntered: () => entered,
    release: () => releaseResolve(),
    restore: () => { fs.open = originalOpen }
  }
}

function normalizePhysicalPath(value) {
  const resolved = path.resolve(value)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}
