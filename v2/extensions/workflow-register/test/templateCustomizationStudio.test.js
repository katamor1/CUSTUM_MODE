const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const fsSync = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")
const yaml = require("js-yaml")
const { readSourceSet } = require("./helpers/sourceReader")

const outRoot = path.resolve(__dirname, "..", "out")
const repoRoot = path.resolve(__dirname, "..", "..", "..")
const { parseWorkflowMarkdown } = require(path.join(outRoot, "core", "parser"))
const {
  buildProjectProfileFromStudioModel,
  checkReadinessFromStudioModel,
  createDefaultStudioModel,
  generateWorkflowFromStudioModel,
  listTemplateLibrary,
  previewWorkflowFromStudioModel,
  validateCustomizationFromStudioModel,
  validateProfileFromStudioModel,
  writeWorkflowDiffPreviewFromStudioModel
} = require(path.join(outRoot, "template", "templateStudioModel"))
const {
  renderTemplateCustomizationStudioHtml
} = require(path.join(outRoot, "webview", "templateCustomizationStudioHtml"))

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "template-studio-"))
}

async function copyFileInto(root, relativePath) {
  const source = path.join(repoRoot, relativePath)
  const target = path.join(root, relativePath)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.copyFile(source, target)
}

async function studioWorkspace() {
  const root = await tempRoot()
  await copyFileInto(root, ".bob/template-library/standard/process-code-precheck/metadata.yaml")
  await copyFileInto(root, ".bob/template-library/standard/process-code-precheck/WORKFLOW.md")
  return root
}

async function addReadinessFiles(root, model, options = {}) {
  await fs.mkdir(path.join(root, ".bob", "process", "checklists"), { recursive: true })
  await fs.writeFile(path.join(root, ".bob", "process", "process-catalog.yaml"), "schemaVersion: bob-process-catalog/v1\n", "utf8")
  if (options.checklist !== false) {
    await fs.writeFile(path.join(root, model.checklistPath), "checks: []\n", "utf8")
  }
  if (options.uatEvidence !== false) {
    await fs.mkdir(path.dirname(path.join(root, model.uatEvidencePath)), { recursive: true })
    await fs.writeFile(path.join(root, model.uatEvidencePath), "# UAT evidence\n", "utf8")
  }
}

test("template customization studio lists the tracked standard template and builds VCS-aware defaults", async () => {
  const root = await studioWorkspace()
  const library = await listTemplateLibrary(root)

  assert.equal(library.status, "ok", library.diagnostics.join("\n"))
  assert.equal(library.templates.length, 1)
  assert.equal(library.templates[0].templateId, "process-code-precheck")
  assert.equal(library.templates[0].templatePath, ".bob/template-library/standard/process-code-precheck/metadata.yaml")
  assert.ok(library.templates[0].baseTemplateHash.startsWith("sha256:"))

  const model = createDefaultStudioModel(library.templates[0])
  model.projectId = "alpha-product"
  model.displayName = "Alpha Product"
  assert.equal(model.vcsType, "git")
  assert.equal(model.promptSupplement, "")

  model.vcsType = "bazaar"
  const profile = buildProjectProfileFromStudioModel(model)
  assert.equal(profile.projectId, "alpha-product")
  assert.equal(profile.vcs.noAliases, true)
  assert.equal(profile.paths.checklistPath, ".bob/process/checklists/code-precheck.yaml")
})

test("template customization studio html exposes only allowed customization fields", async () => {
  const root = await studioWorkspace()
  const library = await listTemplateLibrary(root)
  const model = createDefaultStudioModel(library.templates[0])
  const html = renderTemplateCustomizationStudioHtml({
    cspSource: "vscode-resource:",
    nonce: "test-nonce",
    templates: library.templates,
    model
  })

  assert.match(html, /Template Library/)
  assert.match(html, /Customize/)
  assert.match(html, /Readiness/)
  assert.match(html, /title/)
  assert.match(html, /description/)
  assert.match(html, /checklist path/)
  assert.match(html, /prompt supplement/)
  assert.match(html, /phase artifact root/)
  assert.match(html, /human gate/)
  assert.match(html, /stepReview/)
  assert.match(html, /<textarea id="promptSupplement"><\/textarea>/)
  assert.doesNotMatch(html, /<select id="targetLanguage">(?:(?!<\/select>)[\s\S])*<option value="sql"/)
  assert.doesNotMatch(html, /<select id="vcsType">(?:(?!<\/select>)[\s\S])*<option value="none"/)
  assert.doesNotMatch(html, /guardrails/)
  assert.doesNotMatch(html, /command provider/)
  assert.doesNotMatch(html, /result sink type/)
  assert.doesNotMatch(html, /allowedCommands/)
})

test("template customization studio html preserves editable input default types", async () => {
  const root = await studioWorkspace()
  const library = await listTemplateLibrary(root)
  const model = createDefaultStudioModel(library.templates[0])
  model.inputDefaults = {
    reviewPackagePath: ".bob-review/review-package",
    maxRawDiffBytes: 4096,
    includeDocs: true,
    optionalFlag: null
  }

  const html = renderTemplateCustomizationStudioHtml({
    cspSource: "vscode-resource:",
    nonce: "test-nonce",
    templates: library.templates,
    model
  })

  assert.match(html, /data-input-default="reviewPackagePath" data-input-default-type="string"/)
  assert.match(html, /data-input-default="maxRawDiffBytes" data-input-default-type="number"/)
  assert.match(html, /data-input-default="includeDocs" data-input-default-type="boolean"/)
  assert.match(html, /data-input-default="optionalFlag" data-input-default-type="null"/)

  const source = readSourceSet(["webview/templateCustomizationStudioClientScript.ts"])
  assert.match(source, /readInputDefaultValue/)
  assert.match(source, /Number\.isFinite/)
})

test("template customization studio html escapes initial JSON inside script tags", () => {
  const html = renderTemplateCustomizationStudioHtml({
    cspSource: "vscode-resource:",
    nonce: "test-nonce",
    templates: [{
      templateId: "danger-template",
      templateVersion: "1.0.0",
      displayName: "</script><script>throw new Error('x')</script>",
      templatePath: ".bob/template-library/standard/process-code-precheck/metadata.yaml",
      baseWorkflowPath: ".bob/template-library/standard/process-code-precheck/WORKFLOW.md",
      baseTemplateHash: "sha256:test",
      supportedLanguages: ["c_cpp"],
      supportedVcs: ["bazaar"]
    }],
    model: {
      templatePath: ".bob/template-library/standard/process-code-precheck/metadata.yaml",
      templateId: "danger-template",
      templateVersion: "1.0.0",
      baseTemplateHash: "sha256:test",
      projectId: "alpha-product",
      displayName: "Alpha Product",
      targetLanguage: "c_cpp",
      vcsType: "bazaar",
      vcsRoot: ".",
      checklistPath: ".bob/process/checklists/code-precheck.yaml",
      artifactOutputRoot: ".bob-process-runs/{{run.id}}/code-precheck",
      uatEvidencePath: "docs/uat/evidence/alpha-product.md",
      workflowName: "alpha-code-precheck",
      title: "Line\u2028</script><script>alert(1)</script>",
      description: "Description",
      inputDefaults: {},
      promptSupplement: "",
      stepReviewPauseAfter: "agentAndCommand"
    }
  })

  assert.doesNotMatch(html, /<\/script><script>/)
  assert.match(html, /\\u003C\/script\\u003E/)
})

test("tracked standard template required files exist in the repository", async () => {
  const metadata = yaml.load(await fs.readFile(path.join(repoRoot, ".bob", "template-library", "standard", "process-code-precheck", "metadata.yaml"), "utf8"))

  for (const requiredFile of metadata.requiredFiles) {
    assert.equal(fsSync.existsSync(path.join(repoRoot, requiredFile)), true, `${requiredFile} exists`)
  }
})

test("template customization studio refreshes template library from listTemplates responses", async () => {
  const root = await studioWorkspace()
  const library = await listTemplateLibrary(root)
  const model = createDefaultStudioModel(library.templates[0])
  const html = renderTemplateCustomizationStudioHtml({
    cspSource: "vscode-resource:",
    nonce: "test-nonce",
    templates: library.templates,
    model
  })
  const source = readSourceSet(["webview/templateCustomizationStudioClientScript.ts"])

  assert.match(html, /id="templateList"/)
  assert.match(source, /message\.type === 'templateList'/)
  assert.match(source, /renderTemplateList/)
  assert.match(source, /message\.templates/)
})

test("template customization studio readiness html exposes status score checks and next actions", async () => {
  const root = await studioWorkspace()
  const library = await listTemplateLibrary(root)
  const model = createDefaultStudioModel(library.templates[0])
  const html = renderTemplateCustomizationStudioHtml({
    cspSource: "vscode-resource:",
    nonce: "test-nonce",
    templates: library.templates,
    model
  })

  assert.match(html, /id="readinessStatus"/)
  assert.match(html, /id="readinessScore"/)
  assert.match(html, /id="readinessChecks"/)
  assert.match(html, /id="readinessNextActions"/)
  assert.match(html, /nextActions/)
  assert.match(html, /status\.pass/)
  assert.match(html, /status\.warning/)
  assert.match(html, /status\.fail/)
})

test("template customization studio previews and generates a valid workflow with template metadata", async () => {
  const root = await studioWorkspace()
  const library = await listTemplateLibrary(root)
  const model = createDefaultStudioModel(library.templates[0])
  model.projectId = "alpha-product"
  model.displayName = "Alpha Product"
  model.workflowName = "alpha-code-precheck"
  model.title = "Alpha コード事前チェック"
  model.description = "Alpha Product 向けコード事前チェック。"
  model.checklistPath = ".bob/process/checklists/alpha-code-precheck.yaml"
  model.artifactOutputRoot = ".bob-process-runs/{{run.id}}/alpha-code-precheck"
  model.uatEvidencePath = "docs/uat/evidence/alpha-product.md"
  model.inputDefaults.phase2ReviewInputPath = "review-input-alpha.yaml"

  const preview = await previewWorkflowFromStudioModel(root, model)
  assert.equal(preview.status, "ok", preview.diagnostics.join("\n"))
  assert.match(preview.workflowMarkdown, /x-bob-template:/)
  assert.match(preview.workflowMarkdown, /templateId: process-code-precheck/)
  assert.match(preview.workflowMarkdown, /projectId: alpha-product/)
  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: preview.relativePath,
    text: preview.workflowMarkdown
  })
  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))

  const diffPreview = await writeWorkflowDiffPreviewFromStudioModel(root, model)
  assert.equal(diffPreview.status, "ok", diffPreview.diagnostics.join("\n"))
  assert.ok(fsSync.existsSync(path.join(root, diffPreview.previewPath)))

  const generated = await generateWorkflowFromStudioModel(root, model)
  assert.equal(generated.status, "ok", generated.diagnostics.join("\n"))
  assert.equal(generated.projectProfilePath, ".bob/template-profiles/alpha-product.yaml")
  assert.equal(generated.customizationPath, ".bob/template-customizations/alpha-code-precheck.yaml")
  assert.equal(generated.workflowPath, ".bob/workflows/alpha-code-precheck/WORKFLOW.md")
  assert.ok(fsSync.existsSync(path.join(root, generated.projectProfilePath)))
  assert.ok(fsSync.existsSync(path.join(root, generated.customizationPath)))
  assert.ok(fsSync.existsSync(path.join(root, generated.workflowPath)))

  const savedCustomization = yaml.load(await fs.readFile(path.join(root, generated.customizationPath), "utf8"))
  assert.equal(savedCustomization.baseTemplateHash, library.templates[0].baseTemplateHash)
  assert.equal(savedCustomization.customize.inputs.defaults.phase2ReviewInputPath, "review-input-alpha.yaml")
})

test("template customization studio applies Bazaar prompt supplement only for Bazaar profiles", async () => {
  const root = await studioWorkspace()
  const library = await listTemplateLibrary(root)
  const model = createDefaultStudioModel(library.templates[0])
  model.projectId = "alpha-product"
  model.workflowName = "alpha-code-precheck"
  model.promptSupplement = ""

  const gitPreview = await previewWorkflowFromStudioModel(root, model)
  assert.equal(gitPreview.status, "ok", gitPreview.diagnostics.join("\n"))
  assert.doesNotMatch(gitPreview.workflowMarkdown, /プロジェクト固有補足[\s\S]*bzr --no-aliases/)

  model.vcsType = "bazaar"
  const bazaarPreview = await previewWorkflowFromStudioModel(root, model)
  assert.equal(bazaarPreview.status, "ok", bazaarPreview.diagnostics.join("\n"))
  assert.match(bazaarPreview.workflowMarkdown, /プロジェクト固有補足[\s\S]*bzr --no-aliases/)
})

test("template customization studio rejects invalid profile choices and unsafe paths before writing", async () => {
  const root = await studioWorkspace()
  const library = await listTemplateLibrary(root)
  const model = createDefaultStudioModel(library.templates[0])
  model.targetLanguage = "ruby"

  const unsupportedLanguage = await previewWorkflowFromStudioModel(root, model)
  assert.equal(unsupportedLanguage.status, "error")
  assert.match(unsupportedLanguage.diagnostics.join("\n"), /targetLanguage is not supported: ruby/)

  model.targetLanguage = "c_cpp"
  model.vcsType = "svn"
  const unsupportedVcs = await previewWorkflowFromStudioModel(root, model)
  assert.equal(unsupportedVcs.status, "error")
  assert.match(unsupportedVcs.diagnostics.join("\n"), /vcs.type is not supported: svn/)

  model.vcsType = "git"
  model.artifactOutputRoot = "../outside"
  const unsafePath = await generateWorkflowFromStudioModel(root, model)
  assert.equal(unsafePath.status, "error")
  assert.match(unsafePath.diagnostics.join("\n"), /unsafe workspace path/)
  assert.equal(fsSync.existsSync(path.join(root, ".bob", "workflows", model.workflowName, "WORKFLOW.md")), false)
})

test("template customization studio backs up existing generated files before overwriting", async () => {
  const root = await studioWorkspace()
  const library = await listTemplateLibrary(root)
  const model = createDefaultStudioModel(library.templates[0])
  model.projectId = "alpha-product"
  model.workflowName = "alpha-code-precheck"

  await fs.mkdir(path.join(root, ".bob", "template-profiles"), { recursive: true })
  await fs.mkdir(path.join(root, ".bob", "template-customizations"), { recursive: true })
  await fs.mkdir(path.join(root, ".bob", "workflows", "alpha-code-precheck"), { recursive: true })
  await fs.writeFile(path.join(root, ".bob", "template-profiles", "alpha-product.yaml"), "old profile\n", "utf8")
  await fs.writeFile(path.join(root, ".bob", "template-customizations", "alpha-code-precheck.yaml"), "old customization\n", "utf8")
  await fs.writeFile(path.join(root, ".bob", "workflows", "alpha-code-precheck", "WORKFLOW.md"), "old workflow\n", "utf8")

  const generated = await generateWorkflowFromStudioModel(root, model)

  assert.equal(generated.status, "ok", generated.diagnostics.join("\n"))
  assert.match(generated.backupPaths.projectProfilePath, /\.backup-/)
  assert.match(generated.backupPaths.customizationPath, /\.backup-/)
  assert.match(generated.backupPaths.workflowPath, /WORKFLOW\.backup-/)
  assert.equal(await fs.readFile(path.join(root, generated.backupPaths.projectProfilePath), "utf8"), "old profile\n")
  assert.equal(await fs.readFile(path.join(root, generated.backupPaths.customizationPath), "utf8"), "old customization\n")
  assert.equal(await fs.readFile(path.join(root, generated.backupPaths.workflowPath), "utf8"), "old workflow\n")
})

test("template customization studio rejects generated writes through symlink escapes", async (t) => {
  const root = await studioWorkspace()
  const outside = await tempRoot()
  const library = await listTemplateLibrary(root)
  const model = createDefaultStudioModel(library.templates[0])
  model.projectId = "escape-project"
  model.workflowName = "escape-workflow"

  await fs.mkdir(path.join(root, ".bob"), { recursive: true })
  try {
    await fs.symlink(outside, path.join(root, ".bob", "template-profiles"), "junction")
  } catch {
    t.skip("symlink creation is not available in this environment")
    return
  }

  const generated = await generateWorkflowFromStudioModel(root, model)

  assert.equal(generated.status, "error")
  assert.match(generated.diagnostics.join("\n"), /symlink escape/i)
  assert.equal(fsSync.existsSync(path.join(outside, "escape-project.yaml")), false)
})

test("template customization studio panel wires preview generation and diff host messages", () => {
  const source = readSourceSet([
    "webview/templateCustomizationStudioPanel.ts",
    "webview/templateCustomizationStudioClientScript.ts"
  ])

  for (const messageType of ["previewWorkflow", "generateWorkflow", "showWorkflowDiff"]) {
    assert.match(source, new RegExp(messageType))
  }
  assert.match(source, /previewWorkflowFromStudioModel/)
  assert.match(source, /generateWorkflowFromStudioModel/)
  assert.match(source, /writeWorkflowDiffPreviewFromStudioModel/)
  assert.match(source, /vscode\.diff/)
})

test("template customization studio validates profile and customization and writes readiness reports", async () => {
  const root = await studioWorkspace()
  const library = await listTemplateLibrary(root)
  const model = createDefaultStudioModel(library.templates[0])
  model.projectId = "alpha-product"
  model.workflowName = "alpha-code-precheck"
  model.checklistPath = ".bob/process/checklists/alpha-code-precheck.yaml"
  model.uatEvidencePath = "docs/uat/evidence/alpha-product.md"
  await addReadinessFiles(root, model)

  const profile = validateProfileFromStudioModel(model)
  assert.equal(profile.status, "ok", profile.diagnostics.join("\n"))
  const customization = validateCustomizationFromStudioModel(model)
  assert.equal(customization.status, "ok", customization.diagnostics.join("\n"))

  const readiness = await checkReadinessFromStudioModel(root, model)
  assert.equal(readiness.status, "ok", readiness.diagnostics.join("\n"))
  assert.equal(readiness.readiness.status, "pass", readiness.readiness.nextActions.join("\n"))
  assert.equal(readiness.readinessJsonPath, ".bob/template-readiness/alpha-product/alpha-code-precheck-readiness.json")
  assert.equal(readiness.readinessMarkdownPath, ".bob/template-readiness/alpha-product/alpha-code-precheck-readiness.md")
  assert.ok(fsSync.existsSync(path.join(root, readiness.readinessJsonPath)))
  assert.ok(fsSync.existsSync(path.join(root, readiness.readinessMarkdownPath)))

  const report = yaml.load(await fs.readFile(path.join(root, readiness.readinessJsonPath), "utf8"))
  assert.equal(report.readiness.status, "pass")
  assert.equal(Array.isArray(report.readiness.checks), true)
})

test("template customization studio readiness warns when UAT evidence is absent", async () => {
  const root = await studioWorkspace()
  const library = await listTemplateLibrary(root)
  const model = createDefaultStudioModel(library.templates[0])
  model.projectId = "alpha-product"
  model.workflowName = "alpha-code-precheck"
  model.checklistPath = ".bob/process/checklists/alpha-code-precheck.yaml"
  model.uatEvidencePath = "docs/uat/evidence/alpha-product.md"
  await addReadinessFiles(root, model, { uatEvidence: false })

  const readiness = await checkReadinessFromStudioModel(root, model)
  assert.equal(readiness.status, "ok", readiness.diagnostics.join("\n"))
  assert.equal(readiness.readiness.status, "warning")
  assert.match(readiness.readiness.nextActions.join("\n"), /UAT evidence is not present/)
})

test("template customization studio panel wires validation readiness and report actions", () => {
  const source = readSourceSet([
    "webview/templateCustomizationStudioPanel.ts",
    "webview/templateCustomizationStudioClientScript.ts"
  ])

  for (const messageType of ["validateProfile", "validateCustomization", "checkReadiness", "openReadinessReport"]) {
    assert.match(source, new RegExp(messageType))
  }
  assert.match(source, /validateProfileFromStudioModel/)
  assert.match(source, /validateCustomizationFromStudioModel/)
  assert.match(source, /checkReadinessFromStudioModel/)
  assert.match(source, /readinessMarkdownPath/)
  assert.match(source, /showTextDocument/)
})
