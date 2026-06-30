const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const extensionRoot = path.resolve(__dirname, "..")

test("package entry points at the compiled authoring wrapper", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"))
  const tsconfig = JSON.parse(fs.readFileSync(path.join(extensionRoot, "tsconfig.json"), "utf8"))

  assert.equal(packageJson.main, "./out/extensionWithAuthoring.js")
  assert.deepEqual(tsconfig.include, ["src/**/*.ts"])
})

test("package exposes workflow authoring commands", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"))
  const commandIds = packageJson.contributes.commands.map((command) => command.command)
  const paletteIds = packageJson.contributes.menus.commandPalette.map((entry) => entry.command)
  const source = fs.readFileSync(path.join(extensionRoot, "src", "extensionWithAuthoring.ts"), "utf8")
  for (const command of [
    "workflowRegister.validateCurrentWorkflow",
    "workflowRegister.validateWorkspaceWorkflows",
    "workflowRegister.createWorkflowFromTemplate",
    "workflowRegister.inspectRunDiagnostics",
    "workflowRegister.designWorkflowWithAi",
    "workflowRegister.improveWorkflowWithAi",
    "workflowRegister.explainWorkflowDiagnostics"
  ]) {
    assert.ok(packageJson.activationEvents.includes(`onCommand:${command}`))
    assert.ok(commandIds.includes(command))
    assert.ok(paletteIds.includes(command))
    assert.match(source, new RegExp(command.replace(/\./g, "\\.")))
  }
})

test("workflow authoring wrapper wires a configurable AI provider command", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"))
  const source = fs.readFileSync(path.join(extensionRoot, "src", "extensionWithAuthoring.ts"), "utf8")
  const setting = packageJson.contributes.configuration.properties["workflowRegister.aiProviderCommand"]

  assert.equal(setting.type, "string")
  assert.equal(setting.default, "")
  assert.match(source, /import \{ createConfiguredWorkflowAiProvider \} from "\.\/core\/workflowAiProviderFactory"/)
  assert.match(source, /config\(\)\.get<string>\("aiProviderCommand", ""\)/)
  assert.match(source, /executeCommand: \(command, input\) => vscode\.commands\.executeCommand\(command, input\)/)
  assert.match(source, /provider: aiProvider\(\)/)
})

test("completeStep command can be called silently by companion extensions", () => {
  const source = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8")

  assert.match(source, /interface StepCompletionOptions \{[\s\S]*silent\?: boolean[\s\S]*\}/)
  assert.match(source, /registerCommand\("workflowRegister\.completeStep", \(options\?: StepCompletionOptions\) => service\.completeCurrentStep\(options\)\)/)
  assert.match(source, /async completeCurrentStep\(options: StepCompletionOptions = \{\}\): Promise<string>/)
  assert.match(source, /if \(!options\.silent\) await vscode\.window\.showInformationMessage\(message\)/)
  assert.match(source, /return message/)
})

test("activation schedules delayed workflow reload retries after Bob finishes startup", () => {
  const source = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8")

  assert.match(source, /const retryDelaysMs = \[3000, 10000\]/)
  assert.match(source, /setTimeout\(\(\) => service\.reload\(\{ showReport: false \}\)/)
})

test("package contributes standalone workflow launcher commands without a hard Bob dependency", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"))
  const commandIds = packageJson.contributes.commands.map((command) => command.command)
  const source = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8")

  assert.equal(packageJson.extensionDependencies, undefined)
  assert.ok(packageJson.activationEvents.includes("onCommand:workflowRegister.runWorkflow"))
  assert.ok(packageJson.activationEvents.includes("onCommand:workflowRegister.inspectRuns"))
  assert.ok(packageJson.activationEvents.includes("onCommand:workflowRegister.resumeRun"))
  assert.ok(packageJson.activationEvents.includes("onCommand:workflowRegister.retryCurrentStep"))
  assert.ok(commandIds.includes("workflowRegister.runWorkflow"))
  assert.ok(commandIds.includes("workflowRegister.inspectRuns"))
  assert.ok(commandIds.includes("workflowRegister.resumeRun"))
  assert.ok(commandIds.includes("workflowRegister.retryCurrentStep"))
  assert.match(source, /new WorkflowRegisterService\(String\(context\.extension\.packageJSON\.version \?\? "unknown"\)\)/)
  assert.match(source, /new FileRunStateStore\(\{ workspaceRoot, engineVersion: this\.engineVersion \}\)/)
})

test("package exposes task snapshot retention settings", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"))
  const properties = packageJson.contributes.configuration.properties

  assert.equal(properties["workflowRegister.taskSnapshots.enabled"].default, true)
  assert.equal(properties["workflowRegister.taskSnapshots.maxBytes"].default, 262144)
  assert.equal(properties["workflowRegister.taskSnapshots.maxPerRun"].default, 50)
  assert.equal(properties["workflowRegister.taskSnapshots.includeMessages"].default, true)
  assert.equal(properties["workflowRegister.taskSnapshots.pruneOnSave"].default, true)
})

test("standalone workflow launcher wires an AgentProvider through API or configured command", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"))
  const source = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8")

  assert.equal(packageJson.contributes.configuration.properties["workflowRegister.agentCommand"].type, "string")
  assert.match(source, /import \{ createCommandAgentProvider \} from "\.\/core\/agentProvider"/)
  assert.match(source, /registerAgentProvider: \(provider: AgentProvider\) => void/)
  assert.match(source, /registerAgentProvider: \(provider\) => service\.registerAgentProvider\(provider\)/)
  assert.match(source, /agentProvider: this\.agentProvider \?\? this\.createCommandAgentProvider\(\)/)
  assert.match(source, /createCommandAgentProvider\(\{[\s\S]*command: config\.get<string>\("agentCommand", ""\),[\s\S]*vscode\.commands\.executeCommand\(command, input\)/)
})

test("standalone workflow launcher uses the shared input resolver for conditional prompts", () => {
  const source = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8")

  assert.match(source, /import \{ collectWorkflowInputsWithResolver \} from "\.\/core\/inputCollector"/)
  assert.match(source, /return collectWorkflowInputsWithResolver\(\{[\s\S]*inputs: workflow\.inputs,[\s\S]*provided,[\s\S]*prompt: \(key, definition, required\) => this\.promptForInput\(key, definition, required\)[\s\S]*\}\)/)
  assert.doesNotMatch(source, /for \(const \[key, definition\] of Object\.entries\(workflow\.inputs\)\)/)
})

test("default action registry is domain agnostic", () => {
  const source = fs.readFileSync(path.join(extensionRoot, "src", "core", "actionRegistry.ts"), "utf8")

  assert.doesNotMatch(source, /bobBazaar\./)
  assert.match(source, /registry\.register\(\{[\s\S]*id: "vscode\.executeCommand"[\s\S]*options\.executeCommand\(command, \.\.\.args\)[\s\S]*\}\)/)
})

test("Bob workflow Todo execution delegates to the shared WorkflowEngine runner", () => {
  const source = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8")

  assert.match(source, /createBobWorkflow\(workflow, this\.createBobWorkflowRunner\(workflow\)\)/)
  assert.match(source, /class BobWorkflowEngineRunner/)
  assert.match(source, /runTodoStep\(todo: WorkflowTodoItem, index: number, task: BobWorkflowTask\): Promise<boolean> \{[\s\S]*executionMode: "singleStep"[\s\S]*stepId: todo\.id/)
  assert.match(source, /engine\.runWorkflow\(this\.options\.coreWorkflow, inputs, \{[\s\S]*executionMode: request\.executionMode[\s\S]*stepId: request\.stepId[\s\S]*\}\)/)
  assert.match(source, /createBobTaskSnapshotProvider\(task\)/)
  assert.match(source, /new FileTaskSnapshotStore\(/)
  assert.doesNotMatch(source, /async function runWorkflowStepCommand\(/)
  assert.doesNotMatch(source, /step\.command === "bobBazaar\./)
  assert.doesNotMatch(source, /Unsupported step command\. Add it to the workflow-register allowlist before use\./)
})

test("Engine preflight checks Bazaar repositories across multi-root workspaces", () => {
  const source = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8")

  assert.match(source, /import \{[\s\S]*findMarkerRoots[\s\S]*\} from "\.\/core\/workspaceRoots"/)
  assert.match(source, /private createPreflightChecks\(workspaceRoot: string\): NonNullable<WorkflowEngineOptions\["preflightChecks"\]>/)
  assert.match(source, /bazaarRepository: \(\) => this\.bazaarRepositoryAvailable\(workspaceRoot\)/)
  assert.match(source, /preflightChecks: this\.createPreflightChecks\(workspaceRoot\)/)
  assert.match(source, /preflightChecks: \(workspaceRoot\) => this\.createPreflightChecks\(workspaceRoot\)/)
  assert.match(source, /await findMarkerRoots\(folders, "\.bzr"\)/)
})

test("Bob registration deactivates the previous source before replacing workflows", () => {
  const source = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8")

  assert.match(source, /interface BobSourceLike \{[\s\S]*deactivate\?: \(\) => unknown[\s\S]*\}/)
  assert.match(source, /private registeredSource\?: BobSourceLike/)
  assert.match(source, /dispose\(\): void \{[\s\S]*void this\.deactivateRegisteredSource\(\)[\s\S]*\}/)
  assert.match(source, /if \(loaded\.workflows\.length === 0\) \{[\s\S]*await this\.deactivateRegisteredSource\(lines\)[\s\S]*this\.registeredIds\.clear\(\)[\s\S]*"setContext", "bob-code\.hasWorkflows", false[\s\S]*\}/)
  assert.match(source, /await this\.deactivateRegisteredSource\(lines\)[\s\S]*const sourceResult = await runAttempt\("registerSource\(sourceId, sourceName\)"/)
  assert.match(source, /this\.registeredSource = source/)
})

test("Bob registration treats a false registerWorkflow return as failed", () => {
  const source = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8")

  assert.match(source, /return \{ label, ok: value !== false, message: describeReturn\(value\), value \}/)
  assert.match(source, /const attempt = await runAttempt\(`source\.registerWorkflow\(\$\{workflow\.id\}\)`[\s\S]*if \(attempt\.ok\) \{[\s\S]*registeredIds\.add\(workflow\.id\)[\s\S]*registeredCount \+= 1[\s\S]*\}/)
})

test("workflow reload re-registers current workflows and clears Bob context when none remain", () => {
  const source = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8")

  assert.doesNotMatch(source, /this\.registeredIds\.has\(workflow\.id\)/)
  assert.doesNotMatch(source, /already registered in this extension host session/)
  assert.match(source, /if \(loaded\.workflows\.length === 0\) \{[\s\S]*this\.registeredIds\.clear\(\)[\s\S]*"setContext", "bob-code\.hasWorkflows", false[\s\S]*\}/)
  assert.match(source, /this\.registeredIds\.clear\(\)[\s\S]*for \(const id of registeredIds\) this\.registeredIds\.add\(id\)/)
  assert.match(source, /"setContext", "bob-code\.hasWorkflows", this\.registeredIds\.size > 0/)
})

test("Bob adapter resolves workflow inputs and passes them to command providers", () => {
  const source = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8")

  assert.match(source, /inputs: Record<string, WorkflowInputDefinition>/)
  assert.match(source, /inputs: core\.inputs/)
  assert.match(source, /workflowRoot: core\.workflowRoot/)
  assert.match(source, /collectBobWorkflowInputs\(workflow: WorkflowDefinition, provided: Record<string, unknown>\)/)
  assert.match(source, /extractTaskWorkflowInputs\(workflow, task\)/)
  assert.match(source, /collectWorkflowInputsWithResolver\(\{[\s\S]*inputs: workflow\.inputs,[\s\S]*provided,[\s\S]*prompt: \(key, definition, required\) => this\.promptForInput\(key, definition, required\)[\s\S]*\}\)/)
  assert.match(source, /createBobWorkflowRunner\(workflow: WorkflowDefinition\): BobWorkflowEngineRunner/)
  assert.match(source, /inputsProvider: \(task, provided\) => this\.collectBobWorkflowInputs\(workflow, \{[\s\S]*\.\.\.extractTaskWorkflowInputs\(workflow, task\)[\s\S]*\.\.\.provided[\s\S]*\}\)/)
  assert.match(source, /runId: run\.runId/)
  assert.match(source, /state: run\.state/)
  assert.doesNotMatch(source, /inputs: \{\}/)
})

test("Bob workflow chat messages include bounded workflow root context", () => {
  const source = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8")

  assert.match(source, /import \{ appendWorkflowContext \} from "\.\/workflowPromptContext"/)
  assert.match(source, /appendWorkflowContext\(lines, \{[\s\S]*workflowRoot: definition\.workflowRoot[\s\S]*workflowFile: definition\.workflowFile[\s\S]*workflowFolderName: definition\.workflowFolderName[\s\S]*stateEntries[\s\S]*\}\)/)
  assert.match(source, /buildCommandResultMessage\(this\.options\.definition, context\.todo, context\.index, commandResult, stateEntries\)/)
  assert.match(source, /buildCurrentTodoMessage\(definition, todo, index, stepDefinition, commandResult, stateEntries\)/)
})

test("Bob adapter applies guardrails to Todo, result, and legacy top-level commands", () => {
  const source = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8")
  const engine = fs.readFileSync(path.join(extensionRoot, "src", "core", "engine.ts"), "utf8")

  assert.match(source, /import \{ validateCommandGuardrails \} from "\.\/core\/guardrails"/)
  assert.match(engine, /import \{ validateCommandGuardrails \} from "\.\/guardrails"/)
  assert.match(source, /guardrails: WorkflowGuardrailsDefinition/)
  assert.match(source, /guardrails: core\.guardrails/)
  assert.match(engine, /validateCommandGuardrails\(workflow, step\.action\.provider\)/)
  assert.match(source, /validateCommandGuardrails\(\{ guardrails: active\.guardrails \}, step\.resultCommand\)/)
  assert.match(source, /actionRegistry: this\.actionRegistry/)
  assert.doesNotMatch(source, /vscode\.commands\.executeCommand\(definition\.command/)
})

test("Bob registration uses CoreWorkflowDefinition as the only parsed workflow source", () => {
  const source = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8")

  assert.match(source, /parseWorkflowMarkdown\(\{ sourceId, filePath: relativePath, text \}\)/)
  assert.match(source, /adaptCoreWorkflowForBob\(/)
  assert.doesNotMatch(source, /loadCoreWorkspaceWorkflows/)
  assert.doesNotMatch(source, /parseYamlFrontMatter\(split\.frontMatter\)/)
})

test("workflow-register does not silently use the first workspace folder in multi-root paths", () => {
  const sources = [
    fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8"),
    fs.readFileSync(path.join(extensionRoot, "src", "commands", "createWorkflow.ts"), "utf8"),
    fs.readFileSync(path.join(extensionRoot, "src", "commands", "designWorkflowWithAi.ts"), "utf8"),
    fs.readFileSync(path.join(extensionRoot, "src", "commands", "improveWorkflowWithAi.ts"), "utf8"),
    fs.readFileSync(path.join(extensionRoot, "src", "commands", "inspectRunDiagnostics.ts"), "utf8")
  ].join("\n")

  assert.doesNotMatch(sources, /workspaceFolders\?\.\[0\]|workspaceFolders\?\[0\]/)
  assert.match(sources, /findWorkflowRootCandidates/)
})

test("runtime dependencies are not excluded from VSIX packaging", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"))
  const vscodeIgnore = fs.readFileSync(path.join(extensionRoot, ".vscodeignore"), "utf8")

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
