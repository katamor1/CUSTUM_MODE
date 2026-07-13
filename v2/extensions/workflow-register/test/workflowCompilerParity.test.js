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

function workflowText(name, steps, extra = "") {
  return `---
schemaVersion: workflow-register/v1
name: ${name}
description: ${name} workflow.
${extra}${extra ? "\n" : ""}steps:
${steps}
---
# ${name}
`
}

const duplicateStepWorkflow = workflowText("duplicate-step", `  - id: analyze
    title: Analyze once
    type: manual
  - id: analyze
    title: Analyze twice
    type: manual`)

const validWorkflow = workflowText("valid-workflow", `  - id: collect
    title: Collect
    type: command
    action:
      provider: sample.collect
    resultKey: context
  - id: analyze
    title: Analyze
    type: agent
    prompt: Analyze the context.
    includeState:
      - context
    resultKey: analysis`)

const unknownStateWorkflow = workflowText("unknown-state", `  - id: analyze
    title: Analyze
    type: agent
    prompt: Analyze.
    includeState:
      - missingContext`)

const invalidBranchWorkflow = workflowText("invalid-branch", `  - id: collect
    title: Collect
    type: command
    action:
      provider: sample.collect
    resultKey: context
  - id: review
    title: Review
    type: manual
    transition:
      decisions:
        - id: retry
          when:
            stateKey: context.status
            equals: retry
          goto: missing-step`, `branching:
  enabled: true
  loops: []`)

const reservedResultKeyWorkflow = workflowText("reserved-result", `  - id: collect
    title: Collect
    type: command
    action:
      provider: sample.collect
    resultKey: workflow.approval.collect`)

const duplicateResultKeyWorkflow = workflowText("duplicate-result", `  - id: first
    title: First
    type: command
    action:
      provider: sample.first
    resultKey: shared
  - id: second
    title: Second
    type: command
    action:
      provider: sample.second
    resultKey: shared`)

const warningWorkflow = workflowText("warning-workflow", `  - id: review
    title: Review
    type: manual`, "unknownTopLevel: true")

const stableOrderingWorkflow = workflowText("stable-order", `  - id: duplicate
    title: First
    type: command
    action:
      provider: sample.first
    resultKey: workflow.reserved
  - id: duplicate
    title: Second
    type: agent
    prompt: Analyze.
    includeState:
      - missing`)

const legacyWorkflow = `---
name: legacy-workflow
description: Legacy workflow.
---
# Legacy workflow
`

test("registration rejects a schema-valid workflow with duplicate step ids before adaptation", async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "workflow-compiler-registration-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const invalidPath = await writeWorkflow(root, "duplicate-step", duplicateStepWorkflow)
  resetRuntime(root, [invalidPath])

  const { validateWorkflowText } = require(path.join(outRoot, "core", "workflowValidator.js"))
  const validation = validateWorkflowText({
    sourceId: "workflow-register",
    filePath: ".bob/workflows/duplicate-step/WORKFLOW.md",
    text: duplicateStepWorkflow,
    strict: true
  })
  assert.equal(validation.ok, false)
  const semanticErrors = validation.diagnostics
    .filter((item) => item.severity === "error")
    .map((item) => item.message)
  assert.ok(semanticErrors.some((message) => message.includes("Duplicate step id 'analyze'")))

  const { loadWorkspaceWorkflows } = requireWithVscode("workflowDefinitionLoader.js")
  const loaded = await loadWorkspaceWorkflows("workflow-register")
  let runnerCreations = 0
  const { registerWorkflows } = requireWithVscode("workflowRegistrationService.js")
  const update = await registerWorkflows({
    createRunner: () => {
      runnerCreations += 1
      return runnerStub()
    }
  })
  const missingRegistrationDiagnostics = semanticErrors.filter(
    (message) => !update.result.lines.some((line) => line.includes(message))
  )

  assert.deepEqual({
    adaptedWorkflows: loaded.workflows.length,
    runnerCreations,
    registerSourceCalls: runtime.registerSourceCalls,
    registerWorkflowCalls: runtime.registeredWorkflows.length,
    missingRegistrationDiagnostics
  }, {
    adaptedWorkflows: 0,
    runnerCreations: 0,
    registerSourceCalls: 0,
    registerWorkflowCalls: 0,
    missingRegistrationDiagnostics: []
  })
})

test("mixed registration adapts and registers only valid workflow documents", async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "workflow-compiler-mixed-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const validPath = await writeWorkflow(root, "valid-workflow", validWorkflow)
  const invalidPath = await writeWorkflow(root, "duplicate-step", duplicateStepWorkflow)
  resetRuntime(root, [validPath, invalidPath])

  const { loadWorkspaceWorkflows } = requireWithVscode("workflowDefinitionLoader.js")
  const loaded = await loadWorkspaceWorkflows("workflow-register")
  let runnerCreations = 0
  const { registerWorkflows } = requireWithVscode("workflowRegistrationService.js")
  await registerWorkflows({
    createRunner: () => {
      runnerCreations += 1
      return runnerStub()
    }
  })

  assert.deepEqual({
    loadedIds: loaded.workflows.map((workflow) => workflow.id),
    coreIds: loaded.coreWorkflows.map((workflow) => workflow.id),
    runnerCreations,
    registeredIds: runtime.registeredWorkflows.map((workflow) => workflow.getId())
  }, {
    loadedIds: ["workflow-register.valid-workflow"],
    coreIds: ["workflow-register.valid-workflow"],
    runnerCreations: 1,
    registeredIds: ["workflow-register.valid-workflow"]
  })
  assert.ok(loaded.diagnostics.some((line) => line.includes("Duplicate step id 'analyze'")))
})

test("workspace validation compiles the same nested marker-root document set as registration", async (t) => {
  const workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "workflow-compiler-nested-"))
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }))
  const nestedRoot = path.join(workspaceRoot, "nested-repository")
  const validPath = await writeWorkflow(nestedRoot, "valid-workflow", validWorkflow)
  const invalidPath = await writeWorkflow(nestedRoot, "duplicate-step", duplicateStepWorkflow)
  resetRuntime(workspaceRoot, [validPath, invalidPath])

  const { discoverWorkspaceWorkflowFiles } = requireWithVscode("workflowDiscovery.js")
  const discovered = await discoverWorkspaceWorkflowFiles()
  const { loadWorkspaceWorkflows } = requireWithVscode("workflowDefinitionLoader.js")
  const loaded = await loadWorkspaceWorkflows("workflow-register")
  const reports = []
  const diagnosticsByFile = new Map()
  const diagnostics = {
    clear: () => diagnosticsByFile.clear(),
    set: (uri, result) => diagnosticsByFile.set(uri.fsPath, result)
  }
  const { compileWorkflowDocument } = require(path.join(outRoot, "core", "workflowCompiler.js"))
  const { validateTextDocument, validateWorkspaceWorkflows } = requireWithVscode(path.join("commands", "validateWorkflow.js"))
  await validateWorkspaceWorkflows({
    sourceId: "workflow-register",
    diagnostics,
    showMarkdownReport: async (title, summary, lines) => reports.push({ title, summary, lines })
  })

  assert.deepEqual(discovered.files.map((candidate) => candidate.file.fsPath).sort(), [invalidPath, validPath].sort())
  assert.deepEqual([...diagnosticsByFile.keys()].sort(), [invalidPath, validPath].sort())
  assert.deepEqual(diagnosticsByFile.get(invalidPath), compileWorkflowDocument({
    sourceId: "workflow-register",
    filePath: ".bob/workflows/duplicate-step/WORKFLOW.md",
    text: duplicateStepWorkflow,
    strict: true
  }))
  assert.deepEqual(diagnosticsByFile.get(validPath), compileWorkflowDocument({
    sourceId: "workflow-register",
    filePath: ".bob/workflows/valid-workflow/WORKFLOW.md",
    text: validWorkflow,
    strict: true
  }))
  assert.equal(reports[0].summary, "2 workflow file(s); 1 error(s); 0 warning(s).")
  assert.deepEqual(loaded.workflows.map((workflow) => workflow.id), ["workflow-register.valid-workflow"])
  assert.ok(loaded.diagnostics.some((line) => line.includes("Duplicate step id 'analyze'")))

  const currentResult = validateTextDocument({
    uri: { fsPath: invalidPath },
    getText: () => duplicateStepWorkflow
  }, { sourceId: "workflow-register", diagnostics })
  assert.deepEqual(currentResult, compileWorkflowDocument({
    sourceId: "workflow-register",
    filePath: ".bob/workflows/duplicate-step/WORKFLOW.md",
    text: duplicateStepWorkflow
  }))
})

test("explicit current and workspace validation match strict registration diagnostics for warning-only workflows", async (t) => {
  const workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "workflow-compiler-strict-parity-"))
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }))
  const warningPath = await writeWorkflow(workspaceRoot, "warning-workflow", warningWorkflow)
  resetRuntime(workspaceRoot, [warningPath])

  const document = {
    uri: { fsPath: warningPath },
    getText: () => warningWorkflow
  }
  runtime.activeTextEditor = { document }
  const currentReports = []
  const currentDiagnostics = new Map()
  const workspaceReports = []
  const workspaceDiagnostics = new Map()
  const { compileWorkflowDocument, formatWorkflowDiagnostics } = require(path.join(outRoot, "core", "workflowCompiler.js"))
  const {
    validateCurrentWorkflow,
    validateTextDocument,
    validateWorkspaceWorkflows
  } = requireWithVscode(path.join("commands", "validateWorkflow.js"))
  const expected = compileWorkflowDocument({
    sourceId: "workflow-register",
    filePath: ".bob/workflows/warning-workflow/WORKFLOW.md",
    text: warningWorkflow,
    strict: true
  })

  const currentResult = validateTextDocument(document, {
    sourceId: "workflow-register",
    diagnostics: {
      set: (uri, result) => currentDiagnostics.set(uri.fsPath, result)
    }
  })
  await validateCurrentWorkflow({
    sourceId: "workflow-register",
    diagnostics: {
      set: (uri, result) => currentDiagnostics.set(uri.fsPath, result)
    },
    showMarkdownReport: async (title, summary, lines) => currentReports.push({ title, summary, lines })
  })
  await validateWorkspaceWorkflows({
    sourceId: "workflow-register",
    diagnostics: {
      clear: () => workspaceDiagnostics.clear(),
      set: (uri, result) => workspaceDiagnostics.set(uri.fsPath, result)
    },
    showMarkdownReport: async (title, summary, lines) => workspaceReports.push({ title, summary, lines })
  })

  const { loadWorkspaceWorkflows } = requireWithVscode("workflowDefinitionLoader.js")
  const loaded = await loadWorkspaceWorkflows("workflow-register")
  const { registerWorkflows } = requireWithVscode("workflowRegistrationService.js")
  const registered = await registerWorkflows({ createRunner: runnerStub })
  const expectedLines = formatWorkflowDiagnostics(expected)

  assert.equal(expected.ok, false)
  assert.deepEqual(currentResult, expected)
  assert.deepEqual(currentDiagnostics.get(warningPath), expected)
  assert.deepEqual(workspaceDiagnostics.get(warningPath), expected)
  assert.deepEqual(currentReports, [{
    title: "Current Workflow Validation",
    summary: "1 workflow file; 1 error(s); 0 warning(s).",
    lines: expectedLines
  }])
  assert.deepEqual(workspaceReports, [{
    title: "Workspace Workflow Validation",
    summary: "1 workflow file(s); 1 error(s); 0 warning(s).",
    lines: expectedLines
  }])
  assert.deepEqual(loaded.workflows, [])
  assert.deepEqual(loaded.coreWorkflows, [])
  assert.deepEqual(loaded.diagnostics.slice(-expectedLines.length), expectedLines)
  assert.deepEqual(registered.coreWorkflows, [])
  assert.deepEqual(registered.result.lines.slice(-expectedLines.length), expectedLines)
  assert.equal(runtime.registerSourceCalls, 0)
  assert.deepEqual(runtime.registeredWorkflows, [])
})

test("CI workflow contract paths include the canonical compiler source", () => {
  const ciWorkflow = fs.readFileSync(path.resolve(__dirname, "..", "..", "..", ".github", "workflows", "workflow-contracts.yml"), "utf8")
  assert.equal(ciWorkflow.match(/extensions\/workflow-register\/src\/core\/workflowCompiler\.ts/g)?.length, 2)
})

test("formatted parser diagnostics include their file path exactly once", async (t) => {
  const { compileWorkflowDocument, formatWorkflowDiagnostics } = require(path.join(outRoot, "core", "workflowCompiler.js"))
  const filePath = ".bob/workflows/sample/WORKFLOW.md"
  const cases = [
    {
      name: "missing front matter",
      text: "not a workflow",
      severity: "error",
      message: "missing YAML front matter."
    },
    {
      name: "invalid YAML syntax",
      text: "---\nname: [\n---\n",
      severity: "error",
      messagePrefix: "invalid YAML:"
    },
    {
      name: "schema failure",
      text: "---\nschemaVersion: workflow-register/v1\ndescription: Missing name.\nsteps: []\n---\n",
      severity: "error",
      message: "/ must have required property 'name'."
    },
    {
      name: "parser warning",
      text: warningWorkflow,
      severity: "warning",
      message: "unknown top-level field 'unknownTopLevel'."
    },
    {
      name: "parser info",
      text: workflowText("sample", "  []"),
      severity: "info",
      message: "workflow-register.sample; schemaVersion=workflow-register/v1; steps=0"
    }
  ]

  for (const item of cases) {
    await t.test(item.name, () => {
      const result = compileWorkflowDocument({ sourceId: "workflow-register", filePath, text: item.text })
      const diagnostic = result.diagnostics.find((candidate) => candidate.severity === item.severity)
      assert.ok(diagnostic)
      if (item.message) assert.equal(diagnostic.message, item.message)
      if (item.messagePrefix) assert.ok(diagnostic.message.startsWith(item.messagePrefix))
      const formatted = formatWorkflowDiagnostics({ ...result, diagnostics: [diagnostic] })[0]
      assert.equal(countOccurrences(formatted, `${filePath}: `), 1, formatted)
    })
  }
})

test("parser diagnostic normalization preserves matching path text inside the message body", () => {
  const { compileWorkflowDocument, formatWorkflowDiagnostics } = require(path.join(outRoot, "core", "workflowCompiler.js"))
  const filePath = ".bob/workflows/sample/WORKFLOW.md"
  const embeddedPathWorkflow = workflowText("embedded-path", "  []", `"${filePath}: note": true`)
  const result = compileWorkflowDocument({ sourceId: "workflow-register", filePath, text: embeddedPathWorkflow })
  const warning = result.diagnostics.find((item) => item.severity === "warning")

  assert.ok(warning)
  assert.equal(warning.message, `unknown top-level field '${filePath}: note'.`)
  assert.equal(
    formatWorkflowDiagnostics({ ...result, diagnostics: [warning] })[0],
    `- warning: ${filePath}: unknown top-level field '${filePath}: note'.`
  )
})

test("workflow compiler owns parse, semantic, strict, catalog, and diagnostic parity", () => {
  const { compileWorkflowDocument } = require(path.join(outRoot, "core", "workflowCompiler.js"))
  const { parseWorkflowMarkdown } = require(path.join(outRoot, "core", "parser"))
  const { validateWorkflowText } = require(path.join(outRoot, "core", "workflowValidator.js"))
  const base = {
    sourceId: "workflow-register",
    filePath: ".bob/workflows/sample/WORKFLOW.md"
  }

  for (const [text, expectedMessage] of [
    [duplicateStepWorkflow, "Duplicate step id 'analyze'"],
    [unknownStateWorkflow, "includeState references unknown resultKey 'missingContext'"],
    [invalidBranchWorkflow, "goto references unknown step 'missing-step'"],
    [reservedResultKeyWorkflow, "uses the reserved workflow state namespace"],
    [duplicateResultKeyWorkflow, "resultKey 'shared' conflicts"]
  ]) {
    const result = compileWorkflowDocument({ ...base, text })
    assert.equal(result.ok, false)
    assert.ok(result.workflow, "schema-valid semantic failures retain their normalized workflow")
    assert.ok(result.diagnostics.some((item) => item.message.includes(expectedMessage)), expectedMessage)
    assert.deepEqual(validateWorkflowText({ ...base, text }), result)
  }

  const missingFrontMatter = compileWorkflowDocument({ ...base, text: "not a workflow" })
  const invalidSchema = compileWorkflowDocument({
    ...base,
    text: "---\nschemaVersion: workflow-register/v1\ndescription: Missing name.\nsteps: []\n---\n"
  })
  assert.equal(missingFrontMatter.ok, false)
  assert.equal(missingFrontMatter.workflow, undefined)
  assert.equal(invalidSchema.ok, false)
  assert.equal(invalidSchema.workflow, undefined)

  const relaxed = compileWorkflowDocument({ ...base, text: warningWorkflow })
  const strict = compileWorkflowDocument({ ...base, text: warningWorkflow, strict: true })
  assert.equal(relaxed.ok, true)
  assert.ok(relaxed.diagnostics.some((item) => item.severity === "warning"))
  assert.equal(strict.ok, false)
  assert.ok(strict.diagnostics.some((item) => item.severity === "error" && item.message.includes("unknown top-level field")))

  const catalogOptional = compileWorkflowDocument({ ...base, text: validWorkflow, strict: true })
  const catalogEnforced = compileWorkflowDocument({
    ...base,
    text: validWorkflow,
    strict: true,
    availableActionProviders: []
  })
  assert.equal(catalogOptional.ok, true)
  assert.equal(catalogEnforced.ok, false)
  assert.ok(catalogEnforced.diagnostics.some((item) => item.message.includes("unsupported action provider 'sample.collect'")))

  const ordered = compileWorkflowDocument({ ...base, text: stableOrderingWorkflow })
  const repeated = compileWorkflowDocument({ ...base, text: stableOrderingWorkflow })
  assert.deepEqual(repeated.diagnostics, ordered.diagnostics)
  assert.deepEqual(ordered.diagnostics, [...ordered.diagnostics].sort(compareDiagnostics))

  for (const text of [validWorkflow, legacyWorkflow]) {
    const parsed = parseWorkflowMarkdown({ ...base, text })
    const compiled = compileWorkflowDocument({ ...base, text })
    const withBom = compileWorkflowDocument({ ...base, text: `\uFEFF${text}` })
    assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
    assert.equal(compiled.ok, true, compiled.diagnostics.map((item) => item.message).join("\n"))
    assert.equal(compiled.workflow.id, parsed.workflow.id)
    assert.equal(compiled.workflow.schemaVersion, parsed.workflow.schemaVersion)
    assert.equal(compiled.workflow.definitionHash, parsed.workflow.definitionHash)
    assert.equal(withBom.workflow.definitionHash, parsed.workflow.definitionHash)
  }
})

test("cross-document duplicate workflow ids remain qualified outside the document compiler", () => {
  const { compileWorkflowDocument } = require(path.join(outRoot, "core", "workflowCompiler.js"))
  const { qualifyDuplicateWorkflowIds } = requireWithVscode("workflowAdapter.js")
  const first = compileWorkflowDocument({
    sourceId: "workflow-register",
    filePath: ".bob/workflows/valid-workflow/WORKFLOW.md",
    text: validWorkflow
  }).workflow
  const second = compileWorkflowDocument({
    sourceId: "workflow-register",
    filePath: ".bob/workflows/valid-workflow/WORKFLOW.md",
    text: validWorkflow
  }).workflow
  first.workflowRoot = "C:/workspace/first"
  second.workflowRoot = "C:/workspace/second"
  const coreWorkflows = [first, second]

  qualifyDuplicateWorkflowIds([], coreWorkflows)

  assert.equal(coreWorkflows[0].logicalWorkflowId, "workflow-register.valid-workflow")
  assert.equal(coreWorkflows[1].logicalWorkflowId, "workflow-register.valid-workflow")
  assert.notEqual(coreWorkflows[0].id, coreWorkflows[1].id)
})

function compareDiagnostics(left, right) {
  const severity = { error: 0, warning: 1, info: 2 }
  return severity[left.severity] - severity[right.severity]
    || compareText(String(left.filePath ?? ""), String(right.filePath ?? ""))
    || compareText(left.message, right.message)
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function countOccurrences(value, search) {
  return value.split(search).length - 1
}
