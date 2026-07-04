const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { extractDocuments } = require("../out/analyzers/documentExtractor")
const { collectGitDiff } = require("../out/core/gitDiffCollector")
const { buildReviewPackage } = require("../out/core/reviewPackageBuilder")

test("extractDocuments limits document bytes and excerpt bytes with warnings", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-size-doc-"))
  fs.mkdirSync(path.join(workspace, "docs"), { recursive: true })
  fs.writeFileSync(path.join(workspace, "docs", "large.md"), [
    "# REQ-LIMIT-001 Large",
    "",
    "REQ-LIMIT-001 " + "sensitive context ".repeat(80),
    ""
  ].join("\n"), "utf8")

  const result = await extractDocuments(reviewInput("docs/large.md"), {
    workspaceRoot: workspace,
    limits: {
      maxDocumentBytes: 180,
      maxExcerptBytesPerDocument: 120
    }
  })

  assert.ok(result.warnings.some((warning) => warning.includes("maxDocumentBytes")))
  assert.ok(result.warnings.some((warning) => warning.includes("maxExcerptBytesPerDocument")))
  assert.ok(Buffer.byteLength(result.evidence[0].text, "utf8") <= 120)
  assert.match(result.excerptsMarkdown, /\[truncated/)
})

test("collectGitDiff truncates raw unified diff and records a warning", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-size-diff-"))
  const fixturePath = path.join(workspace, "diff-summary.json")
  fs.writeFileSync(fixturePath, JSON.stringify({
    vcs: "git",
    vcsRoot: workspace,
    base: "base",
    head: "head",
    files: [{ path: "src/example.c", status: "modified", additions: 1, deletions: 1 }],
    unifiedDiff: `diff --git a/src/example.c b/src/example.c\n${"+very long diff line\n".repeat(80)}`,
    warnings: []
  }), "utf8")

  const diff = await collectGitDiff(reviewInput("docs/unused.md"), {
    workspaceRoot: workspace,
    diffFixturePath: fixturePath,
    limits: { maxRawDiffBytes: 200 }
  })

  assert.ok(Buffer.byteLength(diff.unifiedDiff, "utf8") <= 200)
  assert.ok(diff.warnings.some((warning) => warning.includes("maxRawDiffBytes")))
})

test("buildReviewPackage records truncation warnings in manifest and deterministic checks", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-size-package-"))
  const outDir = path.join(workspace, ".bob-review", "review-package")
  const warnings = await buildReviewPackage({
    workspaceRoot: workspace,
    outDir,
    reviewInput: reviewInput("docs/unused.md"),
    diff: {
      vcs: "git",
      vcsRoot: workspace,
      base: "base",
      head: "head",
      files: [{ path: "src/example.c", status: "modified", additions: 1, deletions: 1 }],
      unifiedDiff: `diff --git a/src/example.c b/src/example.c\n${"+very long diff line\n".repeat(80)}`,
      warnings: []
    },
    documents: {
      documents: [],
      excerptsMarkdown: "REQ-LIMIT-001 " + "large document excerpt ".repeat(120),
      evidence: [],
      warnings: []
    },
    codeAnalysis: {
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
    },
    traceability: { rows: [], warnings: [], markdown: "" },
    limits: {
      maxRawDiffBytes: 180,
      maxBobInputBytes: 700
    }
  })

  const manifest = fs.readFileSync(path.join(outDir, "manifest.yaml"), "utf8")
  const deterministic = fs.readFileSync(path.join(outDir, "deterministic-checks.md"), "utf8")
  assert.ok(warnings.some((warning) => warning.includes("maxRawDiffBytes")))
  assert.ok(warnings.some((warning) => warning.includes("maxBobInputBytes")))
  assert.match(manifest, /truncation_warnings:/)
  assert.match(deterministic, /maxRawDiffBytes/)
  assert.match(deterministic, /maxBobInputBytes/)
})

function reviewInput(documentPath) {
  return {
    schema_version: 1,
    review: {
      id: "REVIEW-SIZE-LIMIT",
      title: "Size limit",
      change_type: "bugfix",
      purpose: "size limit",
      base: "base",
      head: "head",
      vcs: "git"
    },
    artifacts: {
      requirements: [{ path: documentPath, sections: ["REQ-LIMIT-001"] }]
    },
    review_focus: ["requirement-code-consistency"]
  }
}
