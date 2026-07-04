const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { preprocessReview } = require("../out/core/pipeline")
const {
  createAiVerificationMatrixWorkspace,
  createShiftJisMixedWorkspace,
  diffFixturePath,
  repoRoot,
  reviewInputPath,
  sampleRoot
} = require("./helpers/reviewPipelineFixtures")

const aiMatrixRoot = path.join(sampleRoot, "examples", "ai-verification-matrix")

test("preprocessReview builds a review package with document and code evidence", async () => {
  const outRoot = path.join(repoRoot, ".bob-review")
  fs.mkdirSync(outRoot, { recursive: true })
  const outDir = fs.mkdtempSync(path.join(outRoot, "review-package-"))
  const result = await preprocessReview({ workspaceRoot: repoRoot, inputPath: reviewInputPath, outDir, diffFixturePath })

  for (const file of [
    "manifest.yaml",
    "input-normalized.json",
    "changed-files.json",
    "changed-symbols.json",
    "change-summary.md",
    "diff-context.md",
    "document-index.json",
    "document-excerpts.md",
    "traceability-map.md",
    "deterministic-checks.md",
    "evidence-index.json",
    "bob-input.md"
  ]) {
    assert.ok(fs.existsSync(path.join(outDir, file)), `${file} should exist`)
  }

  const changedSymbols = JSON.parse(fs.readFileSync(path.join(outDir, "changed-symbols.json"), "utf8"))
  const evidenceIndex = JSON.parse(fs.readFileSync(path.join(outDir, "evidence-index.json"), "utf8"))
  const bobInput = fs.readFileSync(path.join(outDir, "bob-input.md"), "utf8")

  assert.equal(result.status, "ok")
  assert.match(JSON.stringify(changedSymbols), /Foo_HandleTimeout/)
  assert.match(JSON.stringify(changedSymbols), /ERR_TIMEOUT|ERR_OK/)
  assert.ok(evidenceIndex.evidence.some((item) => item.evidence_id.startsWith("REQ-")))
  assert.ok(evidenceIndex.evidence.some((item) => item.evidence_id.startsWith("SRC-")))
  assert.doesNotMatch(bobInput, /TODO: Extract document text here|MVP scaffold: not executed yet/)
})

test("preprocessReview builds the AI verification matrix package from a real git diff", async () => {
  const workspace = createAiVerificationMatrixWorkspace()
  const outDir = path.join(workspace, ".bob-review", "review-package")
  const result = await preprocessReview({ workspaceRoot: workspace, inputPath: path.join(workspace, "review-input.yaml"), outDir })

  const changedFiles = JSON.parse(fs.readFileSync(path.join(outDir, "changed-files.json"), "utf8"))
  const changedSymbols = JSON.parse(fs.readFileSync(path.join(outDir, "changed-symbols.json"), "utf8"))
  const evidenceIndex = JSON.parse(fs.readFileSync(path.join(outDir, "evidence-index.json"), "utf8"))
  const bobInput = fs.readFileSync(path.join(outDir, "bob-input.md"), "utf8")
  const expectedOutcomes = fs.readFileSync(path.join(aiMatrixRoot, "expected-outcomes.yaml"), "utf8")

  assert.equal(result.status, "ok")
  assert.ok(changedFiles.files.some((file) => file.path === "src/payment_status.c"))
  assert.match(JSON.stringify(changedSymbols), /Payment_CalculateLimit/)
  assert.match(JSON.stringify(changedSymbols), /Payment_HandleTimeout/)
  assert.match(JSON.stringify(changedSymbols), /Payment_AssessFraudScore/)
  assert.match(JSON.stringify(changedSymbols), /Payment_UpdateRealtimeCache/)
  assert.match(JSON.stringify(changedSymbols), /printf/)
  assert.ok(evidenceIndex.evidence.some((item) => item.evidence_id === "REQ-0001" && item.ref === "REQ-OK-001"))
  assert.ok(evidenceIndex.evidence.some((item) => item.evidence_id === "SRC-0004" && item.location.includes("Payment_UpdateRealtimeCache")))
  assert.match(bobInput, /REQ-OK-001/)
  assert.match(bobInput, /REQ-NG-001/)
  assert.match(bobInput, /REQ-FRAUD-030/)
  assert.match(bobInput, /プレミアム顧客の上限/)
  assert.match(bobInput, /タイムアウト/)
  assert.match(bobInput, /不正スコア/)
  assert.match(bobInput, /性能測定およびダッシュボード表示文言/)
  assert.match(bobInput, /schema_version: 1/)
  assert.match(bobInput, /result_type: pre_review/)
  assert.match(bobInput, /id: PRE-001/)
  assert.match(bobInput, /evidence_id: REQ-0001/)
  assert.match(bobInput, /id: COV-001/)
  assert.match(bobInput, /id: UNC-001/)
  assert.doesNotMatch(bobInput, /schema_version: "1\.0"/)
  assert.doesNotMatch(bobInput, /id: FIND-001/)
  assert.match(expectedOutcomes, /outcome: ok/)
  assert.match(expectedOutcomes, /outcome: ng/)
  assert.match(expectedOutcomes, /outcome: n\/a/)
  assert.match(expectedOutcomes, /outcome: question/)
})

test("preprocessReview preserves Shift-JIS review input, documents, source, and git diff text", async () => {
  const workspace = createShiftJisMixedWorkspace()
  const outDir = path.join(workspace, ".bob-review", "review-package")
  const result = await preprocessReview({ workspaceRoot: workspace, inputPath: path.join(workspace, "review-input.yaml"), outDir })

  const documentExcerpts = fs.readFileSync(path.join(outDir, "document-excerpts.md"), "utf8")
  const diffContext = fs.readFileSync(path.join(outDir, "diff-context.md"), "utf8")
  const bobInput = fs.readFileSync(path.join(outDir, "bob-input.md"), "utf8")
  const changedSymbols = JSON.parse(fs.readFileSync(path.join(outDir, "changed-symbols.json"), "utf8"))
  const inputNormalized = JSON.parse(fs.readFileSync(path.join(outDir, "input-normalized.json"), "utf8"))

  assert.equal(result.status, "ok")
  assert.equal(inputNormalized.review.title, "Shift-JIS 混在検証")
  assert.match(documentExcerpts, /REQ-SJIS-001/)
  assert.match(documentExcerpts, /監査ログの日本語メッセージ/)
  assert.match(diffContext, /状態更新: 文字コード確認/)
  assert.match(diffContext, /printf/)
  assert.match(bobInput, /Shift-JIS 混在検証/)
  assert.match(bobInput, /監査ログの日本語メッセージ/)
  assert.match(bobInput, /状態更新: 文字コード確認/)
  assert.doesNotMatch(`${documentExcerpts}\n${diffContext}\n${bobInput}`, /\uFFFD/)
  assert.ok(changedSymbols.defines.includes("STATUS_AUDIT"))
  assert.ok(changedSymbols.rt_forbidden_candidates.some((candidate) => candidate.symbol === "printf"))
  assert.ok(changedSymbols.symbols.some((symbol) => symbol.name === "Payment_CheckStatus"))
})
