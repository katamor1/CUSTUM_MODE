const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const fsSync = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")
const yaml = require("js-yaml")

const { readJson, readSourceSet } = require("./helpers/sourceReader")

const outRoot = path.resolve(__dirname, "..", "out")
const repoRoot = path.resolve(__dirname, "..", "..", "..")
const { parseWorkflowMarkdown } = require(path.join(outRoot, "core", "parser"))
const { hashTemplateWorkflow } = require(path.join(outRoot, "template", "templateGenerator"))
const {
  checkReadinessCommand,
  generateWorkflowCommand,
  validateCustomizationCommand,
  validateLibraryCommand,
  validateProjectProfileCommand
} = require(path.join(outRoot, "commands", "templateCommands"))

const templateCommandIds = [
  "bobTemplate.validateLibrary",
  "bobTemplate.validateProjectProfile",
  "bobTemplate.validateCustomization",
  "bobTemplate.generateWorkflow",
  "bobTemplate.checkReadiness"
]

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "template-command-"))
}

async function copyFileInto(root, relativePath) {
  const source = path.join(repoRoot, relativePath)
  const target = path.join(root, relativePath)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.copyFile(source, target)
}

async function commandWorkspace(options = {}) {
  const root = await tempRoot()
  await copyFileInto(root, ".bob/template-library/standard/process-code-precheck/metadata.yaml")
  await copyFileInto(root, ".bob/template-library/standard/process-code-precheck/WORKFLOW.md")
  await copyFileInto(root, ".bob/process/process-catalog.yaml")
  await fs.mkdir(path.join(root, ".bob", "process", "checklists"), { recursive: true })
  if (options.checklist !== false) {
    await fs.writeFile(path.join(root, ".bob", "process", "checklists", "alpha-code-precheck.yaml"), "checks: []\n", "utf8")
  }
  if (options.uatEvidence !== false) {
    await fs.mkdir(path.join(root, "docs", "uat", "evidence"), { recursive: true })
    await fs.writeFile(path.join(root, "docs", "uat", "evidence", "alpha-product.md"), "# UAT evidence\n", "utf8")
  }
  const workflowText = await fs.readFile(path.join(root, ".bob", "template-library", "standard", "process-code-precheck", "WORKFLOW.md"), "utf8")
  const baseTemplateHash = hashTemplateWorkflow(workflowText)
  await fs.mkdir(path.join(root, ".bob", "template-profiles"), { recursive: true })
  await fs.mkdir(path.join(root, ".bob", "template-customizations"), { recursive: true })
  const projectProfile = {
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
    workflowPreferences: { requireHumanGate: true, stepReviewPauseAfter: "agentAndCommand" },
    ...(options.profileOverrides ?? {})
  }
  const customization = {
    schemaVersion: "bob-workflow-customization/v1",
    customizationId: "alpha-code-precheck",
    templateId: "process-code-precheck",
    templateVersion: "1.0.0",
    baseTemplateHash,
    projectId: "alpha-product",
    workflowName: "alpha-code-precheck",
    customize: {
      title: "Alpha コード事前チェック",
      description: "Alpha Product 向けコード事前チェック。",
      inputs: { defaults: { phase2ReviewInputPath: "review-input-alpha.yaml" } },
      checklist: { path: ".bob/process/checklists/alpha-code-precheck.yaml" },
      prompts: { supplement: "Bazaar 操作では bzr --no-aliases を使う。" },
      artifactOutputRoot: ".bob-process-runs/{{run.id}}/alpha-code-precheck",
      humanGate: { required: true, stepReviewPauseAfter: "agentAndCommand" }
    },
    ...(options.customizationOverrides ?? {})
  }
  await fs.writeFile(path.join(root, ".bob", "template-profiles", "alpha.yaml"), yaml.dump(projectProfile), "utf8")
  await fs.writeFile(path.join(root, ".bob", "template-customizations", "alpha.yaml"), yaml.dump(customization), "utf8")
  return root
}

test("template command metadata is activated, contributed, and registered", () => {
  const packageJson = readJson("package.json")
  const activationEvents = new Set(packageJson.activationEvents)
  const contributedCommands = new Set(packageJson.contributes.commands.map((command) => command.command))
  const paletteCommands = new Set(packageJson.contributes.menus.commandPalette.map((entry) => entry.command))
  const extensionSource = readSourceSet(["extensionWithAuthoring.ts"])

  for (const commandId of templateCommandIds) {
    assert.ok(activationEvents.has(`onCommand:${commandId}`), `${commandId} activation`)
    assert.ok(contributedCommands.has(commandId), `${commandId} contribution`)
    assert.ok(paletteCommands.has(commandId), `${commandId} palette`)
    assert.match(extensionSource, new RegExp(`registerCommand\\("${commandId.replace(".", "\\.")}"`))
  }
})

test("template customization studio command metadata is activated, contributed, and registered", () => {
  const commandId = "bobTemplate.openCustomizationStudio"
  const packageJson = readJson("package.json")
  const activationEvents = new Set(packageJson.activationEvents)
  const contributedCommands = new Set(packageJson.contributes.commands.map((command) => command.command))
  const paletteCommands = new Set(packageJson.contributes.menus.commandPalette.map((entry) => entry.command))
  const extensionSource = readSourceSet(["extensionWithAuthoring.ts"])

  assert.ok(activationEvents.has(`onCommand:${commandId}`), `${commandId} activation`)
  assert.ok(contributedCommands.has(commandId), `${commandId} contribution`)
  assert.ok(paletteCommands.has(commandId), `${commandId} palette`)
  assert.match(extensionSource, /openTemplateCustomizationStudio/)
  assert.match(extensionSource, new RegExp(`registerCommand\\(\\s*"${commandId.replace(".", "\\.")}"`))
})

test("template commands validate, generate workflow, and write readiness reports", async () => {
  const root = await commandWorkspace()
  const options = { workspaceRoot: root }
  const input = {
    templatePath: ".bob/template-library/standard/process-code-precheck/metadata.yaml",
    projectProfilePath: ".bob/template-profiles/alpha.yaml",
    customizationPath: ".bob/template-customizations/alpha.yaml"
  }

  const library = await validateLibraryCommand(input, options)
  assert.equal(library.status, "ok", library.diagnostics.join("\n"))
  assert.equal(library.template.templateId, "process-code-precheck")

  const profile = await validateProjectProfileCommand(input, options)
  assert.equal(profile.status, "ok", profile.diagnostics.join("\n"))
  assert.equal(profile.profile.projectId, "alpha-product")

  const customization = await validateCustomizationCommand(input, options)
  assert.equal(customization.status, "ok", customization.diagnostics.join("\n"))
  assert.equal(customization.customization.workflowName, "alpha-code-precheck")

  const generated = await generateWorkflowCommand(input, options)
  assert.equal(generated.status, "ok", generated.diagnostics.join("\n"))
  assert.equal(generated.relativePath, ".bob/workflows/alpha-code-precheck/WORKFLOW.md")
  const generatedText = await fs.readFile(path.join(root, generated.relativePath), "utf8")
  const parsed = parseWorkflowMarkdown({ sourceId: "workflow-register", filePath: generated.relativePath, text: generatedText })
  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))

  const readiness = await checkReadinessCommand(input, options)
  assert.equal(readiness.status, "ok", readiness.diagnostics.join("\n"))
  assert.equal(readiness.readiness.status, "pass", readiness.readiness.checks.map((check) => `${check.id}:${check.status}`).join("\n"))
  assert.ok(fsSync.existsSync(path.join(root, ".bob", "template-readiness", "alpha-product", "alpha-code-precheck-readiness.json")))
  assert.ok(fsSync.existsSync(path.join(root, ".bob", "template-readiness", "alpha-product", "alpha-code-precheck-readiness.md")))
})

test("readiness fails for workspace escape and missing checklist, and warns when UAT evidence is absent", async () => {
  const escapedRoot = await commandWorkspace({
    customizationOverrides: {
      customize: {
        artifactOutputRoot: "..\\outside",
        humanGate: { required: true }
      }
    }
  })
  const escaped = await checkReadinessCommand({
    templatePath: ".bob/template-library/standard/process-code-precheck/metadata.yaml",
    projectProfilePath: ".bob/template-profiles/alpha.yaml",
    customizationPath: ".bob/template-customizations/alpha.yaml"
  }, { workspaceRoot: escapedRoot })
  assert.equal(escaped.status, "ok", escaped.diagnostics.join("\n"))
  assert.equal(escaped.readiness.status, "fail")
  assert.match(JSON.stringify(escaped.readiness.checks), /customize.artifactOutputRoot: unsafe workspace path/)

  const missingChecklistRoot = await commandWorkspace({ checklist: false })
  const missingChecklist = await checkReadinessCommand({
    templatePath: ".bob/template-library/standard/process-code-precheck/metadata.yaml",
    projectProfilePath: ".bob/template-profiles/alpha.yaml",
    customizationPath: ".bob/template-customizations/alpha.yaml"
  }, { workspaceRoot: missingChecklistRoot })
  assert.equal(missingChecklist.status, "ok", missingChecklist.diagnostics.join("\n"))
  assert.equal(missingChecklist.readiness.status, "fail")
  assert.match(JSON.stringify(missingChecklist.readiness.checks), /required file is missing: \.bob\/process\/checklists\/alpha-code-precheck.yaml/)

  const noUatRoot = await commandWorkspace({ uatEvidence: false })
  const noUat = await checkReadinessCommand({
    templatePath: ".bob/template-library/standard/process-code-precheck/metadata.yaml",
    projectProfilePath: ".bob/template-profiles/alpha.yaml",
    customizationPath: ".bob/template-customizations/alpha.yaml"
  }, { workspaceRoot: noUatRoot })
  assert.equal(noUat.status, "ok", noUat.diagnostics.join("\n"))
  assert.equal(noUat.readiness.status, "warning")
  assert.match(JSON.stringify(noUat.readiness.checks), /UAT evidence is not present/)
})
