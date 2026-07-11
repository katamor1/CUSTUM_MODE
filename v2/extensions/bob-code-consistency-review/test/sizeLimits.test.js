const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { extractDocuments } = require("../out/analyzers/documentExtractor")
const { collectGitDiff } = require("../out/core/gitDiffCollector")
const {
  DEFAULT_REVIEW_PROCESSING_LIMITS,
  MAX_REVIEW_PROCESSING_LIMITS,
  MIN_REVIEW_PROCESSING_LIMITS,
  normalizeReviewProcessingLimits
} = require("../out/core/limits")
const { buildReviewPackage } = require("../out/core/reviewPackageBuilder")
const { validateReviewInput } = require("../out/core/reviewInputValidator")

test("normalizeReviewProcessingLimits clamps every setting to a finite min/max range", () => {
  const minimum = normalizeReviewProcessingLimits({
    maxDocumentBytes: 0.1,
    maxWorkbookSheets: 0.1,
    maxRowsPerSheet: 0.1,
    maxExcerptBytesPerDocument: 0.1,
    maxRawDiffBytes: 0.1,
    maxBobInputBytes: 0.1
  })
  assert.deepEqual(minimum, MIN_REVIEW_PROCESSING_LIMITS)

  const maximum = normalizeReviewProcessingLimits({
    maxDocumentBytes: Number.MAX_SAFE_INTEGER,
    maxWorkbookSheets: Number.MAX_SAFE_INTEGER,
    maxRowsPerSheet: Number.MAX_SAFE_INTEGER,
    maxExcerptBytesPerDocument: Number.MAX_SAFE_INTEGER,
    maxRawDiffBytes: Number.MAX_SAFE_INTEGER,
    maxBobInputBytes: Number.MAX_SAFE_INTEGER
  })
  assert.deepEqual(maximum, MAX_REVIEW_PROCESSING_LIMITS)

  const fallback = normalizeReviewProcessingLimits({
    maxDocumentBytes: Number.NaN,
    maxWorkbookSheets: Number.POSITIVE_INFINITY,
    maxRowsPerSheet: -1,
    maxExcerptBytesPerDocument: undefined,
    maxRawDiffBytes: Number.NEGATIVE_INFINITY,
    maxBobInputBytes: -99
  })
  assert.deepEqual(fallback, DEFAULT_REVIEW_PROCESSING_LIMITS)
})

test("package configuration exposes the same processing limit ranges as runtime", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"))
  const properties = packageJson.contributes.configuration.properties
  for (const [propertySuffix, runtimeKey] of [
    ["maxDocumentBytes", "maxDocumentBytes"],
    ["maxWorkbookSheets", "maxWorkbookSheets"],
    ["maxRowsPerSheet", "maxRowsPerSheet"],
    ["maxExcerptBytesPerDocument", "maxExcerptBytesPerDocument"],
    ["maxRawDiffBytes", "maxRawDiffBytes"],
    ["maxBobInputBytes", "maxBobInputBytes"]
  ]) {
    const definition = properties[`bobCodeConsistency.${propertySuffix}`]
    assert.equal(definition.minimum, MIN_REVIEW_PROCESSING_LIMITS[runtimeKey])
    assert.equal(definition.maximum, MAX_REVIEW_PROCESSING_LIMITS[runtimeKey])
    assert.equal(definition.default, DEFAULT_REVIEW_PROCESSING_LIMITS[runtimeKey])
  }
})

test("validateReviewInput rejects an input file above the configured document byte limit", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-size-review-input-"))
  const inputPath = path.join(workspace, "review-input.yaml")
  fs.writeFileSync(inputPath, JSON.stringify(reviewInput("docs/unused.md")), "utf8")

  await assert.rejects(
    () => validateReviewInput(inputPath, workspace, "utf8", 64),
    /review-input\.yaml exceeded maxDocumentBytes/
  )
})

test("validateReviewInput rejects excessive aggregate artifact references before path checks", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-size-artifact-refs-"))
  const inputPath = path.join(workspace, "review-input.yaml")
  const input = reviewInput("docs/unused.md")
  input.artifacts.requirements = Array.from({ length: 501 }, (_, index) => ({
    path: `docs/missing-${index}.md`,
    sections: [`REQ-${index}`]
  }))
  fs.writeFileSync(inputPath, JSON.stringify(input), "utf8")

  await assert.rejects(
    () => validateReviewInput(inputPath, workspace, "utf8"),
    /artifact references exceed maximum \(501 > 500\)/
  )
})

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

test("extractDocuments enforces an aggregate excerpt budget across documents", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-size-doc-total-"))
  fs.mkdirSync(path.join(workspace, "docs"), { recursive: true })
  for (const [name, requirement] of [["one.md", "REQ-TOTAL-001"], ["two.md", "REQ-TOTAL-002"]]) {
    fs.writeFileSync(path.join(workspace, "docs", name), [
      `# ${requirement}`,
      "",
      `${requirement} ${"aggregate sensitive context ".repeat(30)}`,
      ""
    ].join("\n"), "utf8")
  }

  const input = reviewInput("docs/one.md")
  input.artifacts.requirements.push({ path: "docs/two.md", sections: ["REQ-TOTAL-002"] })
  const result = await extractDocuments(input, {
    workspaceRoot: workspace,
    limits: {
      maxDocumentBytes: 4096,
      maxExcerptBytesPerDocument: 1024,
      maxBobInputBytes: 320
    }
  })

  assert.ok(Buffer.byteLength(result.excerptsMarkdown, "utf8") <= 320)
  assert.ok(result.warnings.some((warning) => warning.includes("aggregate maxBobInputBytes")))
  assert.ok(result.evidence.reduce((total, item) => total + Buffer.byteLength(item.text ?? "", "utf8"), 0) <= 320)
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
