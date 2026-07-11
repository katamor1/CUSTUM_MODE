const assert = require("node:assert/strict")
const test = require("node:test")

const { BazaarClient, validateRelativePath, validateRevision } = require("../out/bazaar/bazaar")

test("BazaarClient.cat separates option parsing before relative file paths", async () => {
  const client = new BazaarClient({ bzrPath: "bzr" })
  let captured
  client.exec = async (cwd, args) => {
    captured = { cwd, args }
    return { stdout: Buffer.from("content"), stderr: Buffer.alloc(0) }
  }

  await client.cat("C:\\repo", "123", "--help")

  assert.deepEqual(captured, {
    cwd: "C:\\repo",
    args: ["--no-aliases", "cat", "-r", "123", "--", "--help"]
  })
})

test("BazaarClient clamps command timeouts to the manifest range", async () => {
  const captured = []
  const processRunner = async (options) => {
    captured.push(options.timeoutMs)
    return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: 0 }
  }

  await new BazaarClient({ bzrPath: "bzr", timeoutMs: 1, processRunner }).status(process.cwd())
  await new BazaarClient({ bzrPath: "bzr", timeoutMs: Number.MAX_SAFE_INTEGER, processRunner }).status(process.cwd())
  await new BazaarClient({ bzrPath: "bzr", timeoutMs: Number.NaN, processRunner }).status(process.cwd())

  assert.deepEqual(captured, [1000, 600000, 120000])
})

test("validateRevision accepts expected Bazaar revision forms", () => {
  assert.equal(validateRevision("1234"), "1234")
  assert.equal(validateRevision("1.2.3"), "1.2.3")
  assert.equal(validateRevision("tag:release-1"), "tag:release-1")
  assert.equal(validateRevision("date:2026-07-04"), "date:2026-07-04")
  assert.equal(validateRevision("revid:user@example-20260627010101-abc"), "revid:user@example-20260627010101-abc")
})

test("validateRevision rejects option-like, range, oversized, and control-character specs", () => {
  assert.throws(() => validateRevision("--help"), /リビジョン指定/)
  assert.throws(() => validateRevision("-r1"), /リビジョン指定/)
  assert.throws(() => validateRevision("1..2"), /リビジョン指定/)
  assert.throws(() => validateRevision("a".repeat(129)), /長すぎます/)
  assert.throws(() => validateRevision("\n1234"), /安全でない Bazaar リビジョン指定/)
  assert.throws(() => validateRevision("1234\r"), /安全でない Bazaar リビジョン指定/)
})

test("validateRelativePath accepts repository-relative paths and option-like file names", () => {
  assert.equal(validateRelativePath("src/main.c"), "src/main.c")
  assert.equal(validateRelativePath("dir\\nested\\file.txt"), "dir/nested/file.txt")
  assert.equal(validateRelativePath("--help"), "--help")
  assert.equal(validateRelativePath("dir/--help"), "dir/--help")
})

test("validateRelativePath rejects POSIX and Windows absolute or drive-relative paths", () => {
  for (const candidate of [
    "/etc/passwd",
    "C:\\secret.txt",
    "C:/secret.txt",
    "C:secret.txt",
    "\\\\server\\share\\secret.txt",
    "\\\\?\\C:\\secret.txt",
    "\\\\.\\pipe\\name"
  ]) {
    assert.throws(() => validateRelativePath(candidate), /安全でない Bazaar パス/)
  }
})

test("validateRelativePath rejects traversal, dot, empty, control-character, and outer-whitespace paths", () => {
  for (const candidate of [
    "../secret.txt",
    "a/../secret.txt",
    "a/./b.txt",
    "a//b.txt",
    "./file.txt",
    "a/\u0001b.txt",
    "\nsrc/main.c",
    "src/main.c\r",
    " src/main.c",
    "src/main.c ",
    "\u00a0src/main.c",
    ""
  ]) {
    assert.throws(() => validateRelativePath(candidate), /Bazaar パス|親ディレクトリ/)
  }
})
