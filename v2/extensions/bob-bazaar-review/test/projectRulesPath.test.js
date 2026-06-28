const assert = require("node:assert/strict")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { resolveWorkspacePath } = require("../out/projectRules/io")

const ALLOW_EXTERNAL_REVIEW_RULES_ENV = "BOB_BAZAAR_ALLOW_EXTERNAL_REVIEW_RULES"

function withExternalRulesEnv(value, run) {
  const previous = process.env[ALLOW_EXTERNAL_REVIEW_RULES_ENV]
  if (value === undefined) delete process.env[ALLOW_EXTERNAL_REVIEW_RULES_ENV]
  else process.env[ALLOW_EXTERNAL_REVIEW_RULES_ENV] = value
  try {
    run()
  } finally {
    if (previous === undefined) delete process.env[ALLOW_EXTERNAL_REVIEW_RULES_ENV]
    else process.env[ALLOW_EXTERNAL_REVIEW_RULES_ENV] = previous
  }
}

test("project review rule paths stay inside the workspace by default", () => {
  const workspace = path.join(os.tmpdir(), "bob-workspace")

  withExternalRulesEnv(undefined, () => {
    assert.equal(
      resolveWorkspacePath(workspace, ".bob/review/checklist.json"),
      path.resolve(workspace, ".bob/review/checklist.json")
    )
    assert.throws(
      () => resolveWorkspacePath(workspace, "../outside/checklist.json"),
      /escapes the workspace/
    )
    assert.throws(
      () => resolveWorkspacePath(workspace, path.resolve(os.tmpdir(), "outside-checklist.json")),
      /escapes the workspace/
    )
  })
})

test("project review rule paths can explicitly opt in to external absolute paths", () => {
  const workspace = path.join(os.tmpdir(), "bob-workspace")
  const external = path.resolve(os.tmpdir(), "outside-checklist.json")

  withExternalRulesEnv("1", () => {
    assert.equal(resolveWorkspacePath(workspace, external), external)
  })
})
