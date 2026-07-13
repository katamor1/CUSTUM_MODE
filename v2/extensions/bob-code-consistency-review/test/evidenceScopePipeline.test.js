const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { preprocessReview } = require("../out/core/pipeline")
const { buildReviewPackage } = require("../out/core/reviewPackageBuilder")
const { createMultiLanguageGitReviewWorkspace } = require("./helpers/reviewPipelineFixtures")

test("preprocessReview emits the evidence scope budget report and manifest handoff", async () => {
  const workspace = createMultiLanguageGitReviewWorkspace()
  const inputPath = path.join(workspace, "review-input.yaml")
  fs.appendFileSync(inputPath, [
    "",
    "  evidence_scope_rules:",
    "    - id: typescript-change",
    "      title: TypeScript change review",
    "      evaluation: ai",
    "      estimated_tokens: 25",
    "      applies_when:",
    "        languages:",
    "          - typescript",
    "    - id: broken-rule",
    "      title: Broken rule",
    "      evaluation: remote",
    ""
  ].join("\n"), "utf8")

  const outDir = path.join(workspace, ".bob-review", "review-package")
  const result = await preprocessReview({
    workspaceRoot: workspace,
    inputPath,
    outDir: ".bob-review/review-package"
  })

  const reportPath = path.join(outDir, "context-budget-report.json")
  assert.ok(fs.existsSync(reportPath), "context-budget-report.json should exist")
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"))
  const manifest = fs.readFileSync(path.join(outDir, "manifest.yaml"), "utf8")

  assert.equal(report.schema_version, 1)
  assert.equal(report.selection_policy, "bob-evidence-scope-v1")
  assert.match(report.source_revision, /^[0-9a-f]{40}\.\.[0-9a-f]{40}$/)
  assert.equal(report.rule_source, "review-input.bob_options.evidence_scope_rules")
  assert.equal(report.budget.budgetTokens, 524288)
  assert.match(report.scope_fingerprint, /^scope-[0-9a-f]{8}$/)
  assert.ok(report.selected_code.length > 0)
  assert.ok(report.applicable_rules.some((rule) => rule.id === "typescript-change"))
  assert.ok(report.warnings.some((warning) => warning.includes("broken-rule")))
  assert.ok(result.warnings.some((warning) => warning.includes("broken-rule")))
  assert.match(manifest, /context_budget_report: \.bob-review\/review-package\/context-budget-report\.json/)
  assert.doesNotMatch(JSON.stringify(report), /"text"\s*:|"markdown"\s*:/)
})

test("buildReviewPackage removes a stale context budget report when no current artifact is supplied", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-scope-package-fresh-"))
  const outDir = path.join(workspace, ".bob-review", "review-package")
  const reportPath = path.join(outDir, "context-budget-report.json")
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify({ stale: true }), "utf8")

  await buildReviewPackage({
    workspaceRoot: workspace,
    outDir,
    reviewInput: reviewInput(),
    diff: {
      vcs: "git",
      vcsRoot: workspace,
      base: "main",
      head: "feature/fresh",
      files: [],
      unifiedDiff: "",
      warnings: []
    },
    documents: { documents: [], excerptsMarkdown: "", evidence: [], warnings: [] },
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
    traceability: { rows: [], warnings: [], markdown: "" }
  })

  assert.equal(fs.existsSync(reportPath), false)
})

function reviewInput() {
  return {
    schema_version: 1,
    review: {
      id: "REVIEW-SCOPE-FRESHNESS",
      title: "Evidence scope freshness",
      change_type: "maintenance",
      purpose: "avoid stale evidence scope artifacts",
      base: "main",
      head: "feature/fresh",
      vcs: "git"
    },
    artifacts: {},
    review_focus: ["requirement-code-consistency"]
  }
}
