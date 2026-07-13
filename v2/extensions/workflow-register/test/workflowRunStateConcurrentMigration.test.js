const assert = require("node:assert/strict")
const fs = require("node:fs")
const fsp = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const {
  CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION,
  FileRunStateStore
} = require("../out/core/runStateStore.js")

const fixtureRoot = path.join(__dirname, "fixtures", "run-state")

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-run-concurrent-migration-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function runDirectory(root, runId) {
  return path.join(root, ".bob", "workflows", "runs", runId)
}

function runFile(root, runId) {
  return path.join(runDirectory(root, runId), "run.json")
}

function backupFile(root, runId) {
  return path.join(runDirectory(root, runId), "run-state-v0.backup.json")
}

test("concurrent store instances share one in-process migration", async (t) => {
  const root = tempRoot(t)
  const historicalBytes = fs.readFileSync(path.join(fixtureRoot, "v0-basic.json"), "utf8")
  const historical = JSON.parse(historicalBytes)
  await fsp.mkdir(runDirectory(root, historical.runId), { recursive: true })
  await fsp.writeFile(runFile(root, historical.runId), historicalBytes, "utf8")

  const firstStore = new FileRunStateStore({ workspaceRoot: root })
  const secondStore = new FileRunStateStore({ workspaceRoot: root })
  const originalLink = fsp.link
  let linkCalls = 0
  let releaseLink
  const linkReleased = new Promise((resolve) => { releaseLink = resolve })
  let firstLinkEntered
  const firstLinkStarted = new Promise((resolve) => { firstLinkEntered = resolve })

  fsp.link = async (...args) => {
    linkCalls += 1
    firstLinkEntered()
    await linkReleased
    return originalLink(...args)
  }

  let firstLoad
  let secondLoad
  try {
    firstLoad = firstStore.loadRun(historical.runId)
    await firstLinkStarted
    secondLoad = secondStore.loadRun(historical.runId)
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(linkCalls, 1, "the second store must join the active migration before backup publication")
    releaseLink()
    const [first, second] = await Promise.all([firstLoad, secondLoad])

    assert.deepEqual(second, first)
    assert.equal(first.schemaVersion, CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION)
    assert.equal(fs.readFileSync(backupFile(root, historical.runId), "utf8"), historicalBytes)
    assert.equal(
      JSON.parse(fs.readFileSync(runFile(root, historical.runId), "utf8")).schemaVersion,
      CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION
    )
  } finally {
    releaseLink?.()
    fsp.link = originalLink
    await firstLoad?.catch(() => undefined)
    await secondLoad?.catch(() => undefined)
  }
})
