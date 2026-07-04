const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")
const extensionRoot = path.resolve(__dirname, "..")

test("buildReviewContextResult summarizes packet metadata and changed files", () => {
  const { buildReviewContextResult } = require("../out/workflowBridge")
  const packet = [
    "# Bazaar Revision Review Request",
    "",
    "VCS: Bazaar",
    "Repository root: C:\\repo\\trunk",
    "Review mode: singleRevision",
    "Revision target: 2",
    "",
    "## Bazaar review target metadata",
    "",
    "- revision: revid:test@example-20260627010101-abc",
    "- revno: 2",
    "- author: Test Author <author@example.test>",
    "- committer: Test Committer <committer@example.test>",
    "- timestamp: 2026-06-27 01:01:01 +0900",
    "",
    "### Message / status",
    "",
    "```text",
    "Update project rules",
    "```",
    "",
    "### Changed files",
    "",
    "- modified: src/main.c",
    "- added: docs/rules.md",
    "",
    "## Bazaar diff",
    "",
    "```diff",
    "=== modified file 'src/main.c'",
    "```"
  ].join("\n")

  const result = buildReviewContextResult(packet)

  assert.equal(result.status, "ok")
  assert.equal(result.workspacePath, "C:\\repo\\trunk")
  assert.equal(result.mode, "singleRevision")
  assert.equal(result.target, "2")
  assert.equal(result.revision, "revid:test@example-20260627010101-abc")
  assert.equal(result.revno, "2")
  assert.equal(result.author, "Test Author <author@example.test>")
  assert.equal(result.committer, "Test Committer <committer@example.test>")
  assert.equal(result.timestamp, "2026-06-27 01:01:01 +0900")
  assert.equal(result.message, "Update project rules")
  assert.deepEqual(result.changedFiles, [
    { path: "src/main.c", status: "modified" },
    { path: "docs/rules.md", status: "added" }
  ])
  assert.equal(result.packetBytes, Buffer.byteLength(packet, "utf8"))
  assert.match(result.packetSummary, /already been added to Bob context/i)
})

test("required project rules loaders reject missing files for workflow steps", async () => {
  const {
    loadProjectChecklistRequired,
    loadReviewResultSchemaRequired
  } = require("../out/projectRules/io")
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bob-bazaar-rules-"))

  await assert.rejects(
    () => loadProjectChecklistRequired(workspaceRoot, ".bob/review/checklist.json"),
    /Project checklist file not found/
  )
  await assert.rejects(
    () => loadReviewResultSchemaRequired(workspaceRoot, ".bob/review/review-result.schema.json"),
    /Review result schema file not found/
  )
})

test("workspace initialization tracks the WORKFLOW.md directory layout", () => {
  const source = require("node:fs").readFileSync(path.join(extensionRoot, "src", "bobWorkspaceInit.ts"), "utf8")

  assert.match(source, /\.bob\/workflows\/bazaar-project-rule-review\/WORKFLOW\.md/)
  assert.doesNotMatch(source, /\.bob\/workflows\/bazaar-project-rule-review\.md/)
})

test("workspace initialization previews and confirms template refresh before overwriting existing workflow files", () => {
  const source = require("node:fs").readFileSync(path.join(extensionRoot, "src", "bobWorkspaceInit.ts"), "utf8")

  assert.match(source, /refreshTemplateFiles\(templateRoot,\s*root,\s*\{\s*confirmOverwrite:\s*confirmTemplateRefresh\s*\}\)/s)
  assert.match(source, /openTextDocument\(\{\s*language:\s*"markdown",\s*content:\s*renderTemplateRefreshPreviewMarkdown\(preview\)\s*\}\)/s)
  assert.match(source, /showWarningMessage\([^)]*\{\s*modal:\s*true\s*\}/s)
  assert.match(source, /return\s+choice\s*===\s*updateLabel/)
})

test("Bazaar changed file parser ignores timestamp suffixes on plus-plus-plus paths", () => {
  const { parseChangedFileEntries } = require("../out/revisionInfo")
  const diff = [
    "=== modified file 'test1.md'",
    "--- test1.md\t2026-05-16 11:24:18 +0000",
    "+++ test1.md\t2026-05-16 12:24:18 +0000",
    "@@ -1 +1 @@",
    "-old",
    "+new"
  ].join("\n")

  assert.deepEqual(parseChangedFileEntries(diff), [
    { path: "test1.md", status: "modified" }
  ])
})

test("Bazaar changed file parser handles renamed and binary files", () => {
  const { parseChangedFileEntries } = require("../out/revisionInfo")
  const diff = [
    "=== renamed file 'src/old name.c' => 'src/new name.c'",
    "=== added file 'assets/logo.png'",
    "Binary files /dev/null and b/assets/logo.png differ"
  ].join("\n")

  assert.deepEqual(parseChangedFileEntries(diff), [
    { path: "assets/logo.png", status: "added", binary: true },
    { path: "src/new name.c", status: "renamed" }
  ])
})

test("added file content section marks binary files without reading them as text", async () => {
  const { buildAddedFilesContentSection } = require("../out/revisionInfo")
  let catCalls = 0
  const client = {
    cat: async () => {
      catCalls += 1
      return { command: "bzr", args: [], stdout: "binary", stderr: "", cwd: "C:\\repo" }
    }
  }

  const section = await buildAddedFilesContentSection(client, "C:\\repo", "1", {
    revision: "1",
    author: "a",
    committer: "c",
    timestamp: "t",
    message: "",
    changedFileCount: 1,
    changedFiles: ["assets/logo.png"],
    changedFileEntries: [{ path: "assets/logo.png", status: "added", binary: true }],
    logText: ""
  })

  assert.equal(catCalls, 0)
  assert.match(section, /### assets\/logo\.png/)
  assert.match(section, /\[BINARY: 追加ファイル本文は text として埋め込みません\]/)
})
