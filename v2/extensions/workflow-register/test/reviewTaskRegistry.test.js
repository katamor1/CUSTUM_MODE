const assert = require("node:assert/strict")
const { test } = require("node:test")

const { ReviewTaskRegistry } = require("../out/reviewTaskRegistry.js")

test("ReviewTaskRegistry completes the matching Bob review task once", () => {
  const registry = new ReviewTaskRegistry()
  let completions = 0

  registry.register("run-1", "collect", {
    setStepComplete: () => {
      completions += 1
    }
  })

  assert.equal(registry.complete("run-1", "collect"), true)
  assert.equal(completions, 1)
  assert.equal(registry.complete("run-1", "collect"), false)
  assert.equal(completions, 1)
})

test("ReviewTaskRegistry leaves other review tasks active", () => {
  const registry = new ReviewTaskRegistry()
  let collectCompleted = false
  let draftCompleted = false

  registry.register("run-1", "collect", {
    setStepComplete: () => {
      collectCompleted = true
    }
  })
  registry.register("run-1", "draft", {
    setStepComplete: () => {
      draftCompleted = true
    }
  })

  assert.equal(registry.complete("run-1", "draft"), true)
  assert.equal(collectCompleted, false)
  assert.equal(draftCompleted, true)
  assert.equal(registry.complete("run-1", "collect"), true)
  assert.equal(collectCompleted, true)
})

test("ReviewTaskRegistry can advance later Operation Hub-driven steps from the run task", () => {
  const registry = new ReviewTaskRegistry()
  let completions = 0

  registry.register("run-1", "collect", {
    setStepComplete: () => {
      completions += 1
    }
  })

  assert.equal(registry.complete("run-1", "collect"), true)
  assert.equal(registry.complete("run-1", "draft"), true)
  assert.equal(completions, 2)
})

test("ReviewTaskRegistry is a no-op when Bob cannot mark a step complete", () => {
  const registry = new ReviewTaskRegistry()

  registry.register("run-1", "collect", {})

  assert.equal(registry.complete("run-1", "collect"), false)
})
