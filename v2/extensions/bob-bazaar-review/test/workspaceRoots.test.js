const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const Module = require("node:module")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { findMarkerRoots, rootHasMarker } = require("../out/workspace/workspaceRoots.js")

function folder(name, fsPath) {
  return { name, uri: { fsPath } }
}

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bazaar-roots-"))
}

test("Bazaar root resolver prefers the top folder with a first-level .bzr marker", async () => {
  const root = await tempRoot()
  const workflowRoot = path.join(root, "workspace")
  const bazaarRoot = path.join(root, "bazaar_test", "banch2")
  await fs.mkdir(path.join(workflowRoot, ".bob"), { recursive: true })
  await fs.mkdir(path.join(bazaarRoot, ".bzr"), { recursive: true })

  const candidates = await findMarkerRoots([folder("workspace", workflowRoot), folder("banch2", bazaarRoot)], ".bzr")

  assert.deepEqual(candidates.map((candidate) => candidate.root), [bazaarRoot])
  assert.equal(candidates[0].depth, "direct")
})

test("Bazaar root resolver ignores workflowRoot unless it owns .bzr", async () => {
  const root = await tempRoot()
  const workflowRoot = path.join(root, "workspace")
  const bazaarRoot = path.join(root, "bazaar_test", "banch2")
  await fs.mkdir(path.join(workflowRoot, ".bob"), { recursive: true })
  await fs.mkdir(path.join(bazaarRoot, ".bzr"), { recursive: true })

  assert.equal(await rootHasMarker(workflowRoot, ".bzr"), false)
  assert.equal(await rootHasMarker(bazaarRoot, ".bzr"), true)
})

test("Bazaar root resolver finds immediate child .bzr folders when no direct marker exists", async () => {
  const root = await tempRoot()
  const top = path.join(root, "bazaar_test")
  const child = path.join(top, "banch2")
  await fs.mkdir(path.join(child, ".bzr"), { recursive: true })

  const candidates = await findMarkerRoots([folder("bazaar_test", top)], ".bzr")

  assert.deepEqual(candidates.map((candidate) => candidate.root), [child])
  assert.equal(candidates[0].depth, "child")
})

test("Bazaar workspace resolver prompts when multiple .bzr candidates exist", async () => {
  const root = await tempRoot()
  const first = path.join(root, "repo-a")
  const second = path.join(root, "repo-b")
  await fs.mkdir(path.join(first, ".bzr"), { recursive: true })
  await fs.mkdir(path.join(second, ".bzr"), { recursive: true })
  let pickedItems = []

  const { resolveBazaarWorkspaceFolder } = loadBazaarResolver({
    workspaceFolders: [folder("repo-a", first), folder("repo-b", second)],
    showQuickPick: async (items) => {
      pickedItems = items
      return items[1]
    }
  })

  const resolved = await resolveBazaarWorkspaceFolder()

  assert.equal(resolved.uri.fsPath, second)
  assert.deepEqual(pickedItems.map((item) => item.candidate.root), [first, second])
})

test("Bazaar workspace resolver falls back to a single top folder when no .bzr marker exists", async () => {
  const root = await tempRoot()
  const workspace = path.join(root, "workspace")
  await fs.mkdir(workspace, { recursive: true })

  const { resolveBazaarWorkspaceFolder } = loadBazaarResolver({
    workspaceFolders: [folder("workspace", workspace)]
  })

  const resolved = await resolveBazaarWorkspaceFolder({ allowPick: false })

  assert.equal(resolved.uri.fsPath, workspace)
})

function loadBazaarResolver({ workspaceFolders, showQuickPick = async () => undefined }) {
  const modulePath = require.resolve("../out/workspace/workspaceResolver.js")
  delete require.cache[modulePath]
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (request === "vscode") {
      return {
        workspace: { workspaceFolders },
        window: { activeTextEditor: undefined, showQuickPick, showWarningMessage: async () => undefined },
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
