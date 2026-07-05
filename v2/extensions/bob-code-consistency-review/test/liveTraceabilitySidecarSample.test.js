const assert = require("node:assert/strict")
const childProcess = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { validateBobOutput } = require("../out/core/bobOutputValidator")
const { preprocessReview } = require("../out/core/pipeline")
const {
  applyAiTraceabilityDraft,
  parseAiTraceabilityDraft,
  prepareAiTraceabilityDraftPrompt
} = require("../out/core/traceabilityAiDraftProvider")
const {
  buildReviewInputDraftFromTraceability,
  validateTraceabilityCatalog
} = require("../out/core/traceabilityCatalog")
const { buildReviewInputFromDraft } = require("../out/core/reviewInputBuilder")
const { generateHumanTriage } = require("../out/triage/humanTriageHelper")

const repoRoot = path.resolve(__dirname, "..", "..", "..")
const sampleRoot = path.join(
  repoRoot,
  "docs",
  "workflows",
  "code-consistency-review",
  "examples",
  "live-traceability-sidecar"
)

test("live traceability sidecar sample contains draft input and a gate-valid catalog", async () => {
  const inputPath = path.join(sampleRoot, "traceability-ai-draft.input.json")
  const proposedDraftPath = path.join(sampleRoot, "traceability-ai-draft.proposed.json")
  const acceptedCatalogPath = path.join(sampleRoot, "fixtures", "workspace-common", ".bob-trace", "traceability-catalog.json")

  const draftInput = JSON.parse(fs.readFileSync(inputPath, "utf8"))
  assert.equal(draftInput.base, "main")
  assert.equal(draftInput.head, "feature/live-traceability-sidecar")
  assert.equal(draftInput.vcs, "git")
  assert.equal(draftInput.docsRoot, "docs")

  const proposedDraft = parseAiTraceabilityDraft(fs.readFileSync(proposedDraftPath, "utf8"))
  assert.ok(proposedDraft.items.length >= 6)
  assert.ok(proposedDraft.items.every((item) => item.status === "proposed" && !item.id))
  assert.ok((proposedDraft.links ?? []).every((link) => link.status === "proposed" && !link.from && !link.to))

  const draftWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-live-trace-draft-"))
  const applyResult = await applyAiTraceabilityDraft({
    workspaceRoot: draftWorkspace,
    text: fs.readFileSync(proposedDraftPath, "utf8")
  })
  assert.equal(applyResult.status, "ok")
  assert.ok(applyResult.catalog.items.some((item) => item.proposed_id === "REQ-RS001-PAY-0001"))

  const catalog = JSON.parse(fs.readFileSync(acceptedCatalogPath, "utf8"))
  const gate = validateTraceabilityCatalog(catalog)
  assert.equal(gate.status, "ok", JSON.stringify(gate.errors, null, 2))

  const workspace = createLiveTraceabilityWorkspace()
  const draft = buildReviewInputDraftFromTraceability(catalog, {
    review: {
      id: "LIVE-TRACE-001",
      title: "traceability sidecar 実機検証",
      change_type: "bugfix",
      purpose: "traceability sidecar から review-input.yaml を生成して実機確認する",
      base: "main",
      head: "feature/live-traceability-sidecar",
      vcs: "git",
      ticket_ids: ["TICKET-LIVE-001"]
    },
    review_focus: [
      "requirement-code-consistency",
      "design-code-consistency",
      "test-gap",
      "rt-ts-rule"
    ]
  })
  assert.equal(draft.status, "ok")

  const build = await buildReviewInputFromDraft(draft.draft, { workspaceRoot: workspace, strictPaths: true })
  assert.equal(build.status, "ok")
  assert.match(build.yaml, /REQ-RS001-PAY-0001/)
  assert.match(build.yaml, /RV-RV001-RT-0001/)
})

test("live traceability sidecar sample prompt input discovers docs and git diff", async () => {
  const workspace = createLiveTraceabilityWorkspace()
  const inputPath = path.join(sampleRoot, "traceability-ai-draft.input.json")
  const draftInput = JSON.parse(fs.readFileSync(inputPath, "utf8"))

  const result = await prepareAiTraceabilityDraftPrompt({
    workspaceRoot: workspace,
    outputDir: draftInput.outputDir,
    catalogPath: draftInput.catalogPath,
    docsRoot: draftInput.docsRoot,
    base: draftInput.base,
    head: draftInput.head,
    vcs: draftInput.vcs,
    textEncoding: draftInput.textEncoding
  })

  assert.equal(result.status, "ok")
  assert.match(result.prompt, /AI Draft Request: traceability sidecar catalog/)
  assert.match(result.prompt, /docs\/requirements-live\.md/)
  assert.match(result.prompt, /REQ-RS001-PAY-0001/)
  assert.match(result.prompt, /src\/payment_status\.c/)
  assert.equal(fs.readFileSync(result.promptPath, "utf8"), result.prompt)
})

test("preprocessReview builds a package from the live traceability sidecar sample", async () => {
  const workspace = createLiveTraceabilityWorkspace()
  const outDir = path.join(workspace, ".bob-review", "review-package")
  const expectedBobOutputPath = path.join(sampleRoot, "bob-output.expected.sample.yaml")

  const result = await preprocessReview({
    workspaceRoot: workspace,
    inputPath: path.join(workspace, "review-input.yaml"),
    outDir: ".bob-review/review-package"
  })

  const changedFiles = JSON.parse(fs.readFileSync(path.join(outDir, "changed-files.json"), "utf8"))
  const changedSymbols = JSON.parse(fs.readFileSync(path.join(outDir, "changed-symbols.json"), "utf8"))
  const evidenceIndex = JSON.parse(fs.readFileSync(path.join(outDir, "evidence-index.json"), "utf8"))
  const bobInput = fs.readFileSync(path.join(outDir, "bob-input.md"), "utf8")

  assert.equal(result.status, "ok")
  assert.ok(changedFiles.files.some((file) => file.path === "src/payment_status.c"))
  assert.match(JSON.stringify(changedSymbols), /Payment_CalculateLimit/)
  assert.match(JSON.stringify(changedSymbols), /Payment_HandleTimeout/)
  assert.match(JSON.stringify(changedSymbols), /Payment_UpdateRealtimeCache/)
  assert.ok(evidenceIndex.evidence.some((item) => item.ref === "REQ-RS001-PAY-0001"))
  assert.match(bobInput, /REQ-RS001-PAY-0001/)
  assert.match(bobInput, /TC-TS001-PAY-0001/)
  assert.match(bobInput, /TICKET-LIVE-001/)

  const report = await validateBobOutput({ packageDir: outDir, bobOutputPath: expectedBobOutputPath })
  assert.deepEqual(report.errors, [])

  const triageDir = path.join(workspace, ".bob-review", "human-triage")
  const triage = await generateHumanTriage({
    workspaceRoot: workspace,
    packageDir: outDir,
    bobOutputPath: expectedBobOutputPath,
    outDir: ".bob-review/human-triage"
  })
  assert.equal(triage.status, "ok")
  assert.match(fs.readFileSync(path.join(triageDir, "accepted-findings.md"), "utf8"), /PRE-001/)
  assert.match(fs.readFileSync(path.join(triageDir, "questions-to-author.md"), "utf8"), /Q-001/)
})

function createLiveTraceabilityWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-live-trace-"))
  copyFixtureTree(path.join(sampleRoot, "fixtures", "workspace-common"), workspace)
  copyFixtureTree(path.join(sampleRoot, "fixtures", "baseline"), workspace)
  git(workspace, "init", "-b", "main")
  git(workspace, "config", "user.email", "bob-fixture@example.local")
  git(workspace, "config", "user.name", "Bob Fixture")
  git(workspace, "add", ".")
  git(workspace, "commit", "-m", "baseline")
  git(workspace, "switch", "-c", "feature/live-traceability-sidecar")
  copyFixtureTree(path.join(sampleRoot, "fixtures", "head"), workspace)
  git(workspace, "add", ".")
  git(workspace, "commit", "-m", "live traceability sidecar head")
  return workspace
}

function copyFixtureTree(source, target) {
  fs.cpSync(source, target, { recursive: true })
}

function git(cwd, ...args) {
  const result = childProcess.spawnSync("git", args, { cwd, encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
}
