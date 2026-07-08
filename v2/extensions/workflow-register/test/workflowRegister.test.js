const assert = require("node:assert/strict")
const { test } = require("node:test")
const {
  assertContributesCommand,
  readExtensionFile,
  readJson,
  readSrc,
  readSourceSet
} = require("./helpers/sourceReader")

test("package entry points at the compiled authoring wrapper", () => {
  const packageJson = readJson("package.json")
  const tsconfig = readJson("tsconfig.json")

  assert.equal(packageJson.main, "./out/extensionWithAuthoring.js")
  assert.deepEqual(tsconfig.include, ["src/**/*.ts"])
})

test("package exposes workflow authoring commands", () => {
  const packageJson = readJson("package.json")
  const source = readSrc("extensionWithAuthoring.ts")
  for (const command of [
    "workflowRegister.validateCurrentWorkflow",
    "workflowRegister.validateWorkspaceWorkflows",
    "workflowRegister.createWorkflowFromTemplate",
    "workflowRegister.inspectRunDiagnostics",
    "workflowRegister.designWorkflowWithAi",
    "workflowRegister.improveWorkflowWithAi",
    "workflowRegister.explainWorkflowDiagnostics"
  ]) {
    assertContributesCommand(packageJson, command)
    assert.match(source, new RegExp(command.replace(/\./g, "\\.")))
  }
})

test("workflow authoring wrapper wires a configurable AI provider command", () => {
  const packageJson = readJson("package.json")
  const source = readSrc("extensionWithAuthoring.ts")
  const setting = packageJson.contributes.configuration.properties["workflowRegister.aiProviderCommand"]

  assert.equal(setting.type, "string")
  assert.equal(setting.default, "")
  assert.match(source, /import \{ createConfiguredWorkflowAiProvider \} from "\.\/core\/workflowAiProviderFactory"/)
  assert.match(source, /config\(\)\.get<string>\("aiProviderCommand", ""\)/)
  assert.match(source, /executeCommand: \(command, input\) => vscode\.commands\.executeCommand\(command, input\)/)
  assert.match(source, /provider: aiProvider\(\)/)
})

test("package contributes standalone workflow launcher commands without a hard Bob dependency", () => {
  const packageJson = readJson("package.json")
  const readme = readExtensionFile("README.md")
  const source = readSourceSet([
    "extension.ts",
    "workflowInputPrompt.ts",
    "workflowRegisterService.ts",
    "workflowRuntimeFactory.ts"
  ])

  assert.equal(packageJson.extensionDependencies, undefined)
  assert.match(readme, /authoring \/ validation \/ standalone workflow execution は利用でき/)
  assert.match(readme, /IBM Bob 拡張: `IBM\.bob-code`（Bob UI 登録時のみ必須）/)
  for (const command of [
    "workflowRegister.runWorkflow",
    "workflowRegister.runWorkflowStep",
    "workflowRegister.startFromStepWithArtifacts",
    "workflowRegister.runNextStep",
    "workflowRegister.inspectRuns",
    "workflowRegister.resumeRun",
    "workflowRegister.retryCurrentStep",
    "workflowRegister.approveBranchCheckpoint",
    "workflowRegister.abortBranchCheckpoint",
    "workflowRegister.inspectBranching"
  ]) {
    assertContributesCommand(packageJson, command)
  }
  assert.match(source, /new WorkflowRegisterService\(String\(context\.extension\.packageJSON\.version \?\? "unknown"\)\)/)
  assert.match(source, /registerCommand\([\s\S]*"workflowRegister\.runWorkflowStep"[\s\S]*service\.runWorkflowStep\(workflowId, stepId, inputs\)/)
  assert.match(source, /registerCommand\([\s\S]*"workflowRegister\.startFromStepWithArtifacts"[\s\S]*service\.startFromStepWithArtifacts\(workflowId, stepId, sourceRunId, inputs\)/)
  assert.match(source, /registerCommand\("workflowRegister\.runNextStep", \(runId\?: string\) => service\.runNextStep\(runId\)\)/)
  assert.match(source, /registerCommand\("workflowRegister\.approveBranchCheckpoint", \(runId\?: string\) => service\.approveBranchCheckpoint\(runId\)\)/)
  assert.match(source, /registerCommand\("workflowRegister\.abortBranchCheckpoint", \(runId\?: string\) => service\.abortBranchCheckpoint\(runId\)\)/)
  assert.match(source, /registerCommand\("workflowRegister\.inspectBranching", \(runId\?: string\) => service\.inspectBranching\(runId\)\)/)
  assert.match(source, /startFromStepWithArtifacts: \(workflowId\?: string, stepId\?: string, sourceRunId\?: string, inputs\?: Record<string, unknown>\) => Promise<unknown>/)
  assert.match(source, /startFromStepWithArtifacts: \(workflowId, stepId, sourceRunId, inputs\) => service\.startFromStepWithArtifacts\(workflowId, stepId, sourceRunId, inputs\)/)
  assert.match(source, /approveBranchCheckpoint: \(runId\?: string\) => Promise<unknown>/)
  assert.match(source, /abortBranchCheckpoint: \(runId\?: string\) => Promise<unknown>/)
  assert.match(source, /inspectBranching: \(runId\?: string\) => Promise<unknown>/)
  assert.match(source, /approveBranchCheckpoint: \(runId\) => service\.approveBranchCheckpoint\(runId\)/)
  assert.match(source, /abortBranchCheckpoint: \(runId\) => service\.abortBranchCheckpoint\(runId\)/)
  assert.match(source, /inspectBranching: \(runId\) => service\.inspectBranching\(runId\)/)
  assert.match(source, /new FileRunStateStore\(\{ workspaceRoot, engineVersion: this\.options\.engineVersion \}\)/)
})

test("authoring wrapper delegates accept-and-run-next to the core next-step command without duplicate registration", () => {
  const wrapper = readSrc("extensionWithAuthoring.ts")
  const stepReview = readSrc("commands", "stepReview.ts")

  assert.doesNotMatch(wrapper, /registerCommand\("workflowRegister\.runNextStep"/)
  assert.match(stepReview, /vscode\.commands\.executeCommand\("workflowRegister\.runNextStep", accepted\.runId\)/)
  assert.doesNotMatch(stepReview, /vscode\.commands\.executeCommand\("workflowRegister\.resumeRun", accepted\.runId\)/)
})

test("accept-only review command tells operators the next step is not started", () => {
  const stepReview = readSrc("commands", "stepReview.ts")

  assert.match(stepReview, /const RUN_NEXT_STEP_LABEL = "次のステップを実行"/)
  assert.match(stepReview, /const OPEN_OPERATION_HUB_LABEL = "Operation Hub を開く"/)
  assert.match(stepReview, /次のステップはまだ開始されていません。/)
  assert.match(stepReview, /vscode\.commands\.executeCommand\("workflowRegister\.runNextStep", accepted\.runId\)/)
  assert.match(stepReview, /vscode\.commands\.executeCommand\("workflowRegister\.openOperationHub", \{ runId: accepted\.runId, stepId: accepted\.currentStep/)
})

test("package exposes task snapshot retention settings", () => {
  const packageJson = readJson("package.json")
  const properties = packageJson.contributes.configuration.properties

  assert.equal(properties["workflowRegister.taskSnapshots.enabled"].default, true)
  assert.equal(properties["workflowRegister.taskSnapshots.maxBytes"].default, 262144)
  assert.equal(properties["workflowRegister.taskSnapshots.maxPerRun"].default, 50)
  assert.equal(properties["workflowRegister.taskSnapshots.includeMessages"].default, false)
  assert.equal(properties["workflowRegister.taskSnapshots.pruneOnSave"].default, true)
})

test("package and extension wire the manual step panel command", () => {
  const packageJson = readJson("package.json")
  const extension = readSrc("extension.ts")
  const service = readSrc("workflowRegisterService.ts")
  const runner = readSrc("bobWorkflowRunner.ts")
  const factory = readSrc("workflowRuntimeFactory.ts")
  const panel = readSrc("webview", "manualStepPanel.ts")
  const panelHtml = readSrc("webview", "manualStepPanelHtml.ts")
  const panelViewModel = readSrc("webview", "manualStepViewModel.ts")

  assertContributesCommand(packageJson, "workflowRegister.openManualStepPanel")
  assert.ok(packageJson.activationEvents.includes("onCommand:workflowRegister.openManualStepPanel"))
  assert.deepEqual(
    packageJson.contributes.menus["view/item/context"].filter((item) => item.command === "workflowRegister.openManualStepPanel"),
    [{
      command: "workflowRegister.openManualStepPanel",
      when: "view == workflowRegister.runs && viewItem == workflowRun.held",
      group: "inline"
    }]
  )
  assert.match(extension, /registerCommand\("workflowRegister\.openManualStepPanel"[\s\S]*service\.openManualStepPanel/)
  assert.match(service, /new ManualStepPanelController/)
  assert.match(service, /completeStepByKeyResult/)
  assert.match(service, /openManualStepPanel\(runArg\?: RunCommandArg\)/)
  assert.match(panel, /class ManualStepPanelController/)
  assert.match(panel, /completeStep\(\{ activeKey, expectedRunId, expectedStepId \}\)/)
  assert.doesNotMatch(panel, /startsWith\("Completed:"\)/)
  assert.match(panelHtml, /function renderManualStepHtml/)
  assert.doesNotMatch(panelHtml, /confirmOnComplete/)
  assert.match(panelViewModel, /function buildManualStepActionViewModel/)
  assert.match(factory, /onManualStepHeld/)
  assert.match(runner, /onManualStepHeld/)
})

test("workflow-register does not silently use the first workspace folder in multi-root paths", () => {
  const sources = [
    readSourceSet([
      "extension.ts",
      "workflowDiscovery.ts",
      "workflowInputPrompt.ts",
      "workflowRegisterService.ts",
      "workflowRuntimeFactory.ts"
    ]),
    readSrc("commands", "createWorkflow.ts"),
    readSrc("commands", "designWorkflowWithAi.ts"),
    readSrc("commands", "improveWorkflowWithAi.ts"),
    readSrc("commands", "inspectRunDiagnostics.ts")
  ].join("\n")

  assert.doesNotMatch(sources, /workspaceFolders\?\.\[0\]|workspaceFolders\?\[0\]/)
  assert.match(sources, /findWorkflowRootCandidates/)
})

test("workflow authoring write paths enforce WORKFLOW.md document boundaries", () => {
  const improve = readSrc("commands", "improveWorkflowWithAi.ts")
  const edit = readSrc("commands", "editWorkflowInBuilder.ts")
  const panel = readSrc("webview", "workflowBuilderPanel.ts")

  assert.match(improve, /isWorkflowDocumentPath\(editor\.document\.uri\.fsPath\)/)
  assert.match(improve, /Open a \.bob\/workflows\/\*\/WORKFLOW\.md file/)
  assert.match(edit, /isWorkflowDocumentPath\(targetUri\.fsPath\)/)
  assert.match(panel, /validateWorkflowDocumentPath\(\{ workspaceRoot: this\.options\.workflowRoot, filePath: targetUri\.fsPath \}\)/)
  assert.ok(panel.indexOf("validateWorkflowDocumentPath({ workspaceRoot: this.options.workflowRoot, filePath: targetUri.fsPath })") < panel.indexOf("workspace.fs.writeFile(targetUri"))
})

test("workspace workflow validation uses strict diagnostics", () => {
  const source = readSrc("commands", "validateWorkflow.ts")

  assert.match(source, /validateWorkflowText\(\{ sourceId: options\.sourceId, filePath, text, strict: true \}\)/)
})

test("runtime dependencies are not excluded from VSIX packaging", () => {
  const packageJson = readJson("package.json")
  const vscodeIgnore = readExtensionFile(".vscodeignore")

  assert.equal(packageJson.scripts.package, "vsce package")
  assert.match(vscodeIgnore, /^node_modules\/\*\*$/m)
  for (const moduleName of [
    "ajv",
    "fast-deep-equal",
    "fast-uri",
    "json-schema-traverse",
    "require-from-string",
    "js-yaml",
    "argparse"
  ]) {
    assert.match(vscodeIgnore, new RegExp(`^!node_modules/${moduleName}/\\*\\*$`, "m"))
  }
})
