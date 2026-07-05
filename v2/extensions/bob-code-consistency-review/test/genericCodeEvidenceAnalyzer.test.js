const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { analyzeCodeChanges } = require("../out/analyzers/codeChangeAnalyzer")

test("analyzeCodeChanges emits generic evidence for non C/C++ changed files", async () => {
  const workspace = createMultiLanguageWorkspace()
  const result = await analyzeCodeChanges(multiLanguageDiff(workspace), reviewInput(), { workspaceRoot: workspace, textEncoding: "utf8" })

  const bySource = new Map(result.evidence.map((item) => [item.source, item]))
  assert.ok(bySource.has("src/payment review.ts"))
  assert.ok(bySource.has("tools/reconcile.py"))
  assert.ok(bySource.has("app/PaymentReview.java"))
  assert.ok(bySource.has("include/payment_limits.h"), "C/C++ files without function evidence should get generic fallback evidence")
  assert.equal(new Set(result.evidence.map((item) => item.evidence_id)).size, result.evidence.length)
  assert.ok(result.evidence.every((item) => item.evidence_id.startsWith("SRC-")))
  assert.match(result.summaryMarkdown, /汎用コード変更根拠/)
  assert.match(result.summaryMarkdown, /typescript/)
  assert.match(result.summaryMarkdown, /python/)
  assert.match(result.summaryMarkdown, /java/)
  assert.match(result.summaryMarkdown, /hpp|h/)
})

test("analyzeCodeChanges honors analysis_options.language as an explicit filter", async () => {
  const workspace = createMultiLanguageWorkspace()
  const result = await analyzeCodeChanges(multiLanguageDiff(workspace), {
    ...reviewInput(),
    analysis_options: { language: ["python"] }
  }, { workspaceRoot: workspace, textEncoding: "utf8" })

  assert.deepEqual(result.evidence.map((item) => item.source), ["tools/reconcile.py"])
  assert.equal(result.changedSymbols.length, 1)
  assert.equal(result.changedSymbols[0].file, "tools/reconcile.py")
})

function createMultiLanguageWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-generic-code-evidence-"))
  writeFile(workspace, "src/payment review.ts", [
    "export function calculateStatus(input: number): string {",
    "  return input > 100 ? 'review' : 'ok'",
    "}",
    ""
  ])
  writeFile(workspace, "tools/reconcile.py", [
    "def reconcile(status):",
    "    return 'review' if status > 100 else 'ok'",
    ""
  ])
  writeFile(workspace, "app/PaymentReview.java", [
    "class PaymentReview {",
    "  String status(int input) { return input > 100 ? \"review\" : \"ok\"; }",
    "}",
    ""
  ])
  writeFile(workspace, "include/payment_limits.h", [
    "#define PAYMENT_REVIEW_LIMIT 100",
    ""
  ])
  return workspace
}

function writeFile(workspace, relativePath, lines) {
  const filePath = path.join(workspace, relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, lines.join("\n"), "utf8")
}

function multiLanguageDiff(workspace) {
  return {
    vcs: "git",
    vcsRoot: workspace,
    base: "base",
    head: "head",
    files: [
      { path: "src/payment review.ts", status: "modified", additions: 1, deletions: 1, language: "typescript" },
      { path: "tools/reconcile.py", status: "modified", additions: 1, deletions: 1, language: "python" },
      { path: "app/PaymentReview.java", status: "modified", additions: 1, deletions: 1, language: "java" },
      { path: "include/payment_limits.h", status: "modified", additions: 1, deletions: 1, language: "h" }
    ],
    unifiedDiff: [
      "diff --git a/src/payment review.ts b/src/payment review.ts",
      "--- a/src/payment review.ts",
      "+++ b/src/payment review.ts",
      "@@ -1,3 +1,3 @@",
      " export function calculateStatus(input: number): string {",
      "-  return input > 50 ? 'review' : 'ok'",
      "+  return input > 100 ? 'review' : 'ok'",
      " }",
      "diff --git a/tools/reconcile.py b/tools/reconcile.py",
      "--- a/tools/reconcile.py",
      "+++ b/tools/reconcile.py",
      "@@ -1,2 +1,2 @@",
      " def reconcile(status):",
      "-    return 'review' if status > 50 else 'ok'",
      "+    return 'review' if status > 100 else 'ok'",
      "diff --git a/app/PaymentReview.java b/app/PaymentReview.java",
      "--- a/app/PaymentReview.java",
      "+++ b/app/PaymentReview.java",
      "@@ -1,3 +1,3 @@",
      " class PaymentReview {",
      "-  String status(int input) { return input > 50 ? \"review\" : \"ok\"; }",
      "+  String status(int input) { return input > 100 ? \"review\" : \"ok\"; }",
      " }",
      "diff --git a/include/payment_limits.h b/include/payment_limits.h",
      "--- a/include/payment_limits.h",
      "+++ b/include/payment_limits.h",
      "@@ -1 +1 @@",
      "-#define PAYMENT_REVIEW_LIMIT 50",
      "+#define PAYMENT_REVIEW_LIMIT 100",
      ""
    ].join("\n"),
    warnings: []
  }
}

function reviewInput() {
  return {
    schema_version: 1,
    review: {
      id: "REVIEW-GENERIC-CODE",
      title: "generic code evidence",
      change_type: "maintenance",
      purpose: "collect generic evidence for non C/C++ languages",
      base: "base",
      head: "head",
      vcs: "git"
    },
    artifacts: {},
    review_focus: ["design-code-consistency"]
  }
}
