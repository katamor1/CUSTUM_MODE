const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { analyzeCodeChanges } = require("../out/analyzers/codeChangeAnalyzer")

test("analyzeCodeChanges shares one aggregate budget across generic code evidence", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-code-budget-"))
  const diff = {
    vcs: "git",
    vcsRoot: workspace,
    base: "base",
    head: "head",
    files: [
      { path: "src/one.ts", status: "modified", additions: 2, deletions: 1, language: "typescript" },
      { path: "src/two.ts", status: "modified", additions: 2, deletions: 1, language: "typescript" }
    ],
    unifiedDiff: [
      "diff --git a/src/one.ts b/src/one.ts",
      "--- a/src/one.ts",
      "+++ b/src/one.ts",
      "@@ -1,1 +1,2 @@",
      "-const value = 'old'",
      "+const value = 'new'",
      "+" + "one ".repeat(100),
      "diff --git a/src/two.ts b/src/two.ts",
      "--- a/src/two.ts",
      "+++ b/src/two.ts",
      "@@ -1,1 +1,2 @@",
      "-const value = 'old'",
      "+const value = 'new'",
      "+" + "two ".repeat(100),
      ""
    ].join("\n"),
    warnings: []
  }

  const result = await analyzeCodeChanges(diff, reviewInput(), {
    workspaceRoot: workspace,
    limits: {
      maxExcerptBytesPerDocument: 100,
      maxBobInputBytes: 320
    }
  })

  const totalMarkdownBytes = result.codeSlices.reduce(
    (total, slice) => total + Buffer.byteLength(slice.markdown, "utf8"),
    0
  )
  assert.ok(totalMarkdownBytes <= 320)
  assert.ok(result.warnings.some((warning) => warning.includes("maxExcerptBytesPerDocument") || warning.includes("aggregate maxBobInputBytes")))
})

test("analyzeCodeChanges skips oversized C and C++ source reads and falls back to diff evidence", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-code-source-limit-"))
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true })
  fs.writeFileSync(path.join(workspace, "src", "large.c"), [
    "int changed(void) {",
    "  return 1;",
    "}",
    "/* " + "large source ".repeat(100) + " */",
    ""
  ].join("\n"), "utf8")

  const diff = {
    vcs: "git",
    vcsRoot: workspace,
    base: "base",
    head: "head",
    files: [{ path: "src/large.c", status: "modified", additions: 1, deletions: 1, language: "c" }],
    unifiedDiff: [
      "diff --git a/src/large.c b/src/large.c",
      "--- a/src/large.c",
      "+++ b/src/large.c",
      "@@ -1,3 +1,3 @@",
      " int changed(void) {",
      "-  return 0;",
      "+  return 1;",
      " }",
      ""
    ].join("\n"),
    warnings: []
  }

  const result = await analyzeCodeChanges(diff, reviewInput(), {
    workspaceRoot: workspace,
    limits: {
      maxDocumentBytes: 64,
      maxExcerptBytesPerDocument: 256,
      maxBobInputBytes: 1024
    }
  })

  assert.ok(result.warnings.some((warning) => warning.includes("detailed C/C++ source analysis skipped")))
  assert.ok(result.evidence.some((item) => item.source === "src/large.c"), "diff evidence should remain available")
})

function reviewInput() {
  return {
    schema_version: 1,
    review: {
      id: "REVIEW-CODE-LIMIT",
      title: "Code limit",
      change_type: "bugfix",
      purpose: "Bound code analysis",
      base: "base",
      head: "head",
      vcs: "git"
    },
    artifacts: { requirements: [] },
    review_focus: ["requirement-code-consistency"]
  }
}
