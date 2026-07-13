const assert = require("node:assert/strict")
const { createHash } = require("node:crypto")
const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")
const { createMultiLanguageGitReviewWorkspace } = require("./helpers/reviewPipelineFixtures")

function ledgerApi() {
  return require("../out/evidenceScope/artifactLedger")
}

const HASH_A = `sha256:${"a".repeat(64)}`
const HASH_B = `sha256:${"b".repeat(64)}`
const HASH_C = `sha256:${"c".repeat(64)}`
const REV_A = "1".repeat(40)
const REV_B = "2".repeat(40)

function observation(overrides = {}) {
  return {
    id: "repository-symbol-index:repo",
    kind: "repository-symbol-index",
    producer: "producer-v1",
    path: ".bob/evidence-scope/repository-symbol-index.json",
    content_hash: HASH_A,
    input_hash: HASH_A,
    source_revision: REV_A,
    depends_on: [],
    ...overrides
  }
}

function previousLedger() {
  return {
    schema_version: 1,
    ledger_id: "bob-evidence-scope",
    source_revision: REV_A,
    artifacts: [
      {
        ...observation(),
        status: "fresh",
        stale_reasons: []
      },
      {
        ...observation({
          id: "review-package:REVIEW-001",
          kind: "review-package",
          producer: "bob-code-consistency-review@0.1.0",
          path: ".bob-review/review-package",
          content_hash: HASH_B,
          input_hash: HASH_C,
          source_revision: `${REV_A}..${REV_A}`,
          depends_on: ["repository-symbol-index:repo"]
        }),
        status: "fresh",
        stale_reasons: []
      }
    ]
  }
}

test("changed upstream marks an unobserved review package stale", () => {
  const { reconcileArtifactLedger } = ledgerApi()
  const result = reconcileArtifactLedger(previousLedger(), {
    sourceRevision: REV_A,
    observations: [observation({ content_hash: HASH_C })],
    completeKinds: ["repository-symbol-index"]
  })

  const index = result.artifacts.find((item) => item.id === "repository-symbol-index:repo")
  const packageRecord = result.artifacts.find((item) => item.id === "review-package:REVIEW-001")
  assert.equal(index.status, "fresh")
  assert.equal(packageRecord.status, "stale")
  assert.deepEqual(packageRecord.stale_reasons, ["upstream-changed:repository-symbol-index:repo"])
})

test("a rebuilt dependent observed with current upstream is fresh", () => {
  const { reconcileArtifactLedger } = ledgerApi()
  const result = reconcileArtifactLedger(previousLedger(), {
    sourceRevision: REV_A,
    observations: [
      observation({ content_hash: HASH_C }),
      observation({
        id: "review-package:REVIEW-001",
        kind: "review-package",
        producer: "bob-code-consistency-review@0.1.0",
        path: ".bob-review/review-package",
        content_hash: HASH_C,
        input_hash: HASH_B,
        source_revision: `${REV_A}..${REV_A}`,
        depends_on: ["repository-symbol-index:repo"]
      })
    ],
    completeKinds: ["repository-symbol-index", "review-package"]
  })

  const packageRecord = result.artifacts.find((item) => item.id === "review-package:REVIEW-001")
  assert.equal(packageRecord.status, "fresh")
  assert.deepEqual(packageRecord.stale_reasons, [])
})

test("missing upstream is recorded and propagates to dependents", () => {
  const { reconcileArtifactLedger } = ledgerApi()
  const result = reconcileArtifactLedger(previousLedger(), {
    sourceRevision: REV_A,
    observations: [],
    completeKinds: ["repository-symbol-index"]
  })

  const index = result.artifacts.find((item) => item.id === "repository-symbol-index:repo")
  const packageRecord = result.artifacts.find((item) => item.id === "review-package:REVIEW-001")
  assert.equal(index.status, "missing")
  assert.deepEqual(index.stale_reasons, ["artifact-missing"])
  assert.equal(packageRecord.status, "stale")
  assert.deepEqual(packageRecord.stale_reasons, ["dependency-missing:repository-symbol-index:repo"])
})

test("source revision changes stale unobserved artifacts", () => {
  const { reconcileArtifactLedger } = ledgerApi()
  const result = reconcileArtifactLedger(previousLedger(), {
    sourceRevision: REV_B,
    observations: [],
    completeKinds: []
  })

  for (const record of result.artifacts) {
    assert.notEqual(record.status, "fresh")
    assert.ok(record.stale_reasons.includes("source-revision-changed"))
  }
})

test("ledger ordering and normalization are deterministic and source-free", () => {
  const { reconcileArtifactLedger } = ledgerApi()
  const packageObservation = observation({
    id: "review-package:Z",
    kind: "review-package",
    path: ".bob-review/z",
    content_hash: HASH_B,
    input_hash: HASH_C,
    source_revision: `${REV_A}..${REV_A}`,
    depends_on: ["project-rule-pack:rules", "repository-symbol-index:repo", "project-rule-pack:rules"],
    raw_body: "RAW-LEDGER-SENTINEL"
  })
  const ruleObservation = observation({
    id: "project-rule-pack:rules",
    kind: "project-rule-pack",
    path: ".bob/evidence-scope/rules.yaml",
    content_hash: HASH_C,
    depends_on: []
  })

  const left = reconcileArtifactLedger(undefined, {
    sourceRevision: REV_A,
    observations: [packageObservation, observation(), ruleObservation],
    completeKinds: ["review-package", "repository-symbol-index", "project-rule-pack"]
  })
  const right = reconcileArtifactLedger(undefined, {
    sourceRevision: REV_A,
    observations: [ruleObservation, observation(), packageObservation],
    completeKinds: ["project-rule-pack", "repository-symbol-index", "review-package"]
  })

  assert.deepEqual(left, right)
  assert.deepEqual(left.artifacts.map((item) => item.id), [
    "project-rule-pack:rules",
    "repository-symbol-index:repo",
    "review-package:Z"
  ])
  assert.deepEqual(left.artifacts[2].depends_on, [
    "project-rule-pack:rules",
    "repository-symbol-index:repo"
  ])
  assert.doesNotMatch(JSON.stringify(left), /RAW-LEDGER-SENTINEL/)
})

test("duplicate observations and self dependencies are rejected", () => {
  const { reconcileArtifactLedger } = ledgerApi()
  assert.throws(
    () => reconcileArtifactLedger(undefined, {
      sourceRevision: REV_A,
      observations: [observation(), observation()],
      completeKinds: []
    }),
    /duplicate artifact observation id/
  )
  assert.throws(
    () => reconcileArtifactLedger(undefined, {
      sourceRevision: REV_A,
      observations: [observation({ depends_on: ["repository-symbol-index:repo"] })],
      completeKinds: []
    }),
    /must not depend on itself/
  )
})

test("manifest and ledger share the deterministic review-package input hash", async () => {
  const {
    buildReviewPackage,
    computeReviewPackageInputHash
  } = require("../out/core/reviewPackageBuilder")
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-ledger-input-hash-"))
  const outDir = path.join(workspace, ".bob-review", "review-package")
  const reviewInput = minimalReviewInput()
  const diff = minimalDiff(workspace)
  const contextBudgetArtifact = {
    rule_pack: {
      schema_version: 1,
      id: "rules",
      version: "1",
      source_path: ".bob/evidence-scope/rules.yaml",
      content_hash: HASH_A
    },
    symbol_index: {
      schema_version: 1,
      id: "repo",
      source_revision: REV_A,
      source_path: ".bob/evidence-scope/repository-symbol-index.json",
      content_hash: HASH_B,
      symbol_count: 1,
      edge_count: 0
    }
  }

  await buildReviewPackage({
    workspaceRoot: workspace,
    outDir,
    reviewInput,
    diff,
    documents: { documents: [], excerptsMarkdown: "", evidence: [], warnings: [] },
    codeAnalysis: emptyCodeAnalysis(),
    traceability: { rows: [], warnings: [], markdown: "" },
    contextBudgetArtifact
  })

  const expected = computeReviewPackageInputHash(reviewInput, diff, contextBudgetArtifact)
  const manifest = fs.readFileSync(path.join(outDir, "manifest.yaml"), "utf8")
  const match = manifest.match(/^  input_hash: (sha256:[0-9a-f]{64})$/m)
  assert.ok(match)
  assert.equal(match[1], expected)
})

test("managed package content hashing is canonical and excludes user files", async () => {
  const { computeManagedReviewPackageContentHash } = require("../out/core/reviewPackageBuilder")
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "bob-ledger-content-hash-"))
  fs.mkdirSync(path.join(outDir, "prompts"), { recursive: true })
  fs.writeFileSync(path.join(outDir, "prompts", "b.md"), "bravo", "utf8")
  fs.writeFileSync(path.join(outDir, "prompts", "a.md"), "alpha", "utf8")
  fs.writeFileSync(path.join(outDir, "user-note.md"), "not managed", "utf8")

  const first = await computeManagedReviewPackageContentHash(outDir)
  const expected = canonicalManagedHash([
    ["prompts/a.md", Buffer.from("alpha")],
    ["prompts/b.md", Buffer.from("bravo")]
  ])
  assert.equal(first, expected)

  fs.writeFileSync(path.join(outDir, "user-note.md"), "changed user data", "utf8")
  assert.equal(await computeManagedReviewPackageContentHash(outDir), first)
  fs.writeFileSync(path.join(outDir, "prompts", "a.md"), "changed", "utf8")
  assert.notEqual(await computeManagedReviewPackageContentHash(outDir), first)
})

function minimalReviewInput() {
  return {
    schema_version: 1,
    review: {
      id: "REVIEW-LEDGER-HASH",
      title: "Ledger hashing",
      change_type: "maintenance",
      purpose: "share package hashes",
      base: REV_A,
      head: REV_B,
      vcs: "git"
    },
    artifacts: {},
    review_focus: ["requirement-code-consistency"]
  }
}

function minimalDiff(workspace) {
  return {
    vcs: "git",
    vcsRoot: workspace,
    base: REV_A,
    head: REV_B,
    files: [],
    unifiedDiff: "",
    warnings: []
  }
}

function emptyCodeAnalysis() {
  return {
    changedSymbols: [],
    functions: [],
    defines: [],
    globals: [],
    callGraph: [],
    rtForbiddenCandidates: [],
    codeSlices: [],
    evidence: [],
    summaryMarkdown: "",
    warnings: []
  }
}

function canonicalManagedHash(entries) {
  const hash = createHash("sha256")
  for (const [relativePath, bytes] of entries.sort((left, right) => left[0].localeCompare(right[0]))) {
    hash.update(relativePath)
    hash.update("\0")
    hash.update(String(bytes.length))
    hash.update("\0")
    hash.update(bytes)
    hash.update("\0")
  }
  return `sha256:${hash.digest("hex")}`
}

test("corrupt persisted ledger is ignored and rebuilt with a warning", async () => {
  const { updateArtifactLedger } = ledgerApi()
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-ledger-corrupt-"))
  fs.mkdirSync(path.join(workspace, ".bob-review"), { recursive: true })
  fs.writeFileSync(path.join(workspace, ".bob-review", "artifact-ledger.json"), "{broken", "utf8")

  const result = await updateArtifactLedger({
    workspaceRoot: workspace,
    sourceRevision: REV_A,
    observations: [observation()],
    completeKinds: ["repository-symbol-index"],
    maxBytes: 1024 * 1024
  })

  assert.equal(result.fresh, 1)
  assert.equal(result.stale, 0)
  assert.ok(result.warnings.some((warning) => warning.includes("artifact ledger ignored")))
  const persisted = JSON.parse(fs.readFileSync(path.join(workspace, ".bob-review", "artifact-ledger.json"), "utf8"))
  assert.deepEqual(persisted, result.ledger)
})

test("preprocess build mode records repository index and review package lineage", async () => {
  const { preprocessReview } = require("../out/core/pipeline")
  const workspace = createMultiLanguageGitReviewWorkspace()
  const inputPath = path.join(workspace, "review-input.yaml")
  const original = fs.readFileSync(inputPath, "utf8")
  const newline = original.includes("\r\n") ? "\r\n" : "\n"
  const configured = original.replace(
    /analysis_options:\r?\n/,
    `analysis_options:${newline}  repository_symbol_index_mode: build${newline}  repository_symbol_index_path: .bob/evidence-scope/repository-symbol-index.json${newline}  repository_symbol_index_cache_path: .bob/evidence-scope/repository-symbol-index.cache.json${newline}`
  )
  assert.notEqual(configured, original)
  fs.writeFileSync(inputPath, configured, "utf8")

  const result = await preprocessReview({
    workspaceRoot: workspace,
    inputPath,
    outDir: ".bob-review/review-package"
  })

  assert.ok(result.artifactLedger)
  assert.equal(result.artifactLedger.path, ".bob-review/artifact-ledger.json")
  assert.equal(result.artifactLedger.stale, 0)
  assert.equal(result.artifactLedger.missing, 0)
  const ledger = JSON.parse(fs.readFileSync(path.join(workspace, ".bob-review", "artifact-ledger.json"), "utf8"))
  const indexRecord = ledger.artifacts.find((item) => item.kind === "repository-symbol-index")
  const packageRecord = ledger.artifacts.find((item) => item.kind === "review-package")
  assert.equal(indexRecord.status, "fresh")
  assert.equal(packageRecord.status, "fresh")
  assert.deepEqual(packageRecord.depends_on, [indexRecord.id])
  assert.match(packageRecord.content_hash, /^sha256:[0-9a-f]{64}$/)
  assert.match(packageRecord.input_hash, /^sha256:[0-9a-f]{64}$/)
  assert.doesNotMatch(JSON.stringify(ledger), /RAW-PRODUCER-SENTINEL|Raw unified diff/)
})

test("upstream checkpoint persists a stale prior package when package rebuild fails", async () => {
  const { preprocessReview } = require("../out/core/pipeline")
  const workspace = createMultiLanguageGitReviewWorkspace()
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf8" }).trim()
  const inputPath = path.join(workspace, "review-input.yaml")
  const original = fs.readFileSync(inputPath, "utf8")
  const newline = original.includes("\r\n") ? "\r\n" : "\n"
  const configured = original.replace(
    /analysis_options:\r?\n/,
    `analysis_options:${newline}  repository_symbol_index_path: .bob/evidence-scope/repository-symbol-index.json${newline}`
  )
  fs.writeFileSync(inputPath, configured, "utf8")
  fs.mkdirSync(path.join(workspace, ".bob", "evidence-scope"), { recursive: true })
  writeExternalIndex(workspace, head, "one")

  await preprocessReview({
    workspaceRoot: workspace,
    inputPath,
    outDir: ".bob-review/review-package"
  })
  let ledger = JSON.parse(fs.readFileSync(path.join(workspace, ".bob-review", "artifact-ledger.json"), "utf8"))
  assert.equal(ledger.artifacts.find((item) => item.kind === "review-package").status, "fresh")

  writeExternalIndex(workspace, head, "two")
  fs.mkdirSync(path.join(workspace, ".custom"), { recursive: true })
  fs.writeFileSync(path.join(workspace, ".custom", "review-package"), "blocks directory creation", "utf8")
  await assert.rejects(
    preprocessReview({
      workspaceRoot: workspace,
      inputPath,
      outDir: ".custom/review-package"
    }),
    /EEXIST|not a directory|ENOTDIR/
  )

  ledger = JSON.parse(fs.readFileSync(path.join(workspace, ".bob-review", "artifact-ledger.json"), "utf8"))
  const packageRecord = ledger.artifacts.find((item) => item.kind === "review-package")
  assert.equal(packageRecord.status, "stale")
  assert.ok(packageRecord.stale_reasons.includes("upstream-changed:repository-symbol-index:external-repo"))
})

function writeExternalIndex(workspace, sourceRevision, generator) {
  fs.writeFileSync(
    path.join(workspace, ".bob", "evidence-scope", "repository-symbol-index.json"),
    `${JSON.stringify({
      schema_version: 1,
      index: { id: "external-repo", source_revision: sourceRevision, generator },
      symbols: [],
      edges: []
    }, null, 2)}\n`,
    "utf8"
  )
}
