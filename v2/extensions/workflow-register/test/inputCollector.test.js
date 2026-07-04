const test = require("node:test")
const assert = require("node:assert/strict")

const { collectWorkflowInputsWithResolver } = require("../out/core/inputCollector")

test("collectWorkflowInputsWithResolver uses defaults without prompting", async () => {
  const prompts = []
  const result = await collectWorkflowInputsWithResolver({
    inputs: {
      vcs: { type: "select", title: "VCS", default: "git", options: ["git", "bazaar", "bzr"] },
      base: { type: "string", title: "base", default: "HEAD~1" },
      includeDocs: { type: "boolean", title: "include docs", default: true },
      maxDepth: { type: "number", title: "max depth", default: "2" }
    },
    provided: {},
    prompt: async (key) => {
      prompts.push(key)
      return undefined
    }
  })

  assert.deepEqual(prompts, [])
  assert.equal(result.vcs, "git")
  assert.equal(result.base, "HEAD~1")
  assert.equal(result.includeDocs, true)
  assert.equal(result.maxDepth, 2)
})

test("collectWorkflowInputsWithResolver treats empty optional defaults as resolved", async () => {
  const prompts = []
  const result = await collectWorkflowInputsWithResolver({
    inputs: {
      vcsRoot: { type: "string", title: "VCS root", default: "" },
      docsRoot: { type: "string", title: "docs root", default: "docs" }
    },
    provided: {},
    prompt: async (key) => {
      prompts.push(key)
      return undefined
    }
  })

  assert.deepEqual(prompts, [])
  assert.equal(result.vcsRoot, "")
  assert.equal(result.docsRoot, "docs")
})

test("collectWorkflowInputsWithResolver does not re-prompt skipped optional inputs", async () => {
  const prompts = []
  const result = await collectWorkflowInputsWithResolver({
    inputs: {
      optionalPath: { type: "string", title: "optional path" },
      anotherOptional: { type: "select", title: "optional select", options: ["a", "b"] }
    },
    provided: {},
    prompt: async (key) => {
      prompts.push(key)
      return undefined
    }
  })

  assert.deepEqual(prompts, ["optionalPath", "anotherOptional"])
  assert.deepEqual(result, {})
})

test("collectWorkflowInputsWithResolver still cancels missing required input", async () => {
  const result = await collectWorkflowInputsWithResolver({
    inputs: {
      target: { type: "string", title: "target", required: true }
    },
    provided: {},
    prompt: async () => undefined
  })

  assert.equal(result, undefined)
})
