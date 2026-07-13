const assert = require("node:assert/strict")
const { execFileSync } = require("node:child_process")
const { createHash } = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { preprocessReview } = require("../out/core/pipeline")
const { buildReviewEvidenceScope } = require("../out/evidenceScope/reviewEvidenceAdapter")
const { createMultiLanguageGitReviewWorkspace } = require("./helpers/reviewPipelineFixtures")

function repositoryIndexApi() {
  return require("../out/evidenceScope/repositorySymbolIndexLoader")
}

function repositoryIndexAdapterApi() {
  return require("../out/evidenceScope/repositorySymbolIndexAdapter")
}

test("repository symbol index loader reads bounded workspace-local bytes without modifying the source", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-symbol-index-load-"))
  const relativePath = ".bob/evidence-scope/repository-symbol-index.json"
  const filePath = path.join(workspace, relativePath)
  const revision = "a".repeat(40)
  const source = repositoryIndexJson({ sourceRevision: revision })
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, source, "utf8")
  const before = fs.readFileSync(filePath)

  const { loadRepositorySymbolIndex } = repositoryIndexApi()
  const loaded = await loadRepositorySymbolIndex({
    workspaceRoot: workspace,
    indexPath: relativePath,
    expectedSourceRevision: revision,
    maxBytes: 4096,
    textEncoding: "utf8"
  })

  assert.ok(loaded)
  assert.equal(loaded.id, "payment-repository")
  assert.equal(loaded.sourceRevision, revision)
  assert.equal(loaded.sourcePath, relativePath)
  assert.equal(loaded.contentHash, `sha256:${createHash("sha256").update(before).digest("hex")}`)
  assert.equal(loaded.symbolCount, 2)
  assert.equal(loaded.edgeCount, 1)
  assert.deepEqual(loaded.symbols.find((item) => item.id === "test:api").riskTags, ["test-impact"])
  assert.deepEqual(fs.readFileSync(filePath), before)
})

test("repository symbol index loader rejects workspace escape and stale revisions", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-symbol-index-boundary-"))
  const { loadRepositorySymbolIndex } = repositoryIndexApi()

  await assert.rejects(
    loadRepositorySymbolIndex({
      workspaceRoot: workspace,
      indexPath: "../outside.json",
      expectedSourceRevision: "a".repeat(40),
      maxBytes: 4096
    }),
    /must be workspace-relative|escapes workspace/
  )

  const relativePath = ".bob/evidence-scope/stale.json"
  writeIndex(workspace, relativePath, repositoryIndexJson({ sourceRevision: "a".repeat(40) }))
  await assert.rejects(
    loadRepositorySymbolIndex({
      workspaceRoot: workspace,
      indexPath: relativePath,
      expectedSourceRevision: "b".repeat(40),
      maxBytes: 4096
    }),
    /source revision mismatch/
  )
})

test("repository symbol index loader rejects duplicate and dangling graph records", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-symbol-index-invalid-"))
  const relativePath = ".bob/evidence-scope/invalid.json"
  const revision = "c".repeat(40)
  const { loadRepositorySymbolIndex } = repositoryIndexApi()

  writeIndex(workspace, relativePath, repositoryIndexJson({
    sourceRevision: revision,
    symbols: [baseSymbol("fn:api"), baseSymbol("fn:api")]
  }))
  await assert.rejects(
    loadRepositorySymbolIndex({ workspaceRoot: workspace, indexPath: relativePath, expectedSourceRevision: revision, maxBytes: 4096 }),
    /duplicate repository symbol id: fn:api/
  )

  writeIndex(workspace, relativePath, repositoryIndexJson({
    sourceRevision: revision,
    symbols: [baseSymbol("fn:api")],
    edges: [{ from: "fn:api", to: "fn:missing", kind: "calls", resolution: "resolved", reason: "dangling call" }]
  }))
  await assert.rejects(
    loadRepositorySymbolIndex({ workspaceRoot: workspace, indexPath: relativePath, expectedSourceRevision: revision, maxBytes: 4096 }),
    /resolved edge target not found: fn:missing/
  )

  const duplicateEdge = { from: "fn:api", to: "fn:helper", kind: "calls", resolution: "resolved", reason: "direct call" }
  writeIndex(workspace, relativePath, repositoryIndexJson({
    sourceRevision: revision,
    symbols: [baseSymbol("fn:api"), baseSymbol("fn:helper")],
    edges: [duplicateEdge, duplicateEdge]
  }))
  await assert.rejects(
    loadRepositorySymbolIndex({ workspaceRoot: workspace, indexPath: relativePath, expectedSourceRevision: revision, maxBytes: 4096 }),
    /duplicate repository dependency edge/
  )
})

test("repository index merge expands external caller callee type global and test impact deterministically", () => {
  const analysis = analysisFixture()
  const repositoryIndex = externalImpactIndex("d".repeat(40))
  const { mergeRepositoryScopeData } = repositoryIndexAdapterApi()
  const analysisSymbols = [{ id: "fn:api", name: "api", path: "src/api-current.ts", kind: "function", language: "typescript", estimatedTokens: 12, riskTags: [] }]
  const merged = mergeRepositoryScopeData(analysisSymbols, [], repositoryIndex)

  assert.equal(merged.symbols.filter((item) => item.id === "fn:api").length, 1)
  assert.equal(merged.symbols.find((item) => item.id === "fn:api").path, "src/api-current.ts")

  const options = {
    changedSymbolIds: ["fn:api"],
    tokenBudget: 5000,
    maxDependencyDepth: 1,
    rules: [],
    repositoryIndex
  }
  const first = buildReviewEvidenceScope(analysis, undefined, options)
  const second = buildReviewEvidenceScope(analysis, undefined, {
    ...options,
    repositoryIndex: {
      ...repositoryIndex,
      symbols: [...repositoryIndex.symbols].reverse(),
      dependencyEdges: [...repositoryIndex.dependencyEdges].reverse()
    }
  })

  assert.deepEqual(first.selectedCode.map((item) => [item.id, item.priority]), [
    ["fn:api", "required"],
    ["fn:external-callee", "high"],
    ["fn:external-caller", "high"],
    ["global:config", "high"],
    ["test:api", "high"],
    ["type:request", "high"]
  ])
  assert.deepEqual(second.selectedCode, first.selectedCode)
  assert.equal(second.scopeFingerprint, first.scopeFingerprint)
})

test("repository index maps unstable analysis ids to the unique stable symbol identity", () => {
  const analysis = analysisFixture()
  analysis.changedSymbols[0].id = "FUNC-0001"

  const repositoryIndex = {
    id: "stable-index",
    sourceRevision: "f".repeat(40),
    sourcePath: ".bob/evidence-scope/repository-symbol-index.json",
    contentHash: `sha256:${"2".repeat(64)}`,
    symbolCount: 2,
    edgeCount: 1,
    symbols: [
      { id: "stable:api", name: "api", path: "src/api-current.ts", kind: "function", language: "typescript", estimatedTokens: 10, riskTags: [] },
      { id: "fn:caller", name: "caller", path: "src/caller.ts", kind: "function", language: "typescript", estimatedTokens: 10, riskTags: [] }
    ],
    dependencyEdges: [
      { from: "fn:caller", to: "stable:api", kind: "calls", resolution: "resolved", reason: "external caller" }
    ]
  }

  const result = buildReviewEvidenceScope(analysis, undefined, {
    tokenBudget: 1000,
    maxDependencyDepth: 1,
    rules: [],
    repositoryIndex
  })

  assert.deepEqual(result.selectedCode.map((item) => [item.id, item.priority]), [
    ["stable:api", "required"],
    ["fn:caller", "high"]
  ])
  assert.equal(result.warnings.length, 0)
})

test("current analysis call edges resolve against repository symbols and replace index duplicates", () => {
  const analysis = analysisFixture()
  analysis.callGraph.push({
    from: "api",
    to: "externalCallee",
    confidence: "high",
    reason: "current analysis resolved external callee"
  })
  const repositoryIndex = externalImpactIndex("e".repeat(40))

  const result = buildReviewEvidenceScope(analysis, undefined, {
    changedSymbolIds: ["fn:api"],
    tokenBudget: 5000,
    maxDependencyDepth: 1,
    rules: [],
    repositoryIndex
  })

  const externalCallee = result.selectedCode.find((item) => item.id === "fn:external-callee")
  assert.ok(externalCallee)
  assert.ok(externalCallee.reasons.some((reason) => reason.includes("current analysis resolved external callee")))
  assert.ok(externalCallee.reasons.every((reason) => !reason.includes("api invokes external callee")))
})

test("preprocessReview records repository index provenance and changes stale input hash when only index bytes change", async () => {
  const workspace = createMultiLanguageGitReviewWorkspace()
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf8" }).trim()
  const relativePath = ".bob/evidence-scope/repository-symbol-index.json"
  const filePath = path.join(workspace, relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, pipelineIndexJson(head, "RAW-INDEX-SENTINEL-A"), "utf8")

  const inputPath = path.join(workspace, "review-input.yaml")
  const originalInput = fs.readFileSync(inputPath, "utf8")
  const eol = originalInput.includes("\r\n") ? "\r\n" : "\n"
  assert.match(originalInput, /analysis_options:\r?\n/)
  fs.writeFileSync(
    inputPath,
    originalInput.replace(
      /analysis_options:\r?\n/,
      `analysis_options:${eol}  repository_symbol_index_path: ${relativePath}${eol}`
    ),
    "utf8"
  )

  const outDir = path.join(workspace, ".bob-review", "review-package")
  await preprocessReview({ workspaceRoot: workspace, inputPath, outDir: ".bob-review/review-package" })

  const firstReport = JSON.parse(fs.readFileSync(path.join(outDir, "context-budget-report.json"), "utf8"))
  const firstManifest = fs.readFileSync(path.join(outDir, "manifest.yaml"), "utf8")
  const firstInputHash = manifestInputHash(firstManifest)

  assert.deepEqual(firstReport.symbol_index, {
    schema_version: 1,
    id: "multi-language-repository",
    source_revision: head,
    source_path: relativePath,
    content_hash: firstReport.symbol_index.content_hash,
    symbol_count: 2,
    edge_count: 1
  })
  assert.match(firstReport.symbol_index.content_hash, /^sha256:[0-9a-f]{64}$/)
  assert.ok(firstReport.selected_code.some((item) => item.id === "test:payment-review"))
  assert.match(firstManifest, /repository_symbol_index: \.bob\/evidence-scope\/repository-symbol-index\.json/)
  assert.match(firstManifest, /repository_symbol_index_id: multi-language-repository/)
  assert.match(firstManifest, new RegExp(`repository_symbol_index_revision: ${head}`))
  assert.match(firstManifest, /repository_symbol_index_hash: sha256:[0-9a-f]{64}/)
  assert.match(firstManifest, /repository_symbol_count: 2/)
  assert.match(firstManifest, /repository_edge_count: 1/)
  assert.doesNotMatch(JSON.stringify(firstReport), /RAW-INDEX-SENTINEL-A/)

  fs.writeFileSync(filePath, pipelineIndexJson(head, "RAW-INDEX-SENTINEL-B"), "utf8")
  await preprocessReview({ workspaceRoot: workspace, inputPath, outDir: ".bob-review/review-package" })

  const secondReport = JSON.parse(fs.readFileSync(path.join(outDir, "context-budget-report.json"), "utf8"))
  const secondManifest = fs.readFileSync(path.join(outDir, "manifest.yaml"), "utf8")
  assert.notEqual(secondReport.symbol_index.content_hash, firstReport.symbol_index.content_hash)
  assert.notEqual(manifestInputHash(secondManifest), firstInputHash)
  assert.doesNotMatch(JSON.stringify(secondReport), /RAW-INDEX-SENTINEL-B/)
})

test("repository symbol index is part of the explicit evidence-scope public surface", () => {
  const api = require("../out/evidenceScope")
  assert.equal(typeof api.loadRepositorySymbolIndex, "function")
  assert.equal(typeof api.mergeRepositoryScopeData, "function")
})

function analysisFixture() {
  return {
    changedSymbols: [
      { id: "fn:api", name: "api", kind: "function", file: "src/api-current.ts", confidence: "high", change_type: "modified", evidence_id: "CODE-1" }
    ],
    functions: [],
    defines: [],
    globals: [],
    callGraph: [],
    rtForbiddenCandidates: [],
    codeSlices: [
      { evidence_id: "CODE-1", file: "src/api-current.ts", ref: "src/api-current.ts#L1", functionName: "api", markdown: "", text: "export function api() {}" }
    ],
    evidence: [],
    summaryMarkdown: "",
    warnings: []
  }
}

function externalImpactIndex(sourceRevision) {
  return {
    id: "impact-index",
    sourceRevision,
    sourcePath: ".bob/evidence-scope/repository-symbol-index.json",
    contentHash: `sha256:${"1".repeat(64)}`,
    symbolCount: 6,
    edgeCount: 5,
    symbols: [
      { id: "fn:api", name: "stale-api", path: "src/api-stale.ts", kind: "function", language: "typescript", estimatedTokens: 99, riskTags: [] },
      { id: "fn:external-caller", name: "externalCaller", path: "src/caller.ts", kind: "function", language: "typescript", estimatedTokens: 10, riskTags: [] },
      { id: "fn:external-callee", name: "externalCallee", path: "src/callee.ts", kind: "function", language: "typescript", estimatedTokens: 10, riskTags: [] },
      { id: "type:request", name: "Request", path: "src/model.ts", kind: "type", language: "typescript", estimatedTokens: 10, riskTags: [] },
      { id: "global:config", name: "config", path: "src/config.ts", kind: "global", language: "typescript", estimatedTokens: 10, riskTags: [] },
      { id: "test:api", name: "api test", path: "test/api.test.ts", kind: "test", language: "typescript", estimatedTokens: 10, riskTags: ["test-impact"] }
    ],
    dependencyEdges: [
      { from: "fn:external-caller", to: "fn:api", kind: "calls", resolution: "resolved", reason: "external caller invokes api" },
      { from: "fn:api", to: "fn:external-callee", kind: "calls", resolution: "resolved", reason: "api invokes external callee" },
      { from: "fn:api", to: "type:request", kind: "uses-type", resolution: "resolved", reason: "api accepts Request" },
      { from: "fn:api", to: "global:config", kind: "reads", resolution: "resolved", reason: "api reads config" },
      { from: "test:api", to: "fn:api", kind: "tests", resolution: "resolved", reason: "test covers api" }
    ]
  }
}

function repositoryIndexJson({ sourceRevision, symbols, edges, generator = "fixture-generator/1" }) {
  return `${JSON.stringify({
    schema_version: 1,
    index: { id: "payment-repository", source_revision: sourceRevision, generator },
    symbols: symbols ?? [
      baseSymbol("fn:api"),
      { ...baseSymbol("test:api"), name: "api test", path: "test/api.test.ts", kind: "test", is_test: true }
    ],
    edges: edges ?? [
      { from: "test:api", to: "fn:api", kind: "tests", resolution: "resolved", reason: "test covers api" }
    ]
  }, null, 2)}\n`
}

function pipelineIndexJson(sourceRevision, generator) {
  return `${JSON.stringify({
    schema_version: 1,
    index: { id: "multi-language-repository", source_revision: sourceRevision, generator },
    symbols: [
      { id: "CODE-0001", name: "current generic change", path: "src/payment review.ts", kind: "unknown", language: "typescript", estimated_tokens: 15 },
      { id: "test:payment-review", name: "payment review test", path: "test/payment-review.test.ts", kind: "test", language: "typescript", estimated_tokens: 12, is_test: true }
    ],
    edges: [
      { from: "test:payment-review", to: "CODE-0001", kind: "tests", resolution: "resolved", reason: "repository test covers changed TypeScript file" }
    ]
  }, null, 2)}\n`
}

function baseSymbol(id) {
  return {
    id,
    name: id,
    path: `src/${id.replace(/[:]/g, "-")}.ts`,
    kind: "function",
    language: "typescript",
    estimated_tokens: 10
  }
}

function writeIndex(workspace, relativePath, text) {
  const filePath = path.join(workspace, relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, text, "utf8")
}

function manifestInputHash(manifest) {
  const match = manifest.match(/^\s*input_hash:\s*(sha256:[0-9a-f]{64})\s*$/m)
  assert.ok(match, "manifest input_hash should exist")
  return match[1]
}
