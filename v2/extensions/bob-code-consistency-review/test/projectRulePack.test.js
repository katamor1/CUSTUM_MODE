const assert = require("node:assert/strict")
const { createHash } = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { preprocessReview } = require("../out/core/pipeline")
const { createMultiLanguageGitReviewWorkspace } = require("./helpers/reviewPipelineFixtures")

function projectRulePackApi() {
  return require("../out/evidenceScope/projectRulePackLoader")
}

test("project rule pack loader reads bounded workspace-local bytes without modifying the source", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-rule-pack-load-"))
  const relativePath = ".bob/evidence-scope/project-rules.yaml"
  const filePath = path.join(workspace, relativePath)
  const source = rulePackYaml({ title: "TypeScript change review" })
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, source, "utf8")
  const before = fs.readFileSync(filePath)

  const { loadProjectRulePack } = projectRulePackApi()
  const loaded = await loadProjectRulePack({
    workspaceRoot: workspace,
    rulePackPath: relativePath,
    maxBytes: 4096,
    textEncoding: "utf8"
  })

  assert.ok(loaded)
  assert.equal(loaded.id, "payment-review")
  assert.equal(loaded.version, "2026.07")
  assert.equal(loaded.sourcePath, relativePath)
  assert.equal(loaded.contentHash, `sha256:${createHash("sha256").update(before).digest("hex")}`)
  assert.deepEqual(loaded.rules.map((rule) => rule.id), ["typescript-change"])
  assert.deepEqual(fs.readFileSync(filePath), before)

  await assert.rejects(
    loadProjectRulePack({
      workspaceRoot: workspace,
      rulePackPath: relativePath,
      maxBytes: 32,
      textEncoding: "utf8"
    }),
    /exceeded maxDocumentBytes/
  )
})

test("project rule pack loader rejects path escape and unsupported schema versions", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-rule-pack-invalid-"))
  const { loadProjectRulePack } = projectRulePackApi()

  await assert.rejects(
    loadProjectRulePack({
      workspaceRoot: workspace,
      rulePackPath: "../outside.yaml",
      maxBytes: 4096,
      textEncoding: "utf8"
    }),
    /must be workspace-relative|escapes workspace/
  )

  const relativePath = ".bob/evidence-scope/unsupported.yaml"
  const filePath = path.join(workspace, relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, rulePackYaml({ schemaVersion: 2 }), "utf8")

  await assert.rejects(
    loadProjectRulePack({
      workspaceRoot: workspace,
      rulePackPath: relativePath,
      maxBytes: 4096,
      textEncoding: "utf8"
    }),
    /Invalid evidence scope rule pack[\s\S]*schema_version|Invalid evidence scope rule pack[\s\S]*must be equal to constant/
  )
})

test("project rules remain authoritative when inline rules reuse an id", () => {
  const { mergeProjectRules } = projectRulePackApi()
  const merged = mergeProjectRules(
    [{ id: "shared", title: "Project pack", evaluation: "local", priority: "required" }],
    [
      { id: "shared", title: "Inline override", evaluation: "ai", priority: "required" },
      { id: "inline-only", title: "Inline only", evaluation: "local", priority: "required" }
    ]
  )

  assert.deepEqual(merged.rules.map((rule) => [rule.id, rule.title]), [
    ["inline-only", "Inline only"],
    ["shared", "Project pack"]
  ])
  assert.deepEqual(merged.warnings, [
    "duplicate inline evidence scope rule shared; project rule pack entry retained."
  ])
})

test("preprocessReview records rule pack provenance and changes stale input hash when only pack bytes change", async () => {
  const workspace = createMultiLanguageGitReviewWorkspace()
  const relativePath = ".bob/evidence-scope/project-rules.yaml"
  const packPath = path.join(workspace, relativePath)
  fs.mkdirSync(path.dirname(packPath), { recursive: true })
  fs.writeFileSync(packPath, rulePackYaml({ title: "TypeScript change review" }), "utf8")

  const inputPath = path.join(workspace, "review-input.yaml")
  fs.appendFileSync(inputPath, [
    "",
    `  evidence_scope_rule_pack_path: ${relativePath}`,
    ""
  ].join("\n"), "utf8")

  const outDir = path.join(workspace, ".bob-review", "review-package")
  await preprocessReview({
    workspaceRoot: workspace,
    inputPath,
    outDir: ".bob-review/review-package"
  })

  const firstReport = JSON.parse(fs.readFileSync(path.join(outDir, "context-budget-report.json"), "utf8"))
  const firstManifest = fs.readFileSync(path.join(outDir, "manifest.yaml"), "utf8")
  const firstInputHash = manifestInputHash(firstManifest)

  assert.equal(firstReport.rule_source, relativePath)
  assert.deepEqual(firstReport.rule_pack, {
    schema_version: 1,
    id: "payment-review",
    version: "2026.07",
    source_path: relativePath,
    content_hash: firstReport.rule_pack.content_hash
  })
  assert.match(firstReport.rule_pack.content_hash, /^sha256:[0-9a-f]{64}$/)
  assert.ok(firstReport.applicable_rules.some((rule) => rule.id === "typescript-change"))
  assert.match(firstManifest, /project_rule_pack: \.bob\/evidence-scope\/project-rules\.yaml/)
  assert.match(firstManifest, /project_rule_pack_id: payment-review/)
  assert.match(firstManifest, /project_rule_pack_version: "2026\.07"/)
  assert.match(firstManifest, /project_rule_pack_hash: sha256:[0-9a-f]{64}/)

  fs.writeFileSync(packPath, rulePackYaml({ title: "TypeScript change review updated" }), "utf8")
  await preprocessReview({
    workspaceRoot: workspace,
    inputPath,
    outDir: ".bob-review/review-package"
  })

  const secondReport = JSON.parse(fs.readFileSync(path.join(outDir, "context-budget-report.json"), "utf8"))
  const secondManifest = fs.readFileSync(path.join(outDir, "manifest.yaml"), "utf8")
  const secondInputHash = manifestInputHash(secondManifest)

  assert.notEqual(secondReport.rule_pack.content_hash, firstReport.rule_pack.content_hash)
  assert.notEqual(secondInputHash, firstInputHash)
  assert.doesNotMatch(JSON.stringify(secondReport), /schema_version:\s*1\nrules:/)
})

function manifestInputHash(manifest) {
  const match = manifest.match(/^\s*input_hash:\s*(sha256:[0-9a-f]{64})\s*$/m)
  assert.ok(match, "manifest input_hash should exist")
  return match[1]
}

function rulePackYaml({ schemaVersion = 1, title = "TypeScript change review" } = {}) {
  return [
    `schema_version: ${schemaVersion}`,
    "rule_pack:",
    "  id: payment-review",
    "  version: \"2026.07\"",
    "rules:",
    "  - id: typescript-change",
    `    title: ${title}`,
    "    evaluation: ai",
    "    estimated_tokens: 25",
    "    applies_when:",
    "      languages:",
    "        - typescript",
    ""
  ].join("\n")
}
