const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const { preprocessReview } = require("../out/core/pipeline")
const { discoverReviewInputCandidates } = require("../out/core/reviewInputDiscovery")
const { validateReviewInput } = require("../out/core/reviewInputValidator")

async function makeWorkspace() {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bob-path-boundary-workspace-"))
  await fs.mkdir(path.join(workspaceRoot, "docs"), { recursive: true })
  await fs.writeFile(path.join(workspaceRoot, "docs", "requirements.md"), "# Requirements\n\nREQ-PATH-001: Keep review paths inside the workspace.\n", "utf8")
  await fs.writeFile(path.join(workspaceRoot, "review-input.yaml"), reviewInputYaml("docs/requirements.md"), "utf8")
  await fs.writeFile(path.join(workspaceRoot, "diff.json"), JSON.stringify({
    vcs: "git",
    base: "main",
    head: "feature/path-boundary",
    files: [],
    unifiedDiff: "",
    warnings: []
  }, null, 2), "utf8")
  return workspaceRoot
}

function reviewInputYaml(artifactPath) {
  return [
    "schema_version: 1",
    "review:",
    "  id: REVIEW-PATH-001",
    "  title: Path boundary review",
    "  change_type: bugfix",
    "  purpose: Verify workspace path containment",
    "  base: main",
    "  head: feature/path-boundary",
    "  vcs: git",
    "artifacts:",
    "  requirements:",
    `    - path: ${JSON.stringify(artifactPath.replace(/\\/g, "/"))}`,
    "      sections:",
    "        - REQ-PATH-001",
    "review_focus:",
    "  - requirement-code-consistency",
    ""
  ].join("\n")
}

test("review input validation rejects existing artifact paths outside the workspace", async () => {
  const workspaceRoot = await makeWorkspace()
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bob-path-boundary-outside-"))
  const outsideArtifact = path.join(outsideRoot, "requirements.md")
  await fs.writeFile(outsideArtifact, "# Outside\n\nREQ-PATH-OUTSIDE: Must not be read.\n", "utf8")
  const inputPath = path.join(workspaceRoot, "review-input.yaml")
  await fs.writeFile(inputPath, reviewInputYaml(outsideArtifact), "utf8")

  await assert.rejects(
    validateReviewInput(inputPath, workspaceRoot),
    /artifact path escapes workspace/
  )
})

test("review input discovery rejects docsRoot values outside the workspace", async () => {
  const workspaceRoot = await makeWorkspace()
  const outsideRoot = path.join(path.dirname(workspaceRoot), "outside-docs")
  await fs.mkdir(outsideRoot, { recursive: true })
  await fs.writeFile(path.join(outsideRoot, "requirements.md"), "REQ-PATH-OUTSIDE\n", "utf8")

  await assert.rejects(
    discoverReviewInputCandidates(workspaceRoot, { docsRoot: "../outside-docs" }),
    /docsRoot escapes workspace/
  )
})

test("preprocessReview rejects review package output outside the workspace", async () => {
  const workspaceRoot = await makeWorkspace()
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bob-path-boundary-package-"))

  await assert.rejects(
    preprocessReview({
      workspaceRoot,
      inputPath: path.join(workspaceRoot, "review-input.yaml"),
      outDir: path.join(outsideRoot, "review-package"),
      diffFixturePath: path.join(workspaceRoot, "diff.json")
    }),
    /reviewPackagePath escapes workspace/
  )
})

test("preprocessReview rejects diff fixtures outside the workspace", async () => {
  const workspaceRoot = await makeWorkspace()
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bob-path-boundary-diff-"))
  const outsideDiff = path.join(outsideRoot, "diff.json")
  await fs.writeFile(outsideDiff, JSON.stringify({
    vcs: "git",
    base: "main",
    head: "feature/path-boundary",
    files: [],
    unifiedDiff: "",
    warnings: []
  }, null, 2), "utf8")

  await assert.rejects(
    preprocessReview({
      workspaceRoot,
      inputPath: path.join(workspaceRoot, "review-input.yaml"),
      outDir: path.join(workspaceRoot, ".bob-review", "review-package"),
      diffFixturePath: outsideDiff
    }),
    /diffFixturePath escapes workspace/
  )
})
