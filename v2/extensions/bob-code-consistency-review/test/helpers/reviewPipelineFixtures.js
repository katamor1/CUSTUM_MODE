const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const iconv = require("iconv-lite")

const extensionRoot = path.resolve(__dirname, "..", "..")
const repoRoot = path.resolve(extensionRoot, "..", "..")
const sampleRoot = path.join(repoRoot, "docs", "workflows", "code-consistency-review")
const reviewInputPath = path.join(sampleRoot, "examples", "simple-timeout-bugfix", "review-input.yaml")
const diffFixturePath = path.join(sampleRoot, "scaffold", "tests", "fixtures", "diff-summary.valid.json")
const bobOutputFixturePath = path.join(sampleRoot, "scaffold", "tests", "fixtures", "bob-output.valid.yaml")
const aiMatrixRoot = path.join(sampleRoot, "examples", "ai-verification-matrix")
const aiMatrixExpectedOutputPath = path.join(aiMatrixRoot, "bob-output.expected.sample.yaml")
const multiLanguageRoot = path.join(sampleRoot, "examples", "multi-language-git-review")

function createAiVerificationMatrixWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-ai-matrix-"))
  copyFixtureTree(path.join(aiMatrixRoot, "fixtures", "workspace-common"), workspace)
  copyFixtureTree(path.join(aiMatrixRoot, "fixtures", "baseline"), workspace)
  git(workspace, "init", "-b", "main")
  git(workspace, "config", "user.email", "bob-fixture@example.local")
  git(workspace, "config", "user.name", "Bob Fixture")
  git(workspace, "add", ".")
  git(workspace, "commit", "-m", "baseline")
  git(workspace, "switch", "-c", "feature/ai-verification-matrix")
  copyFixtureTree(path.join(aiMatrixRoot, "fixtures", "head"), workspace)
  git(workspace, "add", ".")
  git(workspace, "commit", "-m", "ai verification matrix head")
  return workspace
}

function createShiftJisMixedWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-sjis-mixed-"))
  fs.mkdirSync(path.join(workspace, "docs"), { recursive: true })
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true })
  writeShiftJis(path.join(workspace, "review-input.yaml"), [
    "schema_version: 1",
    "review:",
    "  id: REVIEW-SJIS-001",
    "  title: Shift-JIS 混在検証",
    "  change_type: bugfix",
    "  purpose: 日本語コメントと仕様文書の文字化け確認",
    "  base: main",
    "  head: feature/sjis-mixed",
    "  vcs: git",
    "artifacts:",
    "  requirements:",
    "    - path: docs/requirements-sjis.md",
    "      version: \"1.0\"",
    "      sections:",
    "        - REQ-SJIS-001",
    "review_focus:",
    "  - requirement-code-consistency",
    "  - rt-ts-rule",
    ""
  ].join("\n"))
  writeShiftJis(path.join(workspace, "docs", "requirements-sjis.md"), [
    "# REQ-SJIS-001 状態更新",
    "",
    "REQ-SJIS-001: タイムアウト時は ERR_TIMEOUT を返し、監査ログの日本語メッセージを維持する。",
    ""
  ].join("\n"))
  writeShiftJis(path.join(workspace, "src", "payment_status.h"), [
    "#define ERR_OK 0",
    "#define ERR_TIMEOUT 8",
    "int Payment_CheckStatus(int timeoutDetected);",
    ""
  ].join("\n"))
  writeShiftJis(path.join(workspace, "src", "payment_status.c"), [
    "#include \"payment_status.h\"",
    "#define STATUS_NORMAL 0",
    "",
    "int Payment_CheckStatus(int timeoutDetected)",
    "{",
    "    // 初期値",
    "    if (timeoutDetected) {",
    "        return ERR_TIMEOUT;",
    "    }",
    "    return ERR_OK;",
    "}",
    ""
  ].join("\n"))

  git(workspace, "init", "-b", "main")
  git(workspace, "config", "user.email", "bob-fixture@example.local")
  git(workspace, "config", "user.name", "Bob Fixture")
  git(workspace, "add", ".")
  git(workspace, "commit", "-m", "baseline")
  git(workspace, "switch", "-c", "feature/sjis-mixed")
  writeShiftJis(path.join(workspace, "src", "payment_status.c"), [
    "#include \"payment_status.h\"",
    "#include <stdio.h>",
    "#define STATUS_NORMAL 0",
    "#define STATUS_AUDIT 1",
    "",
    "int Payment_CheckStatus(int timeoutDetected)",
    "{",
    "    // 状態更新: 文字コード確認",
    "    if (timeoutDetected) {",
    "        printf(\"状態更新: %d\\n\", timeoutDetected);",
    "        return ERR_OK;",
    "    }",
    "    return ERR_OK;",
    "}",
    ""
  ].join("\n"))
  git(workspace, "add", ".")
  git(workspace, "commit", "-m", "sjis mixed head")
  return workspace
}

function createMultiLanguageGitReviewWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-multilang-review-"))
  copyFixtureTree(path.join(multiLanguageRoot, "fixtures", "workspace-common"), workspace)
  copyFixtureTree(path.join(multiLanguageRoot, "fixtures", "baseline"), workspace)
  git(workspace, "init", "-b", "main")
  git(workspace, "config", "user.email", "bob-fixture@example.local")
  git(workspace, "config", "user.name", "Bob Fixture")
  git(workspace, "add", ".")
  git(workspace, "commit", "-m", "baseline")
  git(workspace, "switch", "-c", "feature/multi-language-git-review")
  copyFixtureTree(path.join(multiLanguageRoot, "fixtures", "head"), workspace)
  git(workspace, "add", ".")
  git(workspace, "commit", "-m", "multi-language head")
  return workspace
}

function writeShiftJis(filePath, text) {
  fs.writeFileSync(filePath, iconv.encode(text, "shift_jis"))
}

function copyFixtureTree(source, target) {
  fs.cpSync(source, target, { recursive: true })
}

function git(cwd, ...args) {
  const result = require("node:child_process").spawnSync("git", args, { cwd, encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
}

module.exports = {
  aiMatrixExpectedOutputPath,
  aiMatrixRoot,
  bobOutputFixturePath,
  createAiVerificationMatrixWorkspace,
  createMultiLanguageGitReviewWorkspace,
  createShiftJisMixedWorkspace,
  diffFixturePath,
  repoRoot,
  reviewInputPath,
  sampleRoot
}
