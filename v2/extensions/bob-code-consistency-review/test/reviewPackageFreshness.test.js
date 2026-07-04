const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { buildReviewPackage } = require("../out/core/reviewPackageBuilder")

test("buildReviewPackage cleans managed artifacts and records a generation id", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-package-fresh-"))
  const outDir = path.join(workspace, ".bob-review", "review-package")
  fs.mkdirSync(path.join(outDir, "code-slices"), { recursive: true })
  fs.mkdirSync(path.join(outDir, "tables"), { recursive: true })
  fs.writeFileSync(path.join(outDir, "code-slices", "SRC-OLD.md"), "stale code slice", "utf8")
  fs.writeFileSync(path.join(outDir, "tables", "REQ-OLD.md"), "stale table", "utf8")

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

  assert.equal(fs.existsSync(path.join(outDir, "code-slices", "SRC-OLD.md")), false)
  assert.equal(fs.existsSync(path.join(outDir, "tables", "REQ-OLD.md")), false)
  assert.match(fs.readFileSync(path.join(outDir, "manifest.yaml"), "utf8"), /generation_id: [0-9a-f-]+/)
})

function reviewInput() {
  return {
    schema_version: 1,
    review: {
      id: "REVIEW-FRESHNESS",
      title: "Package freshness",
      change_type: "maintenance",
      purpose: "avoid stale managed artifacts",
      base: "main",
      head: "feature/fresh",
      vcs: "git"
    },
    artifacts: {},
    review_focus: ["requirement-code-consistency"]
  }
}
