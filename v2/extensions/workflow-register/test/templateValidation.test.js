const assert = require("node:assert/strict")
const path = require("node:path")
const { test } = require("node:test")

const { readJson } = require("./helpers/sourceReader")

const outRoot = path.resolve(__dirname, "..", "out")
const {
  CUSTOMIZATION_SCHEMA_VERSION,
  PROJECT_PROFILE_SCHEMA_VERSION,
  TEMPLATE_SCHEMA_VERSION,
  validateProjectProfile,
  validateWorkflowCustomization,
  validateWorkflowTemplate
} = require(path.join(outRoot, "template", "templateValidation"))

function validTemplate(overrides = {}) {
  return {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    templateId: "process-code-precheck",
    templateVersion: "1.0.0",
    displayName: "コード事前チェック",
    description: "Phase 2 code precheck template.",
    baseWorkflowPath: ".bob/template-library/standard/process-code-precheck/WORKFLOW.md",
    supportedLanguages: ["c_cpp", "csharp"],
    supportedVcs: ["git", "bazaar"],
    requiredFiles: [".bob/process/process-catalog.yaml"],
    customizable: {
      title: true,
      description: true,
      inputDefaults: ["phase2ReviewInputPath", "textEncoding"],
      checklistPathInput: "checklistPath",
      promptSupplement: true,
      artifactOutputRoot: true,
      humanGate: true
    },
    locked: {
      guardrails: true,
      commandProviders: true,
      resultSinkTypes: true
    },
    ...overrides
  }
}

function validProjectProfile(overrides = {}) {
  return {
    schemaVersion: PROJECT_PROFILE_SCHEMA_VERSION,
    projectId: "alpha-product",
    displayName: "Alpha Product",
    targetLanguage: "c_cpp",
    vcs: { type: "bazaar", root: ".", noAliases: true },
    paths: {
      checklistPath: ".bob/process/checklists/code-precheck.yaml",
      artifactOutputRoot: ".bob-process-runs/{{run.id}}/alpha-product",
      uatEvidencePath: "docs/uat/evidence/alpha-product.md"
    },
    workflowPreferences: {
      requireHumanGate: true,
      stepReviewPauseAfter: "agentAndCommand"
    },
    ...overrides
  }
}

function validCustomization(overrides = {}) {
  return {
    schemaVersion: CUSTOMIZATION_SCHEMA_VERSION,
    customizationId: "alpha-code-precheck",
    templateId: "process-code-precheck",
    templateVersion: "1.0.0",
    baseTemplateHash: "sha256:abc123",
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

test("template metadata schema versions are exposed through tracked json schemas", () => {
  const templateSchema = readJson("schema", "bob-workflow-template.v1.schema.json")
  const profileSchema = readJson("schema", "bob-project-profile.v1.schema.json")
  const customizationSchema = readJson("schema", "bob-workflow-customization.v1.schema.json")

  assert.equal(templateSchema.properties.schemaVersion.const, TEMPLATE_SCHEMA_VERSION)
  assert.equal(profileSchema.properties.schemaVersion.const, PROJECT_PROFILE_SCHEMA_VERSION)
  assert.equal(customizationSchema.properties.schemaVersion.const, CUSTOMIZATION_SCHEMA_VERSION)
})

test("workflow template validator accepts locked core metadata and rejects unsafe paths", () => {
  const valid = validateWorkflowTemplate(validTemplate())
  assert.equal(valid.ok, true, valid.diagnostics.join("\n"))
  assert.equal(valid.template.templateId, "process-code-precheck")

  const invalid = validateWorkflowTemplate(validTemplate({ baseWorkflowPath: "../outside/WORKFLOW.md" }))
  assert.equal(invalid.ok, false)
  assert.match(invalid.diagnostics.join("\n"), /baseWorkflowPath: unsafe workspace path/)
})

test("project profile validator rejects unsupported language, vcs, and workspace escape", () => {
  const valid = validateProjectProfile(validProjectProfile())
  assert.equal(valid.ok, true, valid.diagnostics.join("\n"))
  assert.equal(valid.profile.vcs.noAliases, true)

  const invalid = validateProjectProfile(validProjectProfile({
    targetLanguage: "ruby",
    vcs: { type: "svn", root: "C:\\repo" },
    paths: { checklistPath: "../checklist.yaml", artifactOutputRoot: "/tmp/out" }
  }))
  assert.equal(invalid.ok, false)
  assert.match(invalid.diagnostics.join("\n"), /targetLanguage is not supported: ruby/)
  assert.match(invalid.diagnostics.join("\n"), /vcs.type is not supported: svn/)
  assert.match(invalid.diagnostics.join("\n"), /vcs.root: unsafe workspace path/)
  assert.match(invalid.diagnostics.join("\n"), /paths.checklistPath: unsafe workspace path/)
  assert.match(invalid.diagnostics.join("\n"), /paths.artifactOutputRoot: unsafe workspace path/)
})

test("project profile validator requires Bazaar no-aliases and human gate", () => {
  const invalid = validateProjectProfile(validProjectProfile({
    vcs: { type: "bazaar", root: "." },
    workflowPreferences: { requireHumanGate: false }
  }))
  assert.equal(invalid.ok, false)
  assert.match(invalid.diagnostics.join("\n"), /Bazaar project profile must assert bzr --no-aliases/)
  assert.match(invalid.diagnostics.join("\n"), /human gate must be explicitly required/)
})

test("workflow customization validator rejects forbidden core overrides and unsafe output paths", () => {
  const valid = validateWorkflowCustomization(validCustomization())
  assert.equal(valid.ok, true, valid.diagnostics.join("\n"))
  assert.equal(valid.customization.workflowName, "alpha-code-precheck")

  const invalid = validateWorkflowCustomization(validCustomization({
    customize: {
      ...validCustomization().customize,
      artifactOutputRoot: "..\\outside",
      guardrails: { allowedCommands: ["shell"] },
      resultSinkTypes: ["command"]
    }
  }))
  assert.equal(invalid.ok, false)
  assert.match(invalid.diagnostics.join("\n"), /customize.artifactOutputRoot: unsafe workspace path/)
  assert.match(invalid.diagnostics.join("\n"), /customize.guardrails is not customizable/)
  assert.match(invalid.diagnostics.join("\n"), /customize.resultSinkTypes is not customizable/)
})
