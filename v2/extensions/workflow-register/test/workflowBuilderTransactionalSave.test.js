const assert = require("node:assert/strict")
const fs = require("node:fs")
const Module = require("node:module")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")
const vm = require("node:vm")

const { createAuthoringModelFromTemplate } = require("../out/core/workflowAuthoringDefaults")
const { loadAuthoringModelFromMarkdown } = require("../out/core/workflowAuthoringLoader")
const { serializeAuthoringModelToMarkdown } = require("../out/core/workflowAuthoringSerializer")
const { validateWorkflowText } = require("../out/core/workflowValidator")
const { renderWorkflowBuilderClientScript } = require("../out/webview/workflowBuilderClientScript")

function loadPanelWithVscode(vscode) {
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "vscode") return vscode
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const modulePath = require.resolve("../out/webview/workflowBuilderPanel")
    delete require.cache[modulePath]
    return require(modulePath).WorkflowBuilderPanel
  } finally {
    Module._load = originalLoad
  }
}

function existingWorkflow(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-builder-transaction-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const model = createAuthoringModelFromTemplate({
    name: "transactional-builder",
    title: "Transactional Builder",
    description: options.description ?? "Original workflow description.",
    template: "simple-agent"
  })
  const rendered = serializeAuthoringModelToMarkdown(model)
  const target = path.join(root, ...rendered.filePath.split("/"))
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, rendered.markdown)
  const loaded = loadAuthoringModelFromMarkdown({
    sourceId: "workflow-register",
    filePath: rendered.filePath,
    text: rendered.markdown
  })
  return { root, target, oldText: rendered.markdown, model: loaded.model }
}

function createPanelHarness(t) {
  const fixture = existingWorkflow(t)
  const state = {
    beforeBackupWrite: async () => undefined,
    beforeTargetWrite: async () => undefined,
    commands: [],
    copies: [],
    errors: [],
    information: [],
    onWarningMessage: () => undefined,
    posted: [],
    shownDocuments: [],
    warningResponses: [],
    warnings: []
  }
  let receiveMessage
  let disposeListener
  let disposed = false
  const uri = (fsPath) => ({ fsPath: path.resolve(fsPath) })
  const webview = {
    cspSource: "vscode-resource:",
    html: "",
    onDidReceiveMessage: (listener) => {
      receiveMessage = listener
      return { dispose: () => undefined }
    },
    postMessage: async (message) => {
      state.posted.push(message)
      return true
    }
  }
  const panel = {
    title: "",
    webview,
    onDidDispose: (listener) => {
      disposeListener = listener
      return { dispose: () => undefined }
    },
    reveal: () => undefined,
    dispose: () => {
      if (disposed) return
      disposed = true
      disposeListener?.()
    }
  }
  const vscode = {
    commands: {
      executeCommand: async (...args) => {
        state.commands.push(args)
        return undefined
      }
    },
    Uri: {
      file: (fsPath) => uri(fsPath),
      joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts))
    },
    ViewColumn: { One: 1 },
    window: {
      createWebviewPanel: () => panel,
      showErrorMessage: async (message) => { state.errors.push(message) },
      showInformationMessage: async (message) => { state.information.push(message) },
      showTextDocument: async (document) => { state.shownDocuments.push(document) },
      showWarningMessage: async (message) => {
        state.warnings.push(message)
        state.onWarningMessage(message)
        return state.warningResponses.shift()
      }
    },
    workspace: {
      fs: {
        copy: async (source, target, options) => {
          if (/^WORKFLOW\.backup-.*\.md$/.test(path.basename(target.fsPath))) {
            await state.beforeBackupWrite(target.fsPath)
          }
          state.copies.push({ source: source.fsPath, target: target.fsPath, options })
          await fs.promises.copyFile(
            source.fsPath,
            target.fsPath,
            options?.overwrite === false ? fs.constants.COPYFILE_EXCL : 0
          )
        },
        createDirectory: async (target) => {
          await fs.promises.mkdir(target.fsPath, { recursive: true })
        },
        delete: async (target) => {
          await fs.promises.rm(target.fsPath, { force: true })
        },
        readFile: async (target) => fs.promises.readFile(target.fsPath),
        stat: async (target) => fs.promises.stat(target.fsPath),
        writeFile: async (target, bytes) => {
          if (/^WORKFLOW\.backup-.*\.md$/.test(path.basename(target.fsPath))) {
            await state.beforeBackupWrite(target.fsPath)
          }
          if (path.basename(target.fsPath) === "WORKFLOW.md") {
            await state.beforeTargetWrite(target.fsPath)
          }
          await fs.promises.writeFile(target.fsPath, bytes)
        }
      },
      openTextDocument: async (target) => target
    }
  }
  const WorkflowBuilderPanel = loadPanelWithVscode(vscode)
  const builder = WorkflowBuilderPanel.createOrShow({
    extensionUri: uri(fixture.root),
    workflowRoot: fixture.root,
    sourceId: "workflow-register",
    mode: "edit",
    editingFilePath: fixture.target,
    originalText: fixture.oldText,
    initialModel: fixture.model
  })
  t.after(() => panel.dispose())
  const showFixture = (nextFixture) => WorkflowBuilderPanel.createOrShow({
    extensionUri: uri(nextFixture.root),
    workflowRoot: nextFixture.root,
    sourceId: "workflow-register",
    mode: "edit",
    editingFilePath: nextFixture.target,
    originalText: nextFixture.oldText,
    initialModel: nextFixture.model
  })
  return {
    ...fixture,
    builder,
    panel,
    showFixture,
    state,
    send: (message) => receiveMessage(message)
  }
}

function editedModel(model, description) {
  return {
    ...model,
    metadata: { ...model.metadata, description }
  }
}

function backupFiles(target) {
  return fs.readdirSync(path.dirname(target)).filter((name) => /^WORKFLOW\.backup-.*\.md$/.test(name))
}

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve))
}

function complexWorkflowModel() {
  return {
    metadata: {
      schemaVersion: "workflow-register/v1",
      name: "inactive-tabs",
      title: "Inactive Tabs",
      description: "Preserve every supported section without visiting its tab.",
      mode: "agent",
      workspaceRequired: true,
      hidden: false
    },
    inputs: [
      { id: "scope", type: "string", title: "Scope", required: true, prompt: true, default: null },
      { id: "limit", type: "number", title: "Limit", required: false, default: 0 },
      { id: "enabled", type: "boolean", title: "Enabled", required: false, default: false },
      { id: "style", type: "select", title: "Style", requiredWhen: "enabled == true", default: "concise", options: ["concise", "detailed"] }
    ],
    requires: { workspace: true, bob: { minVersion: "2.1.0" }, files: ["README.md"] },
    preflight: [{
      id: "check-readme",
      title: "Check README",
      required: true,
      checks: ["workflow.filesExist"],
      files: ["README.md"],
      failurePolicy: "stop"
    }],
    guardrails: { allowedCommandIds: ["sample.collect"] },
    branching: {
      enabled: true,
      loops: [{
        id: "retry-loop",
        title: "Retry loop",
        entryStep: "collect",
        maxIterations: 2,
        extensionSize: 1,
        checkpoint: { title: "Retry limit", message: "Review before extending." }
      }]
    },
    steps: [
      {
        id: "collect",
        title: "Collect",
        type: "command",
        action: { provider: "vscode.executeCommand", args: ["sample.collect"] },
        resultKey: "context"
      },
      {
        id: "review",
        title: "Review",
        type: "agent",
        includeState: ["context"],
        resultKey: "report",
        prompt: "Review the context.",
        transition: {
          decisions: [{
            id: "retry",
            when: { stateKey: "report", equals: "retry" },
            goto: "collect",
            loop: "retry-loop"
          }],
          default: "end"
        }
      }
    ],
    artifacts: [{ id: "report", producedBy: "review", path: ".bob/artifacts/report.md", schema: "report/v1" }],
    completion: { summary: "Done", includeArtifacts: true, validateResult: false },
    body: "# Inactive Tabs\n\nKeep the body.",
    unknownFrontMatter: {
      category: "review",
      futureConfig: { owner: "operator", flags: ["keep", "roundtrip"] }
    }
  }
}

function runBuilderClientWithoutVisitingTabs(initialModel) {
  const listeners = new Map()
  const messages = []
  const timers = new Map()
  let nextTimer = 1
  const elements = new Map()
  const element = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        checked: false,
        classList: { toggle: () => undefined },
        dataset: {},
        innerHTML: "",
        setAttribute: () => undefined,
        value: ""
      })
    }
    return elements.get(id)
  }
  const document = {
    addEventListener: (type, listener) => {
      const current = listeners.get(type) ?? []
      current.push(listener)
      listeners.set(type, current)
    },
    getElementById: element,
    querySelectorAll: () => []
  }
  const window = {
    addEventListener: (type, listener) => {
      const current = listeners.get(`window:${type}`) ?? []
      current.push(listener)
      listeners.set(`window:${type}`, current)
    }
  }
  const sandbox = {
    acquireVsCodeApi: () => ({ postMessage: (message) => messages.push(message) }),
    clearTimeout: (id) => timers.delete(id),
    confirm: () => true,
    console,
    document,
    editMode: true,
    model: JSON.parse(JSON.stringify(initialModel)),
    setTimeout: (callback) => {
      const id = nextTimer++
      timers.set(id, callback)
      return id
    },
    structuredClone,
    templates: [],
    window
  }

  vm.runInNewContext(renderWorkflowBuilderClientScript(), sandbox)
  for (const callback of [...timers.values()]) callback()
  for (const listener of listeners.get("click") ?? []) {
    listener({ target: { closest: () => ({ dataset: { action: "save" } }) } })
  }
  return messages.map((message) => JSON.parse(JSON.stringify(message)))
}

test("Builder cancel leaves the existing target, backups, documents, and reload untouched", async (t) => {
  const harness = createPanelHarness(t)
  harness.state.warningResponses.push(undefined)

  await harness.send({ type: "save", model: editedModel(harness.model, "Cancelled description.") })

  assert.equal(fs.readFileSync(harness.target, "utf8"), harness.oldText)
  assert.deepEqual(backupFiles(harness.target), [])
  assert.deepEqual(harness.state.commands, [])
  assert.deepEqual(harness.state.shownDocuments, [])
  assert.equal(harness.state.posted.some((message) => message.type === "saved"), false)
})

test("Builder confirmation backs up the exact old bytes before overwriting and reloading", async (t) => {
  const harness = createPanelHarness(t)
  harness.state.warningResponses.push("Apply changes")

  await harness.send({ type: "save", model: editedModel(harness.model, "Confirmed description.") })

  const backups = backupFiles(harness.target)
  assert.equal(backups.length, 1)
  assert.equal(fs.readFileSync(path.join(path.dirname(harness.target), backups[0]), "utf8"), harness.oldText)
  assert.match(fs.readFileSync(harness.target, "utf8"), /description: Confirmed description\./)
  assert.deepEqual(harness.state.commands, [["workflowRegister.reload"]])
  assert.equal(harness.state.shownDocuments.length, 1)
  assert.equal(harness.state.posted.some((message) => message.type === "saved"), true)
})

test("Builder rejects an external edit against originalText before backup, overwrite, or reload", async (t) => {
  const harness = createPanelHarness(t)
  const externalText = harness.oldText.replace("Original workflow description.", "External winner description.")
  fs.writeFileSync(harness.target, externalText)
  harness.state.warningResponses.push("Apply changes")

  await harness.send({ type: "save", model: editedModel(harness.model, "Stale builder description.") })

  assert.equal(fs.readFileSync(harness.target, "utf8"), externalText)
  assert.deepEqual(backupFiles(harness.target), [])
  assert.deepEqual(harness.state.commands, [])
  assert.deepEqual(harness.state.shownDocuments, [])
  assert.equal(harness.state.posted.some((message) => message.type === "saved"), false)
  assert.ok(
    [...harness.state.errors, ...harness.state.warnings].some((message) => /refresh|reopen|再読込|更新/i.test(message)),
    `expected refresh/reopen diagnostic, got ${JSON.stringify({ errors: harness.state.errors, warnings: harness.state.warnings })}`
  )
})

test("Builder preserves a target created while the missing-target Create confirmation is open", async (t) => {
  const harness = createPanelHarness(t)
  fs.unlinkSync(harness.target)
  const createPromptShown = deferred()
  const createDecision = deferred()
  harness.state.onWarningMessage = (message) => {
    if (/no longer exists.*create/i.test(message)) createPromptShown.resolve()
  }
  harness.state.warningResponses.push(createDecision.promise)

  const staleSave = harness.send({ type: "save", model: editedModel(harness.model, "Stale missing-target description.") })
  await createPromptShown.promise
  const externalText = harness.oldText.replace("Original workflow description.", "External creator wins.")
  fs.writeFileSync(harness.target, externalText)
  createDecision.resolve("Create")
  await staleSave

  assert.equal(fs.readFileSync(harness.target, "utf8"), externalText)
  assert.deepEqual(backupFiles(harness.target), [])
  assert.deepEqual(harness.state.commands, [])
  assert.deepEqual(harness.state.shownDocuments, [])
  assert.equal(harness.state.posted.some((message) => message.type === "saved"), false)
  assert.equal(harness.state.information.length, 0)
  assert.ok(
    harness.state.warnings.some((message) => /refresh|reopen|再読込|更新/i.test(message)),
    `expected refresh/reopen diagnostic, got ${JSON.stringify(harness.state.warnings)}`
  )

  fs.writeFileSync(harness.target, harness.oldText)
  harness.state.warningResponses.push("Apply changes")
  await harness.send({ type: "save", model: editedModel(harness.model, "Fresh missing-target retry.") })

  assert.match(fs.readFileSync(harness.target, "utf8"), /description: Fresh missing-target retry\./)
  assert.deepEqual(harness.state.commands, [["workflowRegister.reload"]])
  assert.equal(harness.state.posted.filter((message) => message.type === "saved").length, 1)
})

test("Builder creates the target when it is still missing after Create confirmation", async (t) => {
  const harness = createPanelHarness(t)
  fs.unlinkSync(harness.target)
  harness.state.warningResponses.push("Create")

  await harness.send({ type: "save", model: editedModel(harness.model, "Confirmed missing-target create.") })

  assert.match(fs.readFileSync(harness.target, "utf8"), /description: Confirmed missing-target create\./)
  assert.deepEqual(backupFiles(harness.target), [])
  assert.deepEqual(harness.state.commands, [["workflowRegister.reload"]])
  assert.equal(harness.state.shownDocuments.length, 1)
  assert.equal(harness.state.posted.filter((message) => message.type === "saved").length, 1)
})

test("Builder revalidates original bytes after a blocked backup and preserves the external winner", async (t) => {
  const harness = createPanelHarness(t)
  const backupStarted = deferred()
  const releaseBackup = deferred()
  let blockFirstBackup = true
  harness.state.beforeBackupWrite = async () => {
    if (!blockFirstBackup) return
    blockFirstBackup = false
    backupStarted.resolve()
    await releaseBackup.promise
  }
  harness.state.warningResponses.push("Apply changes")

  const staleSave = harness.send({ type: "save", model: editedModel(harness.model, "Stale builder description.") })
  await backupStarted.promise
  const externalText = harness.oldText.replace("Original workflow description.", "External winner during backup.")
  fs.writeFileSync(harness.target, externalText)
  releaseBackup.resolve()
  await staleSave

  assert.equal(fs.readFileSync(harness.target, "utf8"), externalText)
  assert.deepEqual(harness.state.commands, [])
  assert.deepEqual(harness.state.shownDocuments, [])
  assert.equal(harness.state.posted.some((message) => message.type === "saved"), false)
  assert.equal(harness.state.information.length, 0)
  assert.ok(
    harness.state.warnings.some((message) => /refresh|reopen|再読込|更新/i.test(message)),
    `expected refresh/reopen diagnostic, got ${JSON.stringify(harness.state.warnings)}`
  )

  fs.writeFileSync(harness.target, harness.oldText)
  harness.state.warningResponses.push("Apply changes")
  await harness.send({ type: "save", model: editedModel(harness.model, "Fresh retry description.") })

  assert.match(fs.readFileSync(harness.target, "utf8"), /description: Fresh retry description\./)
  assert.deepEqual(harness.state.commands, [["workflowRegister.reload"]])
  assert.equal(harness.state.posted.filter((message) => message.type === "saved").length, 1)
})

test("Builder serializes concurrent save messages for the same target", async (t) => {
  const harness = createPanelHarness(t)
  const backupStarted = deferred()
  const releaseBackup = deferred()
  let blockFirstBackup = true
  harness.state.beforeBackupWrite = async () => {
    if (!blockFirstBackup) return
    blockFirstBackup = false
    backupStarted.resolve()
    await releaseBackup.promise
  }
  harness.state.warningResponses.push("Apply changes", "Apply changes")

  const firstSave = harness.send({ type: "save", model: editedModel(harness.model, "First concurrent description.") })
  await backupStarted.promise
  const secondSave = harness.send({ type: "save", model: editedModel(harness.model, "Second concurrent description.") })
  await nextTurn()
  const warningCountWhileFirstSaveIsBlocked = harness.state.warnings.length
  releaseBackup.resolve()
  await Promise.all([firstSave, secondSave])

  assert.equal(warningCountWhileFirstSaveIsBlocked, 1)
  assert.match(fs.readFileSync(harness.target, "utf8"), /description: Second concurrent description\./)
  assert.deepEqual(harness.state.commands, [["workflowRegister.reload"], ["workflowRegister.reload"]])
  assert.equal(harness.state.posted.filter((message) => message.type === "saved").length, 2)
})

test("Builder aborts a queued save when the panel switches sessions before the operation starts", async (t) => {
  const harness = createPanelHarness(t)
  const sessionB = existingWorkflow(t, { description: "Session B original description." })
  harness.state.warningResponses.push("Apply changes", "Apply changes")

  const staleSessionASave = harness.send({ type: "save", model: editedModel(harness.model, "Stale session A description.") })
  harness.showFixture(sessionB)
  await staleSessionASave

  assert.equal(fs.readFileSync(harness.target, "utf8"), harness.oldText)
  assert.equal(fs.readFileSync(sessionB.target, "utf8"), sessionB.oldText)
  assert.deepEqual(backupFiles(harness.target), [])
  assert.deepEqual(backupFiles(sessionB.target), [])
  assert.deepEqual(harness.state.commands, [])
  assert.deepEqual(harness.state.shownDocuments, [])
  assert.equal(harness.state.posted.some((message) => message.type === "saved"), false)
  assert.deepEqual(harness.state.information, [])

  await harness.send({ type: "save", model: editedModel(sessionB.model, "Fresh session B description.") })

  assert.equal(fs.readFileSync(harness.target, "utf8"), harness.oldText)
  assert.match(fs.readFileSync(sessionB.target, "utf8"), /description: Fresh session B description\./)
  assert.equal(backupFiles(sessionB.target).length, 1)
  assert.deepEqual(harness.state.commands, [["workflowRegister.reload"]])
  assert.equal(harness.state.posted.filter((message) => message.type === "saved").length, 1)
})

test("Builder rolls back a backup and aborts when the panel switches sessions during backup", async (t) => {
  const harness = createPanelHarness(t)
  const sessionB = existingWorkflow(t, { description: "Session B original during backup." })
  const backupStarted = deferred()
  const releaseBackup = deferred()
  let blockFirstBackup = true
  harness.state.beforeBackupWrite = async () => {
    if (!blockFirstBackup) return
    blockFirstBackup = false
    backupStarted.resolve()
    await releaseBackup.promise
  }
  harness.state.warningResponses.push("Apply changes", "Apply changes")

  const staleSessionASave = harness.send({ type: "save", model: editedModel(harness.model, "Stale session A during backup.") })
  await backupStarted.promise
  harness.showFixture(sessionB)
  releaseBackup.resolve()
  await staleSessionASave

  assert.equal(fs.readFileSync(harness.target, "utf8"), harness.oldText)
  assert.equal(fs.readFileSync(sessionB.target, "utf8"), sessionB.oldText)
  assert.deepEqual(backupFiles(harness.target), [])
  assert.deepEqual(backupFiles(sessionB.target), [])
  assert.deepEqual(harness.state.commands, [])
  assert.deepEqual(harness.state.shownDocuments, [])
  assert.equal(harness.state.posted.some((message) => message.type === "saved"), false)
  assert.deepEqual(harness.state.information, [])

  await harness.send({ type: "save", model: editedModel(sessionB.model, "Fresh session B after backup switch.") })

  assert.equal(fs.readFileSync(harness.target, "utf8"), harness.oldText)
  assert.match(fs.readFileSync(sessionB.target, "utf8"), /description: Fresh session B after backup switch\./)
  assert.equal(backupFiles(sessionB.target).length, 1)
  assert.deepEqual(harness.state.commands, [["workflowRegister.reload"]])
  assert.equal(harness.state.posted.filter((message) => message.type === "saved").length, 1)
})

test("Builder reloads a committed save without sending stale UI when the panel switches sessions during target write", async (t) => {
  const harness = createPanelHarness(t)
  const sessionB = existingWorkflow(t, { description: "Session B original during target write." })
  const targetWriteStarted = deferred()
  const releaseTargetWrite = deferred()
  let blockFirstTargetWrite = true
  harness.state.beforeTargetWrite = async () => {
    if (!blockFirstTargetWrite) return
    blockFirstTargetWrite = false
    targetWriteStarted.resolve()
    await releaseTargetWrite.promise
  }
  harness.state.warningResponses.push("Apply changes", "Apply changes")

  const committedSessionASave = harness.send({ type: "save", model: editedModel(harness.model, "Committed session A description.") })
  await targetWriteStarted.promise
  harness.showFixture(sessionB)
  releaseTargetWrite.resolve()
  await committedSessionASave

  assert.match(fs.readFileSync(harness.target, "utf8"), /description: Committed session A description\./)
  assert.equal(fs.readFileSync(sessionB.target, "utf8"), sessionB.oldText)
  assert.equal(backupFiles(harness.target).length, 1)
  assert.deepEqual(backupFiles(sessionB.target), [])
  assert.deepEqual(harness.state.commands, [["workflowRegister.reload"]])
  assert.deepEqual(harness.state.shownDocuments, [])
  assert.equal(harness.state.posted.some((message) => message.type === "saved"), false)
  assert.deepEqual(harness.state.information, [])

  await harness.send({ type: "save", model: editedModel(sessionB.model, "Fresh session B after target write.") })

  assert.match(fs.readFileSync(harness.target, "utf8"), /description: Committed session A description\./)
  assert.match(fs.readFileSync(sessionB.target, "utf8"), /description: Fresh session B after target write\./)
  assert.deepEqual(harness.state.commands, [["workflowRegister.reload"], ["workflowRegister.reload"]])
  assert.equal(harness.state.shownDocuments.length, 1)
  assert.equal(harness.state.posted.filter((message) => message.type === "saved").length, 1)
  assert.equal(harness.state.information.length, 1)
})

test("Builder retains two exclusively-created backups for successful saves in the same second", async (t) => {
  const harness = createPanelHarness(t)
  const RealDate = global.Date
  const fixedTime = new RealDate("2026-07-12T03:04:05.000Z")
  global.Date = class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixedTime.getTime()]))
    }

    static now() {
      return fixedTime.getTime()
    }
  }
  t.after(() => { global.Date = RealDate })
  harness.state.warningResponses.push("Apply changes", "Apply changes")
  const firstModel = editedModel(harness.model, "First same-second description.")
  const secondModel = editedModel(harness.model, "Second same-second description.")

  await harness.send({ type: "save", model: firstModel })
  await harness.send({ type: "save", model: secondModel })

  const backups = backupFiles(harness.target)
  const backupContents = backups
    .map((name) => fs.readFileSync(path.join(path.dirname(harness.target), name), "utf8"))
    .sort()
  const firstText = serializeAuthoringModelToMarkdown(firstModel).markdown
  assert.equal(backups.length, 2)
  assert.equal(new Set(backups).size, 2)
  assert.deepEqual(backupContents, [harness.oldText, firstText].sort())
  assert.equal(harness.state.copies.length, 2)
  assert.ok(harness.state.copies.every(({ options }) => options?.overwrite === false))
})

test("Builder advances its originalText baseline only after each successful save", async (t) => {
  const harness = createPanelHarness(t)
  harness.state.warningResponses.push("Apply changes", "Apply changes")

  await harness.send({ type: "save", model: editedModel(harness.model, "First successful description.") })
  await harness.send({ type: "save", model: editedModel(harness.model, "Second successful description.") })

  assert.match(fs.readFileSync(harness.target, "utf8"), /description: Second successful description\./)
  assert.deepEqual(harness.state.commands, [["workflowRegister.reload"], ["workflowRegister.reload"]])
  assert.equal(harness.state.posted.filter((message) => message.type === "saved").length, 2)
})

test("Builder inactive tabs preserve all inputs and advanced sections through actual preview and save payloads", () => {
  const original = serializeAuthoringModelToMarkdown(complexWorkflowModel())
  const initialValidation = validateWorkflowText({ sourceId: "workflow-register", filePath: original.filePath, text: original.markdown })
  assert.equal(initialValidation.ok, true, initialValidation.diagnostics.map((item) => item.message).join("\n"))
  const loaded = loadAuthoringModelFromMarkdown({
    sourceId: "workflow-register",
    filePath: original.filePath,
    text: original.markdown
  })

  const messages = runBuilderClientWithoutVisitingTabs(loaded.model)
  const preview = messages.find((message) => message.type === "preview")
  const save = messages.find((message) => message.type === "save")
  assert.ok(preview)
  assert.ok(save)
  assert.deepEqual(save.model, preview.model)
  assert.deepEqual(save.model.inputs.map((input) => [input.type, input.default]), [
    ["string", null],
    ["number", 0],
    ["boolean", false],
    ["select", "concise"]
  ])
  assert.deepEqual(save.model.requires, loaded.model.requires)
  assert.deepEqual(save.model.preflight, loaded.model.preflight)
  assert.deepEqual(save.model.branching, loaded.model.branching)
  assert.deepEqual(save.model.artifacts, loaded.model.artifacts)
  assert.deepEqual(save.model.unknownFrontMatter, loaded.model.unknownFrontMatter)

  const saved = serializeAuthoringModelToMarkdown(save.model)
  const reopened = loadAuthoringModelFromMarkdown({
    sourceId: "workflow-register",
    filePath: saved.filePath,
    text: saved.markdown
  })
  assert.deepEqual(reopened.model.inputs.map((input) => [input.type, input.default]), [
    ["string", null],
    ["number", 0],
    ["boolean", false],
    ["select", "concise"]
  ])
  assert.deepEqual(reopened.model.requires, loaded.model.requires)
  assert.deepEqual(reopened.model.preflight, loaded.model.preflight)
  assert.deepEqual(reopened.model.branching, loaded.model.branching)
  assert.deepEqual(reopened.model.artifacts, loaded.model.artifacts)
  assert.deepEqual(reopened.model.unknownFrontMatter, loaded.model.unknownFrontMatter)
})

test("Builder roundtrip does not broaden v1 nested input schema", () => {
  const rendered = serializeAuthoringModelToMarkdown(complexWorkflowModel())
  const invalid = rendered.markdown.replace(
    "    type: string\n",
    "    type: string\n    futureNestedInputProperty: reject-me\n"
  )
  const validation = validateWorkflowText({ sourceId: "workflow-register", filePath: rendered.filePath, text: invalid })

  assert.equal(validation.ok, false)
  assert.ok(validation.diagnostics.some((item) => /additional properties|futureNestedInputProperty/i.test(item.message)))
})
