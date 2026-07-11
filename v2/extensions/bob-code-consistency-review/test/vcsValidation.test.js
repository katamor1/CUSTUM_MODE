const assert = require("node:assert/strict")
const childProcess = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { collectGitDiff, validateBazaarRevision } = require("../out/core/gitDiffCollector")
const { ExternalProcessError } = require("../out/core/externalProcessRunner")
const { readSourceSet } = require("./helpers/sourceReader")

test("collectGitDiff resolves valid git refs to commit SHAs before diffing", async () => {
  const workspace = createGitWorkspace()
  const diff = await collectGitDiff(reviewInput({ base: "main", head: "feature/vcs-validation", vcs: "git" }), { workspaceRoot: workspace })

  assert.match(diff.base, /^[0-9a-f]{40}$/)
  assert.match(diff.head, /^[0-9a-f]{40}$/)
  assert.notEqual(diff.base, "main")
  assert.notEqual(diff.head, "feature/vcs-validation")
  assert.ok(diff.files.some((file) => file.path === "src/example.txt"))
})

test("collectGitDiff rejects git revision options before diffing", async () => {
  const workspace = createGitWorkspace()

  await assert.rejects(
    () => collectGitDiff(reviewInput({ base: "--output=x", head: "HEAD", vcs: "git" }), { workspaceRoot: workspace }),
    /Invalid Git revision/
  )
})

test("collectGitDiff preserves cancellation while resolving Git revisions", async () => {
  const workspace = createGitWorkspace()
  const controller = new AbortController()
  controller.abort()

  await assert.rejects(
    () => collectGitDiff(
      reviewInput({ base: "main", head: "feature/vcs-validation", vcs: "git" }),
      { workspaceRoot: workspace, signal: controller.signal }
    ),
    (error) => {
      assert.ok(error instanceof ExternalProcessError)
      assert.equal(error.kind, "cancelled")
      return true
    }
  )
})

test("collectGitDiff rejects unsafe Bazaar revisions before executing bzr", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-bzr-vcs-validation-"))

  await assert.rejects(
    () => collectGitDiff(reviewInput({ base: "1;bad", head: "2", vcs: "bazaar" }), { workspaceRoot: workspace, bzrPath: process.execPath }),
    /安全でない Bazaar リビジョン指定/
  )
})

test("validateBazaarRevision rejects control characters before trimming", () => {
  for (const candidate of ["\n1234", "1234\r", "12\t34", "12\u000034"]) {
    assert.throws(
      () => validateBazaarRevision(candidate),
      /安全でない Bazaar リビジョン指定/
    )
  }
})

test("collectGitDiff classifies renamed, spaced, and binary Git paths", async () => {
  const workspace = createGitWorkspaceWithMixedPaths()
  const diff = await collectGitDiff(reviewInput({ base: "main", head: "feature/mixed-paths", vcs: "git" }), { workspaceRoot: workspace })

  const byPath = new Map(diff.files.map((file) => [file.path, file]))
  assert.equal(byPath.get("src/payment review.ts")?.status, "renamed")
  assert.equal(byPath.get("src/payment review.ts")?.language, "typescript")
  assert.equal(byPath.get("src/payment review.ts")?.additions, 1)
  assert.equal(byPath.get("src/payment review.ts")?.deletions, 1)
  assert.equal(byPath.get("docs/review spec.md")?.language, "markdown")
  assert.equal(byPath.get("assets/sample.bin")?.language, "unknown")
  assert.equal(byPath.get("assets/sample.bin")?.additions, 0)
  assert.equal(byPath.get("assets/sample.bin")?.deletions, 0)
})

test("collectGitDiff preserves real a and b directory prefixes", async () => {
  const workspace = createGitWorkspaceWithPrefixDirectories()
  const diff = await collectGitDiff(reviewInput({ base: "main", head: "feature/prefix-directories", vcs: "git" }), { workspaceRoot: workspace })

  const paths = diff.files.map((file) => file.path).sort()
  assert.deepEqual(paths, ["a/example.txt", "b/example.txt"])
  assert.ok(!paths.includes("example.txt"))
})

test("collectGitDiff rejects control-character Git paths instead of accepting quoted aliases", async () => {
  const workspace = createGitWorkspaceWithControlPath()

  await assert.rejects(
    () => collectGitDiff(reviewInput({ base: "main", head: "feature/control-path", vcs: "git" }), { workspaceRoot: workspace }),
    /changed file path contains control characters/
  )
})

test("command wiring rejects workflow arg bzrPath overrides", () => {
  const source = readSourceSet(["extension.ts", "reviewExecutionCommands.ts", "traceabilityCommands.ts", "extensionCommandOptions.ts"])

  assert.match(source, /function resolveTrustedBzrPath\(record: Record<string, unknown>, configuredPath: string \| undefined\): string/)
  assert.match(source, /bzrPath cannot be overridden by workflow args/)
  assert.doesNotMatch(source, /stringOption\(record, "bzrPath"\) \?\? config\.get<string>\("bzrPath", "bzr"\)/)
})

function createGitWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-git-vcs-validation-"))
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true })
  fs.writeFileSync(path.join(workspace, "src", "example.txt"), "base\n")
  initializeGitWorkspace(workspace)
  git(workspace, "switch", "-c", "feature/vcs-validation")
  fs.writeFileSync(path.join(workspace, "src", "example.txt"), "base\nhead\n")
  commitAll(workspace, "head")
  return workspace
}

function createGitWorkspaceWithMixedPaths() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-git-mixed-paths-"))
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true })
  fs.mkdirSync(path.join(workspace, "docs"), { recursive: true })
  fs.mkdirSync(path.join(workspace, "assets"), { recursive: true })
  fs.writeFileSync(path.join(workspace, "src", "payment.ts"), [
    "export const status = 'base'",
    "export const stableReviewMarker = 'same'",
    ""
  ].join("\n"), "utf8")
  fs.writeFileSync(path.join(workspace, "docs", "review spec.md"), "# Review\n\nbase\n", "utf8")
  fs.writeFileSync(path.join(workspace, "assets", "sample.bin"), Buffer.from([0, 1, 2, 3]))
  initializeGitWorkspace(workspace)
  git(workspace, "switch", "-c", "feature/mixed-paths")
  fs.renameSync(path.join(workspace, "src", "payment.ts"), path.join(workspace, "src", "payment review.ts"))
  fs.writeFileSync(path.join(workspace, "src", "payment review.ts"), [
    "export const status = 'head'",
    "export const stableReviewMarker = 'same'",
    ""
  ].join("\n"), "utf8")
  fs.writeFileSync(path.join(workspace, "docs", "review spec.md"), "# Review\n\nbase\nhead\n", "utf8")
  fs.writeFileSync(path.join(workspace, "assets", "sample.bin"), Buffer.from([4, 5, 6, 7, 8]))
  commitAll(workspace, "mixed paths")
  return workspace
}

function createGitWorkspaceWithPrefixDirectories() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-git-prefix-paths-"))
  fs.mkdirSync(path.join(workspace, "a"), { recursive: true })
  fs.mkdirSync(path.join(workspace, "b"), { recursive: true })
  fs.writeFileSync(path.join(workspace, "a", "example.txt"), "base\n", "utf8")
  fs.writeFileSync(path.join(workspace, "b", "example.txt"), "base\n", "utf8")
  initializeGitWorkspace(workspace)
  git(workspace, "switch", "-c", "feature/prefix-directories")
  fs.appendFileSync(path.join(workspace, "a", "example.txt"), "head\n", "utf8")
  fs.appendFileSync(path.join(workspace, "b", "example.txt"), "head\n", "utf8")
  commitAll(workspace, "prefix directories")
  return workspace
}

function createGitWorkspaceWithControlPath() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-git-control-path-"))
  fs.writeFileSync(path.join(workspace, "normal.txt"), "base\n", "utf8")
  initializeGitWorkspace(workspace)
  git(workspace, "switch", "-c", "feature/control-path")
  fs.writeFileSync(path.join(workspace, "tab\tname.txt"), "head\n", "utf8")
  commitAll(workspace, "control path")
  return workspace
}

function initializeGitWorkspace(workspace) {
  git(workspace, "init", "-b", "main")
  git(workspace, "config", "user.email", "bob-fixture@example.local")
  git(workspace, "config", "user.name", "Bob Fixture")
  commitAll(workspace, "baseline")
}

function commitAll(workspace, message) {
  git(workspace, "add", "-A", ".")
  git(workspace, "commit", "-m", message)
}

function git(cwd, ...args) {
  const result = childProcess.spawnSync("git", args, { cwd, encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
}

function reviewInput(review) {
  return {
    schema_version: 1,
    review: {
      id: "REVIEW-VCS-VALIDATION",
      title: "VCS validation",
      change_type: "bugfix",
      purpose: "VCS validation",
      base: review.base,
      head: review.head,
      vcs: review.vcs
    },
    artifacts: {},
    review_focus: ["requirement-code-consistency"]
  }
}
