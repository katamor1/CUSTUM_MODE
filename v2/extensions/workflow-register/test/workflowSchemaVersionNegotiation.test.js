const assert = require("node:assert/strict")
const fs = require("node:fs")
const fsp = require("node:fs/promises")
const Module = require("node:module")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const outRoot = path.resolve(__dirname, "..", "out")
let runtime

class RelativePattern {
  constructor(base, pattern) {
    this.base = typeof base === "string" ? base : base.fsPath
    this.pattern = pattern
  }
}

const vscode = {
  RelativePattern,
  workspace: {
    get workspaceFolders() {
      return runtime.workspaceFolders
    },
    getConfiguration: () => ({
      get: (key, fallback) => runtime.configuration[key] ?? fallback
    }),
    findFiles: async (pattern) => findWorkflowFiles(pattern),
    fs: {
      readFile: async (uri) => fsp.readFile(uri.fsPath)
    },
    asRelativePath: (uri) => relativeToWorkspace(uri.fsPath)
  },
  window: {
    get activeTextEditor() {
      return runtime.activeTextEditor
    },
    showErrorMessage: async () => undefined
  },
  commands: {
    executeCommand: async (...args) => {
      runtime.commandCalls.push(args)
      return undefined
    }
  },
  extensions: {
    getExtension: () => ({
      isActive: true,
      exports: {
        registerSource: () => {
          runtime.registerSourceCalls += 1
          return runtime.source
        }
      }
    })
  }
}

function requireWithVscode(relativePath) {
  const modulePath = path.join(outRoot, relativePath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "vscode") return vscode
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    return require(modulePath)
  } finally {
    Module._load = originalLoad
  }
}

function resetRuntime(workspaceRoot, files) {
  runtime = {
    workspaceFolders: [{ name: path.basename(workspaceRoot), uri: { fsPath: workspaceRoot } }],
    files: files.map((fsPath) => ({ fsPath })),
    configuration: { sourceId: "workflow-register", sourceName: "Workflow Register" },
    commandCalls: [],
    registerSourceCalls: 0,
    registeredWorkflows: [],
    activeTextEditor: undefined
  }
  runtime.source = {
    registerWorkflow: (workflow) => {
      runtime.registeredWorkflows.push(workflow)
      return true
    }
  }
}

async function writeWorkflow(root, name, text) {
  const filePath = path.join(root, ".bob", "workflows", name, "WORKFLOW.md")
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, text, "utf8")
  return filePath
}

function findWorkflowFiles(pattern) {
  const roots = pattern instanceof RelativePattern
    ? [path.resolve(pattern.base)]
    : runtime.workspaceFolders.map((folder) => path.resolve(folder.uri.fsPath))
  return runtime.files.filter((file) => roots.some((root) => {
    const relative = path.relative(root, file.fsPath).replace(/\\/g, "/")
    return /^\.bob\/workflows\/[^/]+\/WORKFLOW\.md$/.test(relative)
  }))
}

function relativeToWorkspace(filePath) {
  const root = runtime.workspaceFolders[0]?.uri.fsPath ?? ""
  return path.relative(root, filePath).replace(/\\/g, "/")
}

function runnerStub() {
  return {
    runSingleWorkflowStep: async () => true,
    runTodoStep: async () => true,
    runEngineStep: async () => true
  }
}

function workflowText(versionYaml, name = "schema-version") {
  return `---
${versionYaml ? `${versionYaml}\n` : ""}name: ${name}
description: Schema version workflow.
---
# Schema Version

Run the workflow.
`
}

const unsupportedMessage = (value) =>
  `unsupported schemaVersion ${JSON.stringify(value)}; supported values are 'workflow-register/v1' and 'legacy', or omit the field for legacy workflows.`

const nonStringMessage =
  "field 'schemaVersion' must be a string when provided; supported values are 'workflow-register/v1' and 'legacy'."

test("omitted and explicit legacy schema versions remain compatible", async (t) => {
  const { parseWorkflowMarkdown } = require(path.join(outRoot, "core", "parser"))
  const filePath = "C:/repo/.bob/workflows/legacy/WORKFLOW.md"

  for (const [name, versionYaml] of [
    ["omitted", ""],
    ["explicit legacy", "schemaVersion: legacy"]
  ]) {
    await t.test(name, () => {
      const parsed = parseWorkflowMarkdown({
        sourceId: "workflow-register",
        filePath,
        text: workflowText(versionYaml, `legacy-${name.replace(/\s+/g, "-")}`)
      })

      assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
      assert.equal(parsed.workflow.schemaVersion, "legacy")
    })
  }
})

test("unsupported schema version strings fail closed instead of using the legacy parser", async (t) => {
  const { parseWorkflowMarkdown } = require(path.join(outRoot, "core", "parser"))
  const filePath = "C:/repo/.bob/workflows/unsupported/WORKFLOW.md"
  const cases = [
    {
      name: "future version",
      versionYaml: "schemaVersion: workflow-register/v2",
      value: "workflow-register/v2"
    },
    {
      name: "case typo",
      versionYaml: "schemaVersion: workflow-register/V1",
      value: "workflow-register/V1"
    },
    {
      name: "escaped control text",
      versionYaml: "schemaVersion: \"workflow-register/v2\\npreview\"",
      value: "workflow-register/v2\npreview"
    }
  ]

  for (const item of cases) {
    await t.test(item.name, () => {
      const parsed = parseWorkflowMarkdown({
        sourceId: "workflow-register",
        filePath,
        text: workflowText(item.versionYaml, "unsupported-version")
      })

      assert.equal(parsed.ok, false)
      assert.deepEqual(parsed.diagnostics, [
        `- fail: ${filePath}: ${unsupportedMessage(item.value)}`
      ])
    })
  }
})

test("non-string schema version values fail closed", async (t) => {
  const { parseWorkflowMarkdown } = require(path.join(outRoot, "core", "parser"))
  const filePath = "C:/repo/.bob/workflows/invalid-version/WORKFLOW.md"
  const values = [
    ["number", "schemaVersion: 2"],
    ["boolean", "schemaVersion: false"],
    ["null", "schemaVersion: null"],
    ["sequence", "schemaVersion:\n  - workflow-register/v1"],
    ["mapping", "schemaVersion:\n  family: workflow-register\n  version: v1"]
  ]

  for (const [name, versionYaml] of values) {
    await t.test(name, () => {
      const parsed = parseWorkflowMarkdown({
        sourceId: "workflow-register",
        filePath,
        text: workflowText(versionYaml, "invalid-version")
      })

      assert.equal(parsed.ok, false)
      assert.deepEqual(parsed.diagnostics, [`- fail: ${filePath}: ${nonStringMessage}`])
    })
  }
})

test("unsupported schema versions fail identically before loading or registration", async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "workflow-version-negotiation-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const text = workflowText("schemaVersion: workflow-register/v2", "unsupported-version")
  const workflowPath = await writeWorkflow(root, "unsupported-version", text)
  resetRuntime(root, [workflowPath])

  const filePath = ".bob/workflows/unsupported-version/WORKFLOW.md"
  const expectedMessage = unsupportedMessage("workflow-register/v2")
  const { compileWorkflowDocument, formatWorkflowDiagnostics } = require(path.join(outRoot, "core", "workflowCompiler.js"))
  const expected = compileWorkflowDocument({
    sourceId: "workflow-register",
    filePath,
    text,
    strict: true
  })

  assert.equal(expected.ok, false)
  assert.equal(expected.workflow, undefined)
  assert.deepEqual(expected.diagnostics, [{ severity: "error", message: expectedMessage, filePath }])

  const diagnosticsByFile = new Map()
  const diagnostics = {
    clear: () => diagnosticsByFile.clear(),
    set: (uri, result) => diagnosticsByFile.set(uri.fsPath, result)
  }
  const { validateTextDocument, validateWorkspaceWorkflows } = requireWithVscode(path.join("commands", "validateWorkflow.js"))
  const documentResult = validateTextDocument({
    uri: { fsPath: workflowPath },
    getText: () => text
  }, { sourceId: "workflow-register", diagnostics })
  await validateWorkspaceWorkflows({
    sourceId: "workflow-register",
    diagnostics,
    showMarkdownReport: async () => undefined
  })

  const { loadWorkspaceWorkflows } = requireWithVscode("workflowDefinitionLoader.js")
  const loaded = await loadWorkspaceWorkflows("workflow-register")
  let runnerCreations = 0
  const { registerWorkflows } = requireWithVscode("workflowRegistrationService.js")
  const registered = await registerWorkflows({
    createRunner: () => {
      runnerCreations += 1
      return runnerStub()
    }
  })
  const expectedLines = formatWorkflowDiagnostics(expected)

  assert.deepEqual(documentResult, expected)
  assert.deepEqual(diagnosticsByFile.get(workflowPath), expected)
  assert.deepEqual(loaded.workflows, [])
  assert.deepEqual(loaded.coreWorkflows, [])
  assert.deepEqual(loaded.diagnostics.slice(-expectedLines.length), expectedLines)
  assert.deepEqual(registered.coreWorkflows, [])
  assert.deepEqual(registered.result.lines.slice(-expectedLines.length), expectedLines)
  assert.equal(runnerCreations, 0)
  assert.equal(runtime.registerSourceCalls, 0)
  assert.deepEqual(runtime.registeredWorkflows, [])
})
