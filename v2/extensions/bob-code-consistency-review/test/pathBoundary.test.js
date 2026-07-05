const assert = require("node:assert/strict")
const fsSync = require("node:fs")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const { captureBobOutput } = require("../out/core/bobOutputCapture")
const { resolveWorkspacePathForKind } = require("../out/core/fileSystem")
const { preprocessReview } = require("../out/core/pipeline")
const { discoverReviewInputCandidates } = require("../out/core/reviewInputDiscovery")
const { validateReviewInput } = require("../out/core/reviewInputValidator")
const { writeTraceabilityCatalog } = require("../out/core/traceabilityCatalogStore")
const { generateHumanTriage } = require("../out/triage/humanTriageHelper")

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

test("kind-aware output resolver rejects absolute, escaped, and misplaced generated artifact paths", async () => {
  const workspaceRoot = await makeWorkspace()

  assert.throws(
    () => resolveWorkspacePathForKind(workspaceRoot, path.join(workspaceRoot, ".bob-review", "review-package"), "review-package-output"),
    /reviewPackagePath must be a workspace-relative path/
  )
  assert.throws(
    () => resolveWorkspacePathForKind(workspaceRoot, "../review-package", "review-package-output"),
    /reviewPackagePath escapes workspace/
  )
  assert.throws(
    () => resolveWorkspacePathForKind(workspaceRoot, ".bob-review/bob-output", "review-package-output"),
    /reviewPackagePath must be under/
  )
  assert.throws(
    () => resolveWorkspacePathForKind(workspaceRoot, ".bob-review/Bob-Output/review-package", "review-package-output"),
    /reviewPackagePath must be under/
  )
  assert.throws(
    () => resolveWorkspacePathForKind(workspaceRoot, ".bob-review/review-package/bob-output.yaml", "bob-output"),
    /bobOutputPath must be under/
  )
  assert.throws(
    () => resolveWorkspacePathForKind(workspaceRoot, ".bob-review/traceability-catalog.json", "traceability-catalog"),
    /traceabilityCatalogPath must be under/
  )
  assert.throws(
    () => resolveWorkspacePathForKind(workspaceRoot, ".bob-trace/AI-Traceability-Draft/catalog.json", "traceability-catalog"),
    /traceabilityCatalogPath must be under/
  )
})

test("kind-aware output resolver rejects symlink escapes", async (t) => {
  const workspaceRoot = await makeWorkspace()
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bob-path-boundary-symlink-"))
  await fs.mkdir(path.join(workspaceRoot, ".bob-review"), { recursive: true })
  const linkPath = path.join(workspaceRoot, ".bob-review", "review-package")

  try {
    await fs.symlink(outsideRoot, linkPath, "junction")
  } catch (error) {
    if (error && ["EPERM", "EACCES", "EINVAL"].includes(error.code)) {
      t.skip(`symlink creation is unavailable: ${error.code}`)
      return
    }
    throw error
  }

  assert.equal(fsSync.existsSync(linkPath), true)
  assert.throws(
    () => resolveWorkspacePathForKind(workspaceRoot, ".bob-review/review-package", "review-package-output"),
    /reviewPackagePath resolves outside workspace/
  )
})

test("preprocessReview rejects absolute review package output paths", async () => {
  const workspaceRoot = await makeWorkspace()
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bob-path-boundary-package-"))

  await assert.rejects(
    preprocessReview({
      workspaceRoot,
      inputPath: path.join(workspaceRoot, "review-input.yaml"),
      outDir: path.join(outsideRoot, "review-package"),
      diffFixturePath: path.join(workspaceRoot, "diff.json")
    }),
    /reviewPackagePath must be a workspace-relative path/
  )
})

test("preprocessReview rejects review package output outside the allowed artifact area", async () => {
  const workspaceRoot = await makeWorkspace()

  await assert.rejects(
    preprocessReview({
      workspaceRoot,
      inputPath: path.join(workspaceRoot, "review-input.yaml"),
      outDir: "docs/review-package",
      diffFixturePath: path.join(workspaceRoot, "diff.json")
    }),
    /reviewPackagePath must be under/
  )
})

test("captureBobOutput rejects bob output paths outside the bob-output area", async () => {
  const workspaceRoot = await makeWorkspace()

  await assert.rejects(
    captureBobOutput({
      workspaceRoot,
      text: "",
      bobOutputPath: ".bob-review/review-package/bob-output.yaml"
    }),
    /bobOutputPath must be under/
  )
})

test("generateHumanTriage rejects triage output paths outside the triage area", async () => {
  const workspaceRoot = await makeWorkspace()

  await assert.rejects(
    generateHumanTriage({
      workspaceRoot,
      packageDir: path.join(workspaceRoot, ".bob-review", "review-package"),
      bobOutputPath: path.join(workspaceRoot, ".bob-review", "bob-output", "bob-output.yaml"),
      outDir: ".bob-review/review-package/triage"
    }),
    /triagePath must be under/
  )
})

test("traceability catalog writes reject paths outside the traceability area", async () => {
  const workspaceRoot = await makeWorkspace()

  await assert.rejects(
    writeTraceabilityCatalog({
      workspaceRoot,
      catalogPath: ".bob-review/traceability-catalog.json",
      catalog: emptyTraceabilityCatalog()
    }),
    /traceabilityCatalogPath must be under/
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
      outDir: ".bob-review/review-package",
      diffFixturePath: outsideDiff
    }),
    /diffFixturePath escapes workspace/
  )
})

function emptyTraceabilityCatalog() {
  return {
    schema_version: 1,
    documents: [],
    domains: [],
    items: [],
    links: [],
    decisions: []
  }
}
