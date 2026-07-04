const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const { extensionRoot, readSrc } = require("./helpers/sourceReader")

test("core workflow model types are split by responsibility with model.ts kept as a compatibility shim", () => {
  const expectedModelFiles = ["modelSchema.ts", "modelProviders.ts", "modelSinks.ts", "modelRuntime.ts"]
  for (const fileName of expectedModelFiles) {
    assert.ok(fs.existsSync(path.join(extensionRoot, "src", "core", fileName)), `${fileName} must exist`)
  }

  const modelSource = readSrc("core", "model.ts")
  for (const fileName of expectedModelFiles) {
    assert.match(modelSource, new RegExp(`from "\\./${path.basename(fileName, ".ts")}"`))
  }
  assert.doesNotMatch(
    modelSource,
    /^\s*export\s+(interface|type)\s+\w+/m,
    "core/model.ts must re-export responsibility-specific model files instead of owning declarations"
  )
})

test("core parser uses a single directory barrel as its public import boundary", () => {
  assert.ok(fs.existsSync(path.join(extensionRoot, "src", "core", "parser", "index.ts")), "parser/index.ts must own the public parser export")
  assert.ok(!fs.existsSync(path.join(extensionRoot, "src", "core", "parser.ts")), "core/parser.ts must not duplicate the parser public export")

  const parserIndexSource = readSrc("core", "parser", "index.ts")
  assert.match(parserIndexSource, /export \{ parseWorkflowMarkdown \} from "\.\/parseWorkflowMarkdown"/)
})

test("workflow run command orchestration is split out of WorkflowRegisterService", () => {
  assert.ok(
    fs.existsSync(path.join(extensionRoot, "src", "workflowRunCommands.ts")),
    "workflowRunCommands.ts must own standalone run/resume command flow"
  )

  const serviceSource = readSrc("workflowRegisterService.ts")
  assert.match(serviceSource, /import \{ WorkflowRunCommandService \} from "\.\/workflowRunCommands"/)
  assert.match(serviceSource, /private readonly runCommands: WorkflowRunCommandService/)
  assert.match(serviceSource, /runWorkflow\(workflowId\?: string, inputs: Record<string, unknown> = \{\}\): Promise<unknown> \{[\s\S]*return this\.runCommands\.runWorkflow\(workflowId, inputs\)/)
  assert.doesNotMatch(serviceSource, /collectCoreWorkflowInputs/)
  assert.doesNotMatch(serviceSource, /pickRunSelection/)
})

test("core stage directories own schema, runtime, authoring, and snapshot implementations", () => {
  const stageFiles = [
    ["schema", "workflowSchema.ts", "workflowSchema.ts"],
    ["runtime", "runStateStore.ts", "runStateStore.ts"],
    ["runtime", "runControlStore.ts", "runControlStore.ts"],
    ["runtime", "resultSinkRegistry.ts", "resultSinkRegistry.ts"],
    ["authoring", "workflowAuthoringModel.ts", "workflowAuthoringModel.ts"],
    ["authoring", "workflowAuthoringSerializer.ts", "workflowAuthoringSerializer.ts"],
    ["authoring", "workflowAuthoringLoader.ts", "workflowAuthoringLoader.ts"],
    ["snapshots", "taskSnapshots.ts", "taskSnapshots.ts"]
  ]

  for (const [stage, fileName, rootFileName] of stageFiles) {
    const stagedPath = path.join(extensionRoot, "src", "core", stage, fileName)
    const rootPath = path.join(extensionRoot, "src", "core", rootFileName)
    assert.ok(fs.existsSync(stagedPath), `core/${stage}/${fileName} must own the implementation`)
    assert.ok(fs.existsSync(rootPath), `core/${rootFileName} compatibility shim must remain for existing imports`)

    const shimSource = readSrc("core", rootFileName)
    const moduleName = path.basename(fileName, ".ts")
    assert.match(shimSource, new RegExp(`export\\s+\\{[\\s\\S]*?\\}\\s+from "\\./${stage}/${moduleName}"`))
    assert.doesNotMatch(
      shimSource,
      /^\s*export\s+(class|function|async function|interface|type)\s+\w+/m,
      `core/${rootFileName} must delegate implementation to core/${stage}/${fileName}`
    )
  }
})
