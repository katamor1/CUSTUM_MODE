const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")
const YAML = require("yaml")

const { captureBobOutput } = require("../out/core/bobOutputCapture")
const { preprocessReview } = require("../out/core/pipeline")
const { validateBobOutput } = require("../out/core/bobOutputValidator")
const { generateHumanTriage } = require("../out/triage/humanTriageHelper")
const {
  aiMatrixExpectedOutputPath,
  bobOutputFixturePath,
  createAiVerificationMatrixWorkspace,
  diffFixturePath,
  repoRoot,
  reviewInputPath
} = require("./helpers/reviewPipelineFixtures")

test("AI verification matrix expected Bob output validates and generates triage", async () => {
  const workspace = createAiVerificationMatrixWorkspace()
  const packageDir = path.join(workspace, ".bob-review", "review-package")
  await preprocessReview({ workspaceRoot: workspace, inputPath: path.join(workspace, "review-input.yaml"), outDir: packageDir })

  const report = await validateBobOutput({ packageDir, bobOutputPath: aiMatrixExpectedOutputPath })
  assert.deepEqual(report.errors, [])

  const triageDir = path.join(workspace, ".bob-review", "human-triage")
  const triage = await generateHumanTriage({ packageDir, bobOutputPath: aiMatrixExpectedOutputPath, outDir: triageDir })
  assert.equal(triage.status, "ok")
  assert.ok(triage.itemCount >= 4)
  assert.match(fs.readFileSync(path.join(triageDir, "accepted-findings.md"), "utf8"), /PRE-001/)
  assert.match(fs.readFileSync(path.join(triageDir, "questions-to-author.md"), "utf8"), /Q-001/)
})

test("capture, validate, and triage do not silently use review-package bob-output fallback", async () => {
  const workspace = createAiVerificationMatrixWorkspace()
  const packageDir = path.join(workspace, ".bob-review", "review-package")
  await preprocessReview({ workspaceRoot: workspace, inputPath: path.join(workspace, "review-input.yaml"), outDir: packageDir })

  const fallbackOutputPath = path.join(packageDir, "bob-output.yaml")
  const canonicalOutputPath = path.join(workspace, ".bob-review", "bob-output", "bob-output.yaml")
  fs.copyFileSync(aiMatrixExpectedOutputPath, fallbackOutputPath)

  const capture = await captureBobOutput({
    workspaceRoot: workspace,
    packageDir,
    bobOutputPath: canonicalOutputPath,
    text: "Bob wrote the YAML output to .bob-review/review-package/bob-output.yaml."
  })
  assert.equal(capture.status, "error")
  assert.match(capture.message, /Bob output YAML not found/)
  assert.equal(fs.existsSync(canonicalOutputPath), false)

  const report = await validateBobOutput({ packageDir, bobOutputPath: canonicalOutputPath })
  assert.ok(report.errors.some((error) => error.includes("Bob output YAML not found")))
  assert.equal(report.warnings.some((warning) => warning.includes("review-package/bob-output.yaml")), false)

  const triageDir = path.join(workspace, ".bob-review", "human-triage")
  const triage = await generateHumanTriage({ packageDir, bobOutputPath: canonicalOutputPath, outDir: triageDir })
  assert.equal(triage.status, "error")
  assert.match(triage.message, /Bob output YAML not found/)
})

test("captureBobOutput rejects multiple YAML output candidates", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bob-review-multiple-yaml-"))
  const outputPath = path.join(root, ".bob-review", "bob-output", "bob-output.yaml")
  const output = fs.readFileSync(bobOutputFixturePath, "utf8")
  const capture = await captureBobOutput({
    workspaceRoot: root,
    text: `\`\`\`yaml\n${output}\n\`\`\`\n\`\`\`yaml\n${output}\n\`\`\``,
    bobOutputPath: outputPath
  })

  assert.equal(capture.status, "error")
  assert.match(capture.message, /multiple YAML candidates/)
  assert.equal(fs.existsSync(outputPath), false)
})

test("generateHumanTriage reports a missing Bob output file without throwing ENOENT", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bob-review-missing-output-"))
  const result = await generateHumanTriage({
    packageDir: path.join(root, ".bob-review", "review-package"),
    bobOutputPath: path.join(root, ".bob-review", "bob-output", "bob-output.yaml"),
    outDir: path.join(root, ".bob-review", "human-triage")
  })

  assert.equal(result.status, "error")
  assert.match(result.message, /Bob output YAML not found/)
})

test("validateBobOutput rejects missing evidence ids and accepts package evidence", async () => {
  const outRoot = path.join(repoRoot, ".bob-review")
  fs.mkdirSync(outRoot, { recursive: true })
  const outDir = fs.mkdtempSync(path.join(outRoot, "review-validate-"))
  await preprocessReview({ workspaceRoot: repoRoot, inputPath: reviewInputPath, outDir, diffFixturePath })

  const validReport = await validateBobOutput({ packageDir: outDir, bobOutputPath: bobOutputFixturePath })
  assert.deepEqual(validReport.errors, [])

  const invalidPath = path.join(path.dirname(outDir), "invalid-output.yaml")
  const parsed = YAML.parse(fs.readFileSync(bobOutputFixturePath, "utf8"))
  parsed.findings[0].evidence[0].evidence_id = "MISSING-9999"
  fs.writeFileSync(invalidPath, YAML.stringify(parsed))

  const invalidReport = await validateBobOutput({ packageDir: outDir, bobOutputPath: invalidPath })
  assert.ok(invalidReport.errors.some((error) => error.includes("MISSING-9999")))
})

test("captureBobOutput and generateHumanTriage create review artifacts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bob-review-capture-"))
  const outputPath = path.join(root, ".bob-review", "bob-output", "bob-output.yaml")
  const output = YAML.parse(fs.readFileSync(bobOutputFixturePath, "utf8"))
  output.questions.push({
    id: "Q-001",
    category: "specification-clarification",
    summary: "timeout condition needs author confirmation",
    reason: "The fixture question checks question triage output.",
    suggested_action: "Ask the author whether timeout is in scope."
  })
  const capture = await captureBobOutput({
    workspaceRoot: root,
    text: `Here is the result.\n\n\`\`\`yaml\n${YAML.stringify(output)}\n\`\`\`\n`,
    bobOutputPath: outputPath
  })
  assert.equal(capture.status, "ok")
  assert.ok(fs.existsSync(outputPath))

  const triageDir = path.join(root, ".bob-review", "human-triage")
  await generateHumanTriage({ packageDir: path.join(root, ".bob-review", "review-package"), bobOutputPath: outputPath, outDir: triageDir })

  assert.ok(fs.existsSync(path.join(triageDir, "triage-result.yaml")))
  assert.match(fs.readFileSync(path.join(triageDir, "accepted-findings.md"), "utf8"), /PRE-/)
  assert.match(fs.readFileSync(path.join(triageDir, "questions-to-author.md"), "utf8"), /Q-/)
  assert.ok(fs.existsSync(path.join(triageDir, "rejected-findings.md")))
  assert.ok(fs.existsSync(path.join(triageDir, "follow-up-actions.md")))
})
