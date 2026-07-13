const assert = require("node:assert/strict")
const fs = require("node:fs")
const fsPromises = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

function tempDir(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-register-file-transaction-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

test("workspace file transaction restores old artifact and manifest bytes when manifest commit fails", async (t) => {
  const { writeWorkspaceFilesAtomically } = require("../out/core/runtime/workspaceFileTransaction")
  const root = tempDir(t)
  const artifactRelative = ".bob/workflows/runs/run-1/artifacts/context.txt"
  const manifestRelative = ".bob/workflows/runs/run-1/artifacts/manifest.json"
  const artifactPath = path.join(root, artifactRelative)
  const manifestPath = path.join(root, manifestRelative)
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true })
  fs.writeFileSync(artifactPath, "old artifact")
  fs.writeFileSync(manifestPath, "old manifest")

  const originalRename = fsPromises.rename
  let injected = false
  fsPromises.rename = async (source, target) => {
    if (!injected && path.resolve(target) === path.resolve(manifestPath) && String(source).includes(".workflow-txn-")) {
      injected = true
      throw new Error("forced manifest commit failure")
    }
    return originalRename(source, target)
  }

  try {
    await assert.rejects(
      writeWorkspaceFilesAtomically(root, [
        { relativePath: artifactRelative, text: "new artifact", encoding: "utf8" },
        { relativePath: manifestRelative, text: "new manifest", encoding: "utf8" }
      ]),
      /forced manifest commit failure/
    )
  } finally {
    fsPromises.rename = originalRename
  }

  assert.equal(injected, true)
  assert.equal(fs.readFileSync(artifactPath, "utf8"), "old artifact")
  assert.equal(fs.readFileSync(manifestPath, "utf8"), "old manifest")
  assert.deepEqual(
    fs.readdirSync(path.dirname(artifactPath)).filter((name) => name.includes(".workflow-txn-")),
    []
  )
})

test("workspace file transaction removes a partially staged temporary file", async (t) => {
  const { writeWorkspaceFilesAtomically } = require("../out/core/runtime/workspaceFileTransaction")
  const root = tempDir(t)
  const originalWriteFile = fsPromises.writeFile
  let injected = false
  fsPromises.writeFile = async (target, ...args) => {
    await originalWriteFile(target, ...args)
    if (!injected && String(target).includes(".workflow-txn-")) {
      injected = true
      throw new Error("forced staging failure")
    }
  }

  try {
    await assert.rejects(
      writeWorkspaceFilesAtomically(root, [{ relativePath: "artifacts/new.txt", text: "new", encoding: "utf8" }]),
      /forced staging failure/
    )
  } finally {
    fsPromises.writeFile = originalWriteFile
  }

  assert.equal(injected, true)
  const artifactDirectory = path.join(root, "artifacts")
  assert.deepEqual(
    fs.existsSync(artifactDirectory)
      ? fs.readdirSync(artifactDirectory).filter((name) => name.includes(".workflow-txn-"))
      : [],
    []
  )
  assert.equal(fs.existsSync(path.join(artifactDirectory, "new.txt")), false)
})

test("workspace file transaction rejects a junction that escapes the physical workspace root", async (t) => {
  const { writeWorkspaceFilesAtomically } = require("../out/core/runtime/workspaceFileTransaction")
  const root = tempDir(t)
  const outside = tempDir(t)
  const junction = path.join(root, "outside-link")
  fs.symlinkSync(outside, junction, process.platform === "win32" ? "junction" : "dir")

  await assert.rejects(
    writeWorkspaceFilesAtomically(root, [{ relativePath: "outside-link/escaped.txt", text: "escaped", encoding: "utf8" }]),
    /physical workspace root|escapes workspace root/
  )
  assert.equal(fs.existsSync(path.join(outside, "escaped.txt")), false)
})

test("workspace file transaction rejects duplicate physical targets through a junction alias", async (t) => {
  const { writeWorkspaceFilesAtomically } = require("../out/core/runtime/workspaceFileTransaction")
  const root = tempDir(t)
  const realDirectory = path.join(root, "real")
  fs.mkdirSync(realDirectory)
  fs.symlinkSync(realDirectory, path.join(root, "alias"), process.platform === "win32" ? "junction" : "dir")

  await assert.rejects(
    writeWorkspaceFilesAtomically(root, [
      { relativePath: "real/same.txt", text: "first", encoding: "utf8" },
      { relativePath: "alias/same.txt", text: "second", encoding: "utf8" }
    ]),
    /duplicate physical target/
  )
  assert.equal(fs.existsSync(path.join(realDirectory, "same.txt")), false)
})

test("workspace file transaction rejects a parent swapped to an outside junction before staging", async (t) => {
  const { writeWorkspaceFilesAtomically } = require("../out/core/runtime/workspaceFileTransaction")
  const root = tempDir(t)
  const outside = tempDir(t)
  const parent = path.join(root, "artifacts")
  const parked = path.join(root, "artifacts-parked")
  fs.mkdirSync(parent)
  const originalWriteFile = fsPromises.writeFile
  let swapped = false
  fsPromises.writeFile = async (target, ...args) => {
    if (!swapped && path.basename(String(target)).includes(".workflow-txn-")) {
      fs.renameSync(parent, parked)
      fs.symlinkSync(outside, parent, process.platform === "win32" ? "junction" : "dir")
      swapped = true
    }
    return originalWriteFile(target, ...args)
  }

  try {
    await assert.rejects(
      writeWorkspaceFilesAtomically(root, [
        { relativePath: "artifacts/escaped.txt", text: "escaped", encoding: "utf8" }
      ]),
      /changed|physical workspace root|symbolic|junction|containment/
    )
  } finally {
    fsPromises.writeFile = originalWriteFile
  }

  assert.equal(swapped, true)
  assert.equal(fs.existsSync(path.join(outside, "escaped.txt")), false)
})

test("workspace file transaction serializes one physical root so a failed rollback cannot overwrite a later commit", async (t) => {
  const { writeWorkspaceFilesAtomically } = require("../out/core/runtime/workspaceFileTransaction")
  const root = tempDir(t)
  const target = path.join(root, "artifact.txt")
  fs.writeFileSync(target, "old")
  let firstCommitEntered
  const firstEntered = new Promise((resolve) => { firstCommitEntered = resolve })
  let releaseFirstCommit
  const firstReleased = new Promise((resolve) => { releaseFirstCommit = resolve })
  const first = writeWorkspaceFilesAtomically(root, [
    { relativePath: "artifact.txt", text: "first", encoding: "utf8" }
  ], async () => {
    firstCommitEntered()
    await firstReleased
    throw new Error("first state commit failed")
  })
  await firstEntered

  const second = writeWorkspaceFilesAtomically(root, [
    { relativePath: "artifact.txt", text: "second", encoding: "utf8" }
  ])
  void second.then(releaseFirstCommit, releaseFirstCommit)
  const fallback = setTimeout(releaseFirstCommit, 250)
  try {
    const [firstResult, secondResult] = await Promise.allSettled([first, second])
    assert.equal(firstResult.status, "rejected")
    assert.equal(secondResult.status, "fulfilled")
  } finally {
    clearTimeout(fallback)
    releaseFirstCommit()
    await Promise.allSettled([first, second])
  }

  assert.equal(fs.readFileSync(target, "utf8"), "second")
})
