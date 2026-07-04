const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")
const YAML = require("yaml")

const { captureBobOutput } = require("../out/core/bobOutputCapture")
const { preprocessReview } = require("../out/core/pipeline")
const { validateBobOutput } = require("../out/core/bobOutputValidator")
const { createAiVerificationMatrixWorkspace } = require("./helpers/reviewPipelineFixtures")

test("captureBobOutput canonicalizes common real-AI YAML shorthand before validation", async () => {
  const workspace = createAiVerificationMatrixWorkspace()
  const packageDir = path.join(workspace, ".bob-review", "review-package")
  await preprocessReview({ workspaceRoot: workspace, inputPath: path.join(workspace, "review-input.yaml"), outDir: packageDir })

  const bobOutputPath = path.join(workspace, ".bob-review", "bob-output", "bob-output.yaml")
  const capture = await captureBobOutput({
    workspaceRoot: workspace,
    packageDir,
    bobOutputPath,
    text: `schema_version: "1.0"
review_summary:
  review_id: REVIEW-AI-MATRIX-001
  target_range: main..feature/ai-verification-matrix
  final_approval: not_performed
  finding_count: 1
  note: 入力範囲で確認したプレレビュー結果。
findings:
  - id: FIND-001
    category: requirement-code-consistency
    severity: high
    confidence: high
    summary: タイムアウト時に ERR_OK を返している。
    evidence:
      - REQ-0002
      - SRC-0002
    reason: 要求は ERR_TIMEOUT を求めている。
    impact: タイムアウトが正常扱いになる。
    recommended_action: ERR_TIMEOUT を返す。
    human_check: 仕様変更の有無を確認する。
questions:
  - id: Q-001
    summary: チケットの版数確認が必要。
    reason: 承認済みしきい値が不明。
    evidence:
      - TICKET-0001
    human_check: オーナーに確認する。
coverage_notes:
  - 性能測定およびダッシュボード表示文言は対象外。
rejected_or_uncertain:
  - id: REJ-001
    summary: プレミアム顧客上限は整合しているため finding にしない。`
  })

  assert.equal(capture.status, "ok")
  assert.ok(fs.existsSync(capture.rawOutputPath), "raw output should be saved beside the canonical output")
  assert.ok(fs.existsSync(capture.canonicalOutputPath), "canonical output should be saved beside the primary output")
  assert.ok(capture.rawValidation.errors.some((error) => error.includes("schema_version")))
  assert.deepEqual(capture.canonicalValidation.errors, [])
  assert.ok(capture.canonicalizationIssues.some((issue) => issue.code === "raw_validation_error"))
  assert.ok(capture.canonicalizationIssues.some((issue) => issue.code === "defaulted_field" && issue.path === "$.review_summary.result_type"))
  assert.ok(capture.canonicalizationIssues.some((issue) => issue.code === "generated_id" && issue.path === "$.findings[0].id"))

  const report = await validateBobOutput({ packageDir, bobOutputPath })
  assert.deepEqual(report.errors, [])
  assert.ok(report.warnings.some((warning) => warning.includes("raw-output.yaml validation before canonicalization")))
  assert.ok(report.warnings.some((warning) => warning.includes("canonical-output.yaml validation: ok")))

  const rawSaved = YAML.parse(fs.readFileSync(capture.rawOutputPath, "utf8"))
  assert.equal(rawSaved.schema_version, "1.0")
  assert.equal(rawSaved.review_summary.result_type, undefined)
  const saved = YAML.parse(fs.readFileSync(bobOutputPath, "utf8"))
  assert.equal(saved.schema_version, 1)
  assert.equal(saved.review_summary.result_type, "pre_review")
  assert.equal(saved.findings[0].id, "PRE-001")
  assert.deepEqual(saved.findings[0].evidence[0], { evidence_id: "REQ-0002", type: "requirement", ref: "REQ-NG-001" })
  assert.equal(saved.questions[0].category, "document-version")
  assert.equal(saved.questions[0].suggested_action, "オーナーに確認する。")
  assert.equal(saved.coverage_notes[0].id, "COV-001")
  assert.equal(saved.coverage_notes[0].type, "out_of_scope")
  assert.equal(saved.rejected_or_uncertain[0].id, "UNC-001")
})

test("captureBobOutput canonicalizes workflow-state wrapped real-AI output before validation", async () => {
  const workspace = createAiVerificationMatrixWorkspace()
  const packageDir = path.join(workspace, ".bob-review", "review-package")
  await preprocessReview({ workspaceRoot: workspace, inputPath: path.join(workspace, "review-input.yaml"), outDir: packageDir })

  const bobOutputPath = path.join(workspace, ".bob-review", "bob-output", "bob-output.yaml")
  const capture = await captureBobOutput({
    workspaceRoot: workspace,
    packageDir,
    bobOutputPath,
    text: `<workflow_state>
<state>
schema_version: "1.0"
review_summary:
  review_id: REVIEW-AI-MATRIX-001
  title: 決済ステータス変更の整合性検証マトリクス
  target_range: main..feature/ai-verification-matrix
  change_type: feature
  reviewed_at: 2026-06-30
  final_approval: not_performed
  summary: 実AIの自由形式出力を取り込む。
findings:
  - id: FINDING-001
    category: rt-ts-rule
    severity: high
    confidence: high
    summary: Payment_UpdateRealtimeCache 内に printf 呼び出しが追加されている。
    evidence:
      - SRC-0004 (src/payment_status.c:34-39)
      - DD-0004 (DD-RT-040: docs/detailed-design-ai-matrix.md)
      - C/C++変更解析サマリ 注意が必要な候補 (src/payment_status.c:36 RT forbidden processing candidate)
    reason: printf は RT 経路で禁止されるコンソール出力である。
    impact: RT 経路でのブロッキング I/O により応答性が損なわれる。
    recommended_action: printf 呼び出しを除去する。
    human_check: デバッグ用途の一時挿入か確認する。
questions:
  - id: QUESTION-001
    category: test-gap
    summary: Payment_AssessFraudScore に対するテストケースが evidence index に存在しない。
    evidence:
      - SRC-0003 (src/payment_status.c:26-32)
      - TC-0001 (TC-OK-010: docs/test-spec-ai-matrix.md) — 対象外
    reason: 不正スコア審査に対応するテスト証跡が不足している。
    human_check: テスト仕様書全体に該当ケースがあるか確認する。
coverage_notes:
  - 性能測定およびダッシュボード表示文言は REQ-NA-001 により本レビューの対象外である。
rejected_or_uncertain:
  - id: REJECTED-001
    reason: Payment_CalculateLimit の戻り値変更は REQ-OK-001 と DD-OK-001 に一致しているため finding にしない。
</state>
</workflow_state>`
  })

  assert.equal(capture.status, "ok")
  const report = await validateBobOutput({ packageDir, bobOutputPath })
  assert.deepEqual(report.errors, [])

  const raw = fs.readFileSync(bobOutputPath, "utf8")
  assert.doesNotMatch(raw, /<\/workflow_state>|<\/state>/)

  const saved = YAML.parse(raw)
  assert.equal(saved.schema_version, 1)
  assert.equal(saved.review_summary.scope_statement, "実AIの自由形式出力を取り込む。")
  assert.equal(saved.review_summary.generated_at, "2026-06-30")
  assert.equal(saved.findings[0].id, "PRE-001")
  assert.deepEqual(saved.findings[0].evidence[0], { evidence_id: "SRC-0004", type: "code", ref: "src/payment_status.c:34-39" })
  assert.equal(saved.findings[0].evidence.length, 2)
  assert.equal(saved.questions[0].id, "Q-001")
  assert.equal(saved.questions[0].category, "test-policy")
  assert.equal(saved.questions[0].suggested_action, "テスト仕様書全体に該当ケースがあるか確認する。")
  assert.equal(saved.rejected_or_uncertain[0].id, "UNC-001")
  assert.match(saved.rejected_or_uncertain[0].summary, /Payment_CalculateLimit/)
})
