const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

test("run execution coordination is same-run single-flight and remains isolated by run and workspace", async () => {
  const { WorkflowRunExecutionCoordinator } = require("../out/core/engine/runExecutionCoordinator")
  const coordinator = new WorkflowRunExecutionCoordinator()
  const rootA = path.resolve("workspace-a")
  const equivalentRootA = path.join(rootA, "nested", "..")
  const rootB = path.resolve("workspace-b")
  let ownerEntered
  const ownerStarted = new Promise((resolve) => { ownerEntered = resolve })
  let releaseOwner
  const ownerReleased = new Promise((resolve) => { releaseOwner = resolve })
  let ownerCalls = 0
  let duplicateCalls = 0
  let queuedCalls = 0

  const owner = coordinator.coordinate(rootA, "shared-run", "run:full", async () => {
    ownerCalls += 1
    ownerEntered()
    await ownerReleased
    return "owner-result"
  })
  await ownerStarted

  const duplicate = coordinator.coordinate(equivalentRootA, "shared-run", "run:full", async () => {
    duplicateCalls += 1
    return "duplicate-result"
  })
  const queued = coordinator.coordinate(rootA, "shared-run", "retry", async () => {
    queuedCalls += 1
    return "queued-result"
  })
  const otherRun = coordinator.coordinate(rootA, "other-run", "run:full", async () => "other-run-result")
  const otherRoot = coordinator.coordinate(rootB, "shared-run", "run:full", async () => "other-root-result")

  assert.equal(await otherRun, "other-run-result")
  assert.equal(await otherRoot, "other-root-result")
  assert.equal(queuedCalls, 0, "a different mutation for the same run must wait for the active execution")

  releaseOwner()
  assert.equal(await owner, "owner-result")
  assert.equal(await duplicate, "owner-result")
  assert.equal(await queued, "queued-result")
  assert.equal(ownerCalls, 1)
  assert.equal(duplicateCalls, 0)
  assert.equal(queuedCalls, 1)
})

test("run execution coordination treats a workspace alias as the same physical root", async (t) => {
  const { WorkflowRunExecutionCoordinator } = require("../out/core/engine/runExecutionCoordinator")
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-register-execution-root-alias-"))
  t.after(() => fs.rmSync(base, { recursive: true, force: true }))
  const physicalRoot = path.join(base, "physical")
  const aliasRoot = path.join(base, "alias")
  fs.mkdirSync(physicalRoot)
  try {
    fs.symlinkSync(physicalRoot, aliasRoot, process.platform === "win32" ? "junction" : "dir")
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP", "UNKNOWN"].includes(error.code)) {
      t.skip(`directory alias unavailable: ${error.code}`)
      return
    }
    throw error
  }

  const coordinator = new WorkflowRunExecutionCoordinator()
  let releaseOwner
  const ownerReleased = new Promise((resolve) => { releaseOwner = resolve })
  let ownerEntered
  const ownerStarted = new Promise((resolve) => { ownerEntered = resolve })
  let duplicateCalls = 0
  const owner = coordinator.coordinate(physicalRoot, "shared-run", "run:full", async () => {
    ownerEntered()
    await ownerReleased
    return "owner-result"
  })
  await ownerStarted
  const duplicate = coordinator.coordinate(aliasRoot, "shared-run", "run:full", async () => {
    duplicateCalls += 1
    return "duplicate-result"
  })

  releaseOwner()
  assert.equal(await owner, "owner-result")
  assert.equal(await duplicate, "owner-result")
  assert.equal(duplicateCalls, 0)
})

test("run execution coordination rejects same-run reentrancy instead of self-waiting", async () => {
  const { WorkflowRunExecutionCoordinator } = require("../out/core/engine/runExecutionCoordinator")
  const coordinator = new WorkflowRunExecutionCoordinator()
  const root = path.resolve("workspace-reentrant")
  let nestedCalls = 0

  const owner = coordinator.coordinate(root, "same-run", "engine-owner", async () => (
    coordinator.coordinate(root, "same-run", "artifact-import", async () => {
      nestedCalls += 1
      return "nested-result"
    })
  ))
  const bounded = Promise.race([
    owner,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timed-out-self-wait")), 250))
  ])

  await assert.rejects(bounded, /re-enter|reentrant|same run/i)
  assert.equal(nestedCalls, 0)
})

test("run execution coordination rejects an indirect run cycle instead of self-waiting", async () => {
  const { WorkflowRunExecutionCoordinator } = require("../out/core/engine/runExecutionCoordinator")
  const coordinator = new WorkflowRunExecutionCoordinator()
  const root = path.resolve("workspace-indirect-reentrant")
  let nestedCalls = 0

  const owner = coordinator.coordinate(root, "run-a", "engine-a", async () => (
    coordinator.coordinate(root, "run-b", "engine-b", async () => (
      coordinator.coordinate(root, "run-a", "artifact-import-a", async () => {
        nestedCalls += 1
        return "nested-result"
      })
    ))
  ))
  const bounded = Promise.race([
    owner,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timed-out-indirect-self-wait")), 250))
  ])

  await assert.rejects(bounded, /cycle|re-enter|reentrant/i)
  assert.equal(nestedCalls, 0)
})
