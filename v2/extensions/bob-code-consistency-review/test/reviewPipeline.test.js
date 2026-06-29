const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")
const iconv = require("iconv-lite")
const YAML = require("yaml")

const { preprocessReview } = require("../out/core/pipeline")
const { validateBobOutput } = require("../out/core/bobOutputValidator")
const { captureBobOutput } = require("../out/core/bobOutputCapture")
const { generateHumanTriage } = require("../out/triage/humanTriageHelper")

const extensionRoot = path.resolve(__dirname, "..")
const repoRoot = path.resolve(extensionRoot, "..", "..")
const sampleRoot = path.join(repoRoot, "docs", "workflows", "code-consistency-review")
const reviewInputPath = path.join(sampleRoot, "examples", "simple-timeout-bugfix", "review-input.yaml")
const diffFixturePath = path.join(sampleRoot, "scaffold", "tests", "fixtures", "diff-summary.valid.json")
const bobOutputFixturePath = path.join(sampleRoot, "scaffold", "tests", "fixtures", "bob-output.valid.yaml")
const aiMatrixRoot = path.join(sampleRoot, "examples", "ai-verification-matrix")
const aiMatrixExpectedOutputPath = path.join(aiMatrixRoot, "bob-output.expected.sample.yaml")

test("preprocessReview builds a review package with document and code evidence", async () => {
  const outDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bob-review-package-")), "review-package")
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

test("AI verification matrix expected Bob output validates and generates triage", async () => {
  const workspace = createAiVerificationMatrixWorkspace()
  const packageDir = path.join(workspace, ".bob-review", "review-package")
  await preprocessReview({ workspaceRoot: workspace, inputPath: path.join(workspace, "review-input.yaml"), outDir: packageDir })

  const report = await validateBobOutput({ packageDir, bobOutputPath: aiMatrixExpectedOutputPath })
  assert.deepEqual(report.errors, [])

  const triageDir = path.join(workspace, ".bob-review", "human-triage")
  const triage = await generateHumanTriage({ packageDir, bobOutputPath: aiMatrixExpectedOutputPath, outDir: triageDir })
  assert.equal(triage.status, "ok")
  assert.ok(triage.itemCount >= 4)
  assert.match(fs.readFileSync(path.join(triageDir, "accepted-findings.md"), "utf8"), /PRE-001/)
  assert.match(fs.readFileSync(path.join(triageDir, "questions-to-author.md"), "utf8"), /Q-001/)
})

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
  const report = await validateBobOutput({ packageDir, bobOutputPath })
  assert.deepEqual(report.errors, [])

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

test("validateBobOutput rejects missing evidence ids and accepts package evidence", async () => {
  const outDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bob-review-validate-")), "review-package")
  await preprocessReview({ workspaceRoot: repoRoot, inputPath: reviewInputPath, outDir, diffFixturePath })

  const validReport = await validateBobOutput({ packageDir: outDir, bobOutputPath: bobOutputFixturePath })
  assert.deepEqual(validReport.errors, [])

  const invalidPath = path.join(path.dirname(outDir), "invalid-output.yaml")
  const parsed = YAML.parse(fs.readFileSync(bobOutputFixturePath, "utf8"))
  parsed.findings[0].evidence[0].evidence_id = "MISSING-9999"
  fs.writeFileSync(invalidPath, YAML.stringify(parsed))

  const invalidReport = await validateBobOutput({ packageDir: outDir, bobOutputPath: invalidPath })
  assert.ok(invalidReport.errors.some((error) => error.includes("MISSING-9999")))
})

test("captureBobOutput and generateHumanTriage create review artifacts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bob-review-capture-"))
  const outputPath = path.join(root, ".bob-review", "bob-output", "bob-output.yaml")
  const output = YAML.parse(fs.readFileSync(bobOutputFixturePath, "utf8"))
  output.questions.push({
    id: "Q-001",
    category: "specification-clarification",
    summary: "timeout condition needs author confirmation",
    reason: "The fixture question checks question triage output.",
    suggested_action: "Ask the author whether timeout is in scope."
  })
  const capture = await captureBobOutput({
    workspaceRoot: root,
    text: `Here is the result.\n\n\`\`\`yaml\n${YAML.stringify(output)}\n\`\`\`\n`,
    bobOutputPath: outputPath
  })
  assert.equal(capture.status, "ok")
  assert.ok(fs.existsSync(outputPath))

  const triageDir = path.join(root, ".bob-review", "human-triage")
  await generateHumanTriage({ packageDir: path.join(root, ".bob-review", "review-package"), bobOutputPath: outputPath, outDir: triageDir })

  assert.ok(fs.existsSync(path.join(triageDir, "triage-result.yaml")))
  assert.match(fs.readFileSync(path.join(triageDir, "accepted-findings.md"), "utf8"), /PRE-/)
  assert.match(fs.readFileSync(path.join(triageDir, "questions-to-author.md"), "utf8"), /Q-/)
  assert.ok(fs.existsSync(path.join(triageDir, "rejected-findings.md")))
  assert.ok(fs.existsSync(path.join(triageDir, "follow-up-actions.md")))
})

function createAiVerificationMatrixWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-ai-matrix-"))
  copyFixtureTree(path.join(aiMatrixRoot, "fixtures", "workspace-common"), workspace)
  copyFixtureTree(path.join(aiMatrixRoot, "fixtures", "baseline"), workspace)
  git(workspace, "init", "-b", "main")
  git(workspace, "config", "user.email", "bob-fixture@example.local")
  git(workspace, "config", "user.name", "Bob Fixture")
  git(workspace, "add", ".")
  git(workspace, "commit", "-m", "baseline")
  git(workspace, "switch", "-c", "feature/ai-verification-matrix")
  copyFixtureTree(path.join(aiMatrixRoot, "fixtures", "head"), workspace)
  git(workspace, "add", ".")
  git(workspace, "commit", "-m", "ai verification matrix head")
  return workspace
}

function createShiftJisMixedWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-sjis-mixed-"))
  fs.mkdirSync(path.join(workspace, "docs"), { recursive: true })
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true })
  writeShiftJis(path.join(workspace, "review-input.yaml"), [
    "schema_version: 1",
    "review:",
    "  id: REVIEW-SJIS-001",
    "  title: Shift-JIS 混在検証",
    "  change_type: bugfix",
    "  purpose: 日本語コメントと仕様文書の文字化け確認",
    "  base: main",
    "  head: feature/sjis-mixed",
    "  vcs: git",
    "artifacts:",
    "  requirements:",
    "    - path: docs/requirements-sjis.md",
    "      version: \"1.0\"",
    "      sections:",
    "        - REQ-SJIS-001",
    "review_focus:",
    "  - requirement-code-consistency",
    "  - rt-ts-rule",
    ""
  ].join("\n"))
  writeShiftJis(path.join(workspace, "docs", "requirements-sjis.md"), [
    "# REQ-SJIS-001 状態更新",
    "",
    "REQ-SJIS-001: タイムアウト時は ERR_TIMEOUT を返し、監査ログの日本語メッセージを維持する。",
    ""
  ].join("\n"))
  writeShiftJis(path.join(workspace, "src", "payment_status.h"), [
    "#define ERR_OK 0",
    "#define ERR_TIMEOUT 8",
    "int Payment_CheckStatus(int timeoutDetected);",
    ""
  ].join("\n"))
  writeShiftJis(path.join(workspace, "src", "payment_status.c"), [
    "#include \"payment_status.h\"",
    "#define STATUS_NORMAL 0",
    "",
    "int Payment_CheckStatus(int timeoutDetected)",
    "{",
    "    // 初期値",
    "    if (timeoutDetected) {",
    "        return ERR_TIMEOUT;",
    "    }",
    "    return ERR_OK;",
    "}",
    ""
  ].join("\n"))

  git(workspace, "init", "-b", "main")
  git(workspace, "config", "user.email", "bob-fixture@example.local")
  git(workspace, "config", "user.name", "Bob Fixture")
  git(workspace, "add", ".")
  git(workspace, "commit", "-m", "baseline")
  git(workspace, "switch", "-c", "feature/sjis-mixed")
  writeShiftJis(path.join(workspace, "src", "payment_status.c"), [
    "#include \"payment_status.h\"",
    "#include <stdio.h>",
    "#define STATUS_NORMAL 0",
    "#define STATUS_AUDIT 1",
    "",
    "int Payment_CheckStatus(int timeoutDetected)",
    "{",
    "    // 状態更新: 文字コード確認",
    "    if (timeoutDetected) {",
    "        printf(\"状態更新: %d\\n\", timeoutDetected);",
    "        return ERR_OK;",
    "    }",
    "    return ERR_OK;",
    "}",
    ""
  ].join("\n"))
  git(workspace, "add", ".")
  git(workspace, "commit", "-m", "sjis mixed head")
  return workspace
}

function writeShiftJis(filePath, text) {
  fs.writeFileSync(filePath, iconv.encode(text, "shift_jis"))
}

function copyFixtureTree(source, target) {
  fs.cpSync(source, target, { recursive: true })
}

function git(cwd, ...args) {
  const result = require("node:child_process").spawnSync("git", args, { cwd, encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
}
