const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")
const yaml = require("js-yaml")

const outRoot = path.resolve(__dirname, "..", "out")
const repoRoot = path.resolve(__dirname, "..", "..", "..")
const { parseWorkflowMarkdown } = require(path.join(outRoot, "core", "parser"))
const { validateWorkflowTemplate } = require(path.join(outRoot, "template", "templateValidation"))
const {
  generateCustomizedWorkflow,
  hashTemplateWorkflow
} = require(path.join(outRoot, "template", "templateGenerator"))

const libraryRoot = path.join(repoRoot, ".bob", "template-library", "standard", "process-code-precheck")
const metadataPath = path.join(libraryRoot, "metadata.yaml")
const workflowPath = path.join(libraryRoot, "WORKFLOW.md")

function loadStandardTemplate() {
  return {
    metadata: yaml.load(fs.readFileSync(metadataPath, "utf8")),
    workflowText: fs.readFileSync(workflowPath, "utf8")
  }
}

function frontMatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  assert.ok(match, "workflow must contain YAML front matter")
  return { fields: yaml.load(match[1]), body: match[2] }
}

function profile(overrides = {}) {
  return {
    schemaVersion: "bob-project-profile/v1",
    projectId: "alpha-product",
    displayName: "Alpha Product",
    targetLanguage: "c_cpp",
    vcs: { type: "bazaar", root: ".", noAliases: true },
    paths: {
      checklistPath: ".bob/process/checklists/alpha-code-precheck.yaml",
      artifactOutputRoot: ".bob-process-runs/{{run.id}}/alpha-code-precheck",
      uatEvidencePath: "docs/uat/evidence/alpha-product.md"
    },
    workflowPreferences: {
      requireHumanGate: true,
      stepReviewPauseAfter: "agentAndCommand"
    },
    ...overrides
  }
}

function customization(baseTemplateHash, overrides = {}) {
  return {
    schemaVersion: "bob-workflow-customization/v1",
    customizationId: "alpha-code-precheck",
    templateId: "process-code-precheck",
    templateVersion: "1.0.0",
    baseTemplateHash,
    projectId: "alpha-product",
    workflowName: "alpha-code-precheck",
    customize: {
      title: "Alpha コード事前チェック",
      description: "Alpha Product 向けに入力既定値と出力先を調整したコード事前チェック。",
      inputs: { defaults: { phase2ReviewInputPath: "review-input-alpha.yaml", textEncoding: "shift_jis" } },
      checklist: { path: ".bob/process/checklists/alpha-code-precheck.yaml" },
      prompts: {
        supplement: "Alpha Product の共通用語を確認し、Bazaar 操作では bzr --no-aliases を使う。",
        terms: { subsystem: "販売管理" }
      },
      artifactOutputRoot: ".bob-process-runs/{{run.id}}/alpha-code-precheck",
      humanGate: { required: true, stepReviewPauseAfter: "agentAndCommand" }
    },
    ...overrides
  }
}

test("standard process-code-precheck template library is tracked and parses cleanly", () => {
  const { metadata, workflowText } = loadStandardTemplate()
  const validation = validateWorkflowTemplate(metadata)
  assert.equal(validation.ok, true, validation.diagnostics.join("\n"))

  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: ".bob/template-library/standard/process-code-precheck/WORKFLOW.md",
    text: workflowText
  })
  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
  assert.equal(parsed.workflow.name, "process-code-precheck")
  assert.ok(parsed.workflow.guardrails.allowedCommands.includes("vscode.executeCommand"))
  assert.ok(parsed.workflow.guardrails.allowedCommands.includes("bobCodeConsistency.preprocess"))
  assert.equal(parsed.workflow.stepReview.enabled, true)
})

test("generator applies allowed customization and preserves locked command and sink surfaces", () => {
  const { metadata, workflowText } = loadStandardTemplate()
  const baseTemplateHash = hashTemplateWorkflow(workflowText)
  const generated = generateCustomizedWorkflow({
    template: metadata,
    projectProfile: profile(),
    customization: customization(baseTemplateHash),
    baseWorkflowText: workflowText,
    customizationPath: ".bob/template-customizations/alpha-code-precheck.yaml"
  })
  assert.equal(generated.ok, true, generated.diagnostics.join("\n"))
  assert.equal(generated.relativePath, ".bob/workflows/alpha-code-precheck/WORKFLOW.md")
  assert.equal(generated.baseTemplateHash, baseTemplateHash)

  const baseFields = frontMatter(workflowText).fields
  const generatedFields = frontMatter(generated.workflowMarkdown).fields
  assert.deepEqual(generatedFields.guardrails, baseFields.guardrails, "guardrails must remain locked")
  assert.equal(generatedFields.name, "alpha-code-precheck")
  assert.equal(generatedFields.title, "Alpha コード事前チェック")
  assert.equal(generatedFields.description, "Alpha Product 向けに入力既定値と出力先を調整したコード事前チェック。")
  assert.equal(generatedFields.inputs.phase2ReviewInputPath.default, "review-input-alpha.yaml")
  assert.equal(generatedFields.inputs.textEncoding.default, "shift_jis")
  assert.equal(generatedFields.inputs.checklistPath.default, ".bob/process/checklists/alpha-code-precheck.yaml")
  assert.equal(generatedFields.stepReview.enabled, true)
  assert.equal(generatedFields.stepReview.requireAcceptBeforeNext, true)
  assert.equal(generatedFields.stepReview.pauseAfter, "agentAndCommand")
  assert.deepEqual(generatedFields["x-bob-template"], {
    templateId: "process-code-precheck",
    templateVersion: "1.0.0",
    baseTemplateHash,
    projectId: "alpha-product",
    customizationPath: ".bob/template-customizations/alpha-code-precheck.yaml"
  })
  assert.ok(generatedFields.artifacts.some((artifact) => artifact.path === ".bob-process-runs/{{run.id}}/alpha-code-precheck/review-result.yaml"))
  const resultSinks = generatedFields.steps
    .filter((step) => step.type === "result")
    .flatMap((step) => step.result.sinks)
  assert.deepEqual(new Set(resultSinks.map((sink) => sink.type)), new Set(["file"]))
  assert.ok(generated.workflowMarkdown.includes("プロジェクト固有補足"))
  assert.ok(generated.workflowMarkdown.includes("Alpha Product の共通用語"))
  assert.ok(generated.workflowMarkdown.includes("- subsystem: 販売管理"))

  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: generated.relativePath,
    text: generated.workflowMarkdown
  })
  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
  assert.equal(parsed.workflow.name, "alpha-code-precheck")
})

test("generator rejects base template hash mismatch and unknown input defaults", () => {
  const { metadata, workflowText } = loadStandardTemplate()
  const baseTemplateHash = hashTemplateWorkflow(workflowText)
  const mismatch = generateCustomizedWorkflow({
    template: metadata,
    projectProfile: profile(),
    customization: customization("sha256:wrong"),
    baseWorkflowText: workflowText,
    customizationPath: ".bob/template-customizations/alpha-code-precheck.yaml"
  })
  assert.equal(mismatch.ok, false)
  assert.match(mismatch.diagnostics.join("\n"), /baseTemplateHash mismatch/)

  const unknownInput = generateCustomizedWorkflow({
    template: metadata,
    projectProfile: profile(),
    customization: customization(baseTemplateHash, {
      customize: {
        ...customization(baseTemplateHash).customize,
        inputs: { defaults: { unknownPath: "x" } }
      }
    }),
    baseWorkflowText: workflowText,
    customizationPath: ".bob/template-customizations/alpha-code-precheck.yaml"
  })
  assert.equal(unknownInput.ok, false)
  assert.match(unknownInput.diagnostics.join("\n"), /customize.inputs.defaults.unknownPath is not allowed/)
})
