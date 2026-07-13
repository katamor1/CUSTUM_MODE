const assert = require("node:assert/strict")
const fs = require("node:fs")
const fsp = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const {
  ensureContainedRunStateMigrationBackup,
  readContainedRunStateMigrationBackup
} = require("../out/core/runtime/runStateMigrationBackup.js")

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "workflow-run-migration-path-"))
}

function runsDirectory(root) {
  return path.join(root, ".bob", "workflows", "runs")
}

function runDirectory(root, runId) {
  return path.join(runsDirectory(root), runId)
}

async function prepareRunDirectory(root, runId) {
  await fsp.mkdir(runDirectory(root, runId), { recursive: true })
}

test("migration backup preserves exact historical run bytes and is idempotent", async (t) => {
  const root = tempRoot()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const runId = "20260712T000000Z-history-000000000001"
  const historical = "{\n  \"runId\": \"history\"\n}\n"
  await prepareRunDirectory(root, runId)

  await ensureContainedRunStateMigrationBackup(root, runId, historical)
  await ensureContainedRunStateMigrationBackup(root, runId, historical)
  const snapshot = await readContainedRunStateMigrationBackup(root, runId)

  assert.equal(snapshot.bytes.toString("utf8"), historical)
  assert.equal(snapshot.filePath, path.join(runDirectory(root, runId), "run-state-v0.backup.json"))
})

test("migration backup refuses to overwrite conflicting historical bytes", async (t) => {
  const root = tempRoot()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const runId = "20260712T000000Z-conflict-000000000002"
  await prepareRunDirectory(root, runId)

  await ensureContainedRunStateMigrationBackup(root, runId, "original\n")
  await assert.rejects(
    ensureContainedRunStateMigrationBackup(root, runId, "different\n"),
    /migration backup conflicts with the current unversioned run/
  )
  assert.equal(
    fs.readFileSync(path.join(runDirectory(root, runId), "run-state-v0.backup.json"), "utf8"),
    "original\n"
  )
})

test("migration backup rejects a symlink target instead of following it", async (t) => {
  const root = tempRoot()
  const outside = tempRoot()
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  })
  const runId = "20260712T000000Z-symlink-000000000003"
  await prepareRunDirectory(root, runId)
  const outsideFile = path.join(outside, "outside.json")
  fs.writeFileSync(outsideFile, "outside\n", "utf8")
  const backupPath = path.join(runDirectory(root, runId), "run-state-v0.backup.json")

  try {
    fs.symlinkSync(outsideFile, backupPath, "file")
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
      t.skip(`symlink creation is unavailable: ${error.code}`)
      return
    }
    throw error
  }

  await assert.rejects(
    ensureContainedRunStateMigrationBackup(root, runId, "historical\n"),
    /must be a direct regular file and not a symlink/
  )
  assert.equal(fs.readFileSync(outsideFile, "utf8"), "outside\n")
})

test("migration backup removes its owned temp file when temp identity verification fails", async (t) => {
  const root = tempRoot()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const runId = "20260712T000000Z-temp-cleanup-000000000004"
  await prepareRunDirectory(root, runId)
  const rootRunsDirectory = runsDirectory(root)
  const originalLstat = fsp.lstat
  let injected = false

  fsp.lstat = async (filePath, ...args) => {
    const resolved = path.resolve(String(filePath))
    const isOwnedTemp = path.dirname(resolved) === path.resolve(rootRunsDirectory)
      && path.basename(resolved).startsWith(`.${runId}.`)
      && path.basename(resolved).endsWith(".tmp")
    if (!injected && isOwnedTemp) {
      injected = true
      const error = new Error("simulated migration temp identity failure")
      error.code = "EIO"
      throw error
    }
    return originalLstat(filePath, ...args)
  }

  try {
    await assert.rejects(
      ensureContainedRunStateMigrationBackup(root, runId, "historical\n"),
      /simulated migration temp identity failure/
    )
  } finally {
    fsp.lstat = originalLstat
  }

  assert.equal(injected, true)
  assert.deepEqual(
    fs.readdirSync(rootRunsDirectory).filter((name) => name.endsWith(".tmp")),
    []
  )
  assert.equal(
    fs.existsSync(path.join(runDirectory(root, runId), "run-state-v0.backup.json")),
    false
  )
})
