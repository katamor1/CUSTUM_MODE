const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

function readSource(...segments) {
  return fs.readFileSync(path.join(__dirname, "..", "src", ...segments), "utf8")
}

test("Git and Bazaar diff collection use the bounded external process runner", () => {
  const source = readSource("core", "gitDiffCollector.ts")

  assert.match(source, /runExternalProcess/)
  assert.match(source, /timeoutMs/)
  assert.match(source, /signal/)
  assert.doesNotMatch(source, /execFileAsync|execFile\(/)
})

test("VCS command timeout is clamped to the manifest range", () => {
  const source = readSource("core", "gitDiffCollector.ts")

  assert.match(source, /const MIN_VCS_COMMAND_TIMEOUT_MS = 1_000/)
  assert.match(source, /const MAX_VCS_COMMAND_TIMEOUT_MS = 600_000/)
  assert.match(source, /Math\.max\(MIN_VCS_COMMAND_TIMEOUT_MS, Math\.min\(MAX_VCS_COMMAND_TIMEOUT_MS, Math\.floor\(value\)\)\)/)
})

test("preprocess progress propagates cancellation into VCS collection", () => {
  const commandSource = readSource("reviewExecutionCommands.ts")
  const pipelineSource = readSource("core", "pipeline.ts")

  assert.match(commandSource, /cancellable:\s*true/)
  assert.match(commandSource, /AbortController/)
  assert.match(commandSource, /token\.onCancellationRequested/)
  assert.match(commandSource, /abortSignal:\s*controller\.signal/)
  assert.match(pipelineSource, /abortSignal/)
  assert.match(pipelineSource, /signal:\s*input\.abortSignal/)
})
