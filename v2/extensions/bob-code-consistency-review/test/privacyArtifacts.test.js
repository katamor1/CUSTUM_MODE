const assert = require("node:assert/strict")
const fs = require("node:fs")
const Module = require("node:module")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const extensionRoot = path.resolve(__dirname, "..")
const repoRoot = path.resolve(extensionRoot, "..", "..")
const { preprocessReview } = require("../out/core/pipeline")
const { diffFixturePath, reviewInputPath } = require("./helpers/reviewPipelineFixtures")
const { initializeCodeConsistencyWorkspace } = requireWithVscodeMock("../out/workspaceInitializer")

test("initializeCodeConsistencyWorkspace adds generated artifact gitignore helper", async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bob-privacy-init-"))
  const gitignorePath = path.join(workspaceRoot, ".gitignore")
  fs.writeFileSync(gitignorePath, "node_modules/\n", "utf8")

  const result = await initializeCodeConsistencyWorkspace({
    context: { asAbsolutePath: (relativePath) => path.join(extensionRoot, relativePath) },
    workspaceRoot
  })

  const gitignore = fs.readFileSync(gitignorePath, "utf8")
  assert.match(gitignore, /# Bob code consistency generated review artifacts/)
  assert.match(gitignore, /^\.bob-review\/$/m)
  assert.match(gitignore, /^\.bob-trace\/ai-traceability-draft\/$/m)
  assert.match(gitignore, /^\.bob\/workflows\/runs\/$/m)
  assert.equal((gitignore.match(/\.bob-review\//g) ?? []).length, 1)
  assert.match(result.message, /生成物.*機密情報/)
})

test("preprocessReview records generated artifact privacy notice in the review package", async () => {
  const outRoot = path.join(repoRoot, ".bob-review")
  fs.mkdirSync(outRoot, { recursive: true })
  const outDir = fs.mkdtempSync(path.join(outRoot, "review-privacy-"))

  await preprocessReview({
    workspaceRoot: repoRoot,
    inputPath: reviewInputPath,
    outDir: path.relative(repoRoot, outDir),
    diffFixturePath,
    workflowRunId: "run-privacy-001"
  })

  const manifest = fs.readFileSync(path.join(outDir, "manifest.yaml"), "utf8")
  const checks = fs.readFileSync(path.join(outDir, "deterministic-checks.md"), "utf8")
  assert.match(manifest, /privacy_notice:/)
  assert.match(manifest, /\.bob-review\/ and \.bob-trace\/ai-traceability-draft\//)
  assert.match(manifest, /artifact_metadata:/)
  assert.match(manifest, /producer_extension: bob-code-consistency-review/)
  assert.match(manifest, /producer_version: 0\.1\.0/)
  assert.match(manifest, /workflow_run_id: run-privacy-001/)
  assert.match(manifest, /source_vcs: git/)
  assert.match(manifest, /source_revision: fixture-base\.\.fixture-head/)
  assert.match(manifest, /input_hash: sha256:[a-f0-9]{64}/)
  assert.match(manifest, /contains_sensitive_context: true/)
  assert.match(manifest, /human_review_required: true/)
  assert.match(checks, /生成物は社内設計書・顧客仕様・ソースコード・raw diff を含む可能性があります/)
})

function requireWithVscodeMock(modulePath) {
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "vscode") return {}
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    return require(modulePath)
  } finally {
    Module._load = originalLoad
  }
}
