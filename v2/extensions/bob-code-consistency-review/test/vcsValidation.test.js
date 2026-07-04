const assert = require("node:assert/strict")
const childProcess = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { collectGitDiff } = require("../out/core/gitDiffCollector")
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

test("collectGitDiff rejects unsafe Bazaar revisions before executing bzr", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-bzr-vcs-validation-"))

  await assert.rejects(
    () => collectGitDiff(reviewInput({ base: "1;bad", head: "2", vcs: "bazaar" }), { workspaceRoot: workspace, bzrPath: process.execPath }),
    /安全でない Bazaar リビジョン指定/
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
  git(workspace, "init", "-b", "main")
  git(workspace, "config", "user.email", "bob-fixture@example.local")
  git(workspace, "config", "user.name", "Bob Fixture")
  git(workspace, "add", ".")
  git(workspace, "commit", "-m", "baseline")
  git(workspace, "switch", "-c", "feature/vcs-validation")
  fs.writeFileSync(path.join(workspace, "src", "example.txt"), "base\nhead\n")
  git(workspace, "add", ".")
  git(workspace, "commit", "-m", "head")
  return workspace
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
