const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { analyzeCppChanges } = require("../out/analyzers/cCppChangeAnalyzer")

test("analyzeCppChanges skips ambiguous basename fallback candidates", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-ccpp-ambiguous-"))
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true })
  fs.mkdirSync(path.join(workspace, "tests"), { recursive: true })
  const source = [
    "int ChangedFunction(void)",
    "{",
    "    return 1;",
    "}",
    ""
  ].join("\n")
  fs.writeFileSync(path.join(workspace, "src", "foo.c"), source, "utf8")
  fs.writeFileSync(path.join(workspace, "tests", "foo.c"), source, "utf8")

  const result = await analyzeCppChanges({
    vcs: "git",
    vcsRoot: workspace,
    base: "main",
    head: "feature/ambiguous",
    files: [{ path: "missing/foo.c", status: "modified", additions: 1, deletions: 0, language: "c" }],
    unifiedDiff: [
      "diff --git a/missing/foo.c b/missing/foo.c",
      "--- a/missing/foo.c",
      "+++ b/missing/foo.c",
      "@@ -1,4 +1,4 @@",
      " int ChangedFunction(void)",
      " {",
      "+    return 1;",
      " }",
      ""
    ].join("\n"),
    warnings: []
  }, reviewInput(), { workspaceRoot: workspace, textEncoding: "utf8" })

  assert.equal(result.codeSlices.length, 0)
  assert.equal(result.evidence.length, 0)
  assert.ok(result.warnings.some((warning) => warning.includes("ambiguous basename")))
})

function reviewInput() {
  return {
    schema_version: 1,
    review: {
      id: "REVIEW-AMBIGUOUS-BASENAME",
      title: "ambiguous basename",
      change_type: "bugfix",
      purpose: "avoid ambiguous basename fallback",
      base: "main",
      head: "feature/ambiguous",
      vcs: "git"
    },
    artifacts: {},
    review_focus: ["requirement-code-consistency"]
  }
}
