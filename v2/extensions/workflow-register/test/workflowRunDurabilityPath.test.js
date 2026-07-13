const assert = require("node:assert/strict")
const fs = require("node:fs")
const fsp = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const {
  appendRunDurabilityFile,
  createRunDurabilityFile,
  readRunDurabilityFile,
  removeRunDurabilityFile,
  replaceRunDurabilityFile
} = require("../out/core/runtime/runDurabilityPath.js")

function root(t) {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-durability-path-"))
  t.after(() => fs.rmSync(value, { recursive: true, force: true }))
  return value
}

test("durability path creates, replaces, appends and conditionally removes direct files", async (t) => {
  const workspace = root(t)
  assert.equal(await createRunDurabilityFile(workspace, "run-1", "run.lock.json", "owner\n"), true)
  assert.equal(await createRunDurabilityFile(workspace, "run-1", "run.lock.json", "other\n"), false)
  assert.equal((await readRunDurabilityFile(workspace, "run-1", "run.lock.json")).bytes.toString("utf8"), "owner\n")

  await replaceRunDurabilityFile(workspace, "run-1", "run-state.journal.json", "one\n")
  const firstJournal = await readRunDurabilityFile(workspace, "run-1", "run-state.journal.json")
  await replaceRunDurabilityFile(workspace, "run-1", "run-state.journal.json", "two\n", firstJournal.bytes)
  assert.equal((await readRunDurabilityFile(workspace, "run-1", "run-state.journal.json")).bytes.toString("utf8"), "two\n")
  await assert.rejects(
    replaceRunDurabilityFile(workspace, "run-1", "run-state.journal.json", "stale\n", firstJournal.bytes),
    /changed before replacement/
  )
  assert.equal((await readRunDurabilityFile(workspace, "run-1", "run-state.journal.json")).bytes.toString("utf8"), "two\n")

  await appendRunDurabilityFile(workspace, "run-1", "events.ndjson", "a\n")
  await appendRunDurabilityFile(workspace, "run-1", "events.ndjson", "b\n")
  assert.equal((await readRunDurabilityFile(workspace, "run-1", "events.ndjson")).bytes.toString("utf8"), "a\nb\n")

  assert.equal(await removeRunDurabilityFile(workspace, "run-1", "run.lock.json", Buffer.from("different\n")), false)
  assert.equal(await removeRunDurabilityFile(workspace, "run-1", "run.lock.json", Buffer.from("owner\n")), true)
  assert.equal(await readRunDurabilityFile(workspace, "run-1", "run.lock.json"), undefined)
})

test("durability path rejects a symlink file target", async (t) => {
  const workspace = root(t)
  const outside = root(t)
  const runDir = path.join(workspace, ".bob", "workflows", "runs", "run-1")
  await fsp.mkdir(runDir, { recursive: true })
  const outsideFile = path.join(outside, "outside.json")
  await fsp.writeFile(outsideFile, "outside\n")
  try {
    await fsp.symlink(outsideFile, path.join(runDir, "events.ndjson"), "file")
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return t.skip(error.code)
    throw error
  }
  await assert.rejects(appendRunDurabilityFile(workspace, "run-1", "events.ndjson", "event\n"), /symlink|direct regular file|ELOOP/i)
  assert.equal(await fsp.readFile(outsideFile, "utf8"), "outside\n")
})

test("durability path rejects a run-directory alias outside the workspace", async (t) => {
  const workspace = root(t)
  const outside = root(t)
  const runs = path.join(workspace, ".bob", "workflows", "runs")
  await fsp.mkdir(runs, { recursive: true })
  try {
    await fsp.symlink(outside, path.join(runs, "run-1"), process.platform === "win32" ? "junction" : "dir")
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return t.skip(error.code)
    throw error
  }
  await assert.rejects(replaceRunDurabilityFile(workspace, "run-1", "run-state.journal.json", "journal\n"), /workspace|outside|symlink|junction|alias|direct/i)
})
