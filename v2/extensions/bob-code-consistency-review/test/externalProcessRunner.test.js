const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const {
  ExternalProcessError,
  runExternalProcess
} = require("../out/core/externalProcessRunner")

const cwd = process.cwd()

function runNode(script, options = {}) {
  return runExternalProcess({
    command: process.execPath,
    args: ["-e", script],
    cwd,
    maxBufferBytes: 1024 * 1024,
    timeoutMs: 2000,
    allowedExitCodes: [0],
    ...options
  })
}

async function rejectsWithKind(promise, kind) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ExternalProcessError)
    assert.equal(error.kind, kind)
    return true
  })
}

test("external process runner terminates commands that exceed the hard timeout", async () => {
  const startedAt = Date.now()
  await rejectsWithKind(
    runNode("setInterval(() => {}, 1000)", { timeoutMs: 50 }),
    "timeout"
  )
  assert.ok(Date.now() - startedAt < 3000)
})

test("external process runner clamps timeouts below the safety minimum", async () => {
  const result = await runNode("setTimeout(() => {}, 50)", { timeoutMs: 1 })
  assert.equal(result.exitCode, 0)
})

test("external process runner propagates AbortSignal cancellation", async () => {
  const controller = new AbortController()
  const running = runNode("setInterval(() => {}, 1000)", { signal: controller.signal })
  setTimeout(() => controller.abort(), 50)
  await rejectsWithKind(running, "cancelled")
})

test("external process runner closes the preflight-to-listener cancellation race", async () => {
  let abortedReads = 0
  const signal = {
    get aborted() {
      abortedReads += 1
      return abortedReads >= 2
    },
    addEventListener() {},
    removeEventListener() {}
  }

  await rejectsWithKind(
    runNode("setInterval(() => {}, 1000)", { signal, timeoutMs: 100 }),
    "cancelled"
  )
  assert.ok(abortedReads >= 2)
})

test("external process runner terminates output that exceeds the buffer budget", async () => {
  await rejectsWithKind(
    runNode("process.stdout.write('x'.repeat(65536))", { maxBufferBytes: 1024 }),
    "bufferExceeded"
  )
})

test("bufferExceeded errors retain no more than the configured byte budget", async () => {
  const maxBufferBytes = 1024
  await assert.rejects(
    runNode("process.stdout.write('x'.repeat(65536)); process.stderr.write('y'.repeat(65536))", { maxBufferBytes }),
    (error) => {
      assert.ok(error instanceof ExternalProcessError)
      assert.equal(error.kind, "bufferExceeded")
      assert.ok(
        error.stdout.length + error.stderr.length <= maxBufferBytes,
        `retained ${error.stdout.length + error.stderr.length} bytes for a ${maxBufferBytes}-byte budget`
      )
      return true
    }
  )
})

test("process runner settles only after a buffer-exceeded child exits", async () => {
  const pidFile = path.join(os.tmpdir(), `external-runner-${process.pid}-${Date.now()}.pid`)
  try {
    await assert.rejects(
      runNode(
        `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); ` +
          "process.stdout.write('x'.repeat(65536)); setInterval(() => {}, 1000)",
        { maxBufferBytes: 1024 }
      ),
      (error) => error instanceof ExternalProcessError && error.kind === "bufferExceeded"
    )
    const pid = Number(fs.readFileSync(pidFile, "utf8"))
    assert.equal(isProcessAlive(pid), false, `child ${pid} was still alive after rejection`)
  } finally {
    fs.rmSync(pidFile, { force: true })
  }
})

test("external process runner accepts explicitly allowed non-zero exit codes", async () => {
  const result = await runNode("process.exit(1)", { allowedExitCodes: [0, 1] })
  assert.equal(result.exitCode, 1)
})

test("external process runner classifies disallowed exit codes", async () => {
  await assert.rejects(
    runNode("process.stderr.write('failed'); process.exit(7)"),
    (error) => {
      assert.ok(error instanceof ExternalProcessError)
      assert.equal(error.kind, "nonZeroExit")
      assert.equal(error.exitCode, 7)
      assert.match(error.stderr.toString("utf8"), /failed/)
      return true
    }
  )
})

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
