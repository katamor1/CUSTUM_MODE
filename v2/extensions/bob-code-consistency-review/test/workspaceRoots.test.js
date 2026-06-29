const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const Module = require("node:module")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { findMarkerRoots, rootHasMarker } = require("../out/workspaceRoots.js")

function folder(name, fsPath) {
  return { name, uri: { fsPath } }
}

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "code-consistency-roots-"))
}

test("code consistency root resolver prefers direct .bob folders", async () => {
  const root = await tempRoot()
  const workflowRoot = path.join(root, "workspace")
  const bazaarRoot = path.join(root, "bazaar_test", "banch2")
  await fs.mkdir(path.join(workflowRoot, ".bob"), { recursive: true })
  await fs.mkdir(path.join(bazaarRoot, ".bzr"), { recursive: true })

  const candidates = await findMarkerRoots([folder("workspace", workflowRoot), folder("banch2", bazaarRoot)], ".bob")

  assert.deepEqual(candidates.map((candidate) => candidate.root), [workflowRoot])
  assert.equal(candidates[0].depth, "direct")
})

test("code consistency resolver can accept workflowRoot when it owns .bob", async () => {
  const root = await tempRoot()
  const workflowRoot = path.join(root, "workspace")
  await fs.mkdir(path.join(workflowRoot, ".bob"), { recursive: true })

  assert.equal(await rootHasMarker(workflowRoot, ".bob"), true)
})

test("code consistency root resolver finds immediate child .bob folders when no direct marker exists", async () => {
  const root = await tempRoot()
  const top = path.join(root, "workspace")
  const child = path.join(top, "project")
  await fs.mkdir(path.join(child, ".bob"), { recursive: true })

  const candidates = await findMarkerRoots([folder("workspace", top)], ".bob")

  assert.deepEqual(candidates.map((candidate) => candidate.root), [child])
  assert.equal(candidates[0].depth, "child")
})

test("code consistency workspace resolver prompts when multiple .bob candidates exist", async () => {
  const root = await tempRoot()
  const first = path.join(root, "workspace-a")
  const second = path.join(root, "workspace-b")
  await fs.mkdir(path.join(first, ".bob"), { recursive: true })
  await fs.mkdir(path.join(second, ".bob"), { recursive: true })
  let pickedItems = []

  const { resolveBobWorkspaceRoot } = loadBobResolver({
    workspaceFolders: [folder("workspace-a", first), folder("workspace-b", second)],
    showQuickPick: async (items) => {
      pickedItems = items
      return items[1]
    }
  })

  assert.equal(await resolveBobWorkspaceRoot(), second)
  assert.deepEqual(pickedItems.map((item) => item.candidate.root), [first, second])
})

test("code consistency workspace resolver falls back to a single top folder when no .bob marker exists", async () => {
  const root = await tempRoot()
  const workspace = path.join(root, "workspace")
  await fs.mkdir(workspace, { recursive: true })

  const { resolveBobWorkspaceRoot } = loadBobResolver({
    workspaceFolders: [folder("workspace", workspace)]
  })

  assert.equal(await resolveBobWorkspaceRoot({ allowPick: false }), workspace)
})

function loadBobResolver({ workspaceFolders, showQuickPick = async () => undefined }) {
  const modulePath = require.resolve("../out/workspaceResolver.js")
  delete require.cache[modulePath]
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (request === "vscode") {
      return {
        workspace: { workspaceFolders },
        window: { activeTextEditor: undefined, showQuickPick },
        Uri: { file: (fsPath) => ({ scheme: "file", fsPath }) }
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    return require(modulePath)
  } finally {
    Module._load = originalLoad
  }
}
