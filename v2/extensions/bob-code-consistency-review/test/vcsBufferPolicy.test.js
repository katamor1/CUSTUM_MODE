const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const {
  DEFAULT_REVIEW_PROCESSING_LIMITS,
  MAX_VCS_PROCESS_BUFFER_BYTES,
  MIN_VCS_PROCESS_BUFFER_BYTES,
  maxVcsProcessBufferBytes
} = require("../out/core/limits")

test("VCS process buffers derive from maxRawDiffBytes with bounded headroom", () => {
  assert.equal(maxVcsProcessBufferBytes(1), MIN_VCS_PROCESS_BUFFER_BYTES)
  assert.equal(
    maxVcsProcessBufferBytes(DEFAULT_REVIEW_PROCESSING_LIMITS.maxRawDiffBytes),
    2 * 1024 * 1024 + 64 * 1024
  )
  assert.equal(maxVcsProcessBufferBytes(10 * 1024 * 1024), MAX_VCS_PROCESS_BUFFER_BYTES)
  assert.equal(maxVcsProcessBufferBytes(Number.MAX_SAFE_INTEGER), MAX_VCS_PROCESS_BUFFER_BYTES)
})

test("Git and Bazaar diff collection use the limit-derived process buffer", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "core", "gitDiffCollector.ts"), "utf8")

  assert.match(source, /maxVcsProcessBufferBytes\(options\.limits\.maxRawDiffBytes\)/)
  assert.doesNotMatch(source, /20 \* 1024 \* 1024/)
  assert.doesNotMatch(source, /50 \* 1024 \* 1024/)
})
