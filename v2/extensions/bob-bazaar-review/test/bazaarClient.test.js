const assert = require("node:assert/strict")
const test = require("node:test")

const { BazaarClient, validateRevision } = require("../out/bazaar")

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

test("validateRevision accepts expected Bazaar revision forms", () => {
  assert.equal(validateRevision("1234"), "1234")
  assert.equal(validateRevision("1.2.3"), "1.2.3")
  assert.equal(validateRevision("tag:release-1"), "tag:release-1")
  assert.equal(validateRevision("date:2026-07-04"), "date:2026-07-04")
  assert.equal(validateRevision("revid:user@example-20260627010101-abc"), "revid:user@example-20260627010101-abc")
})

test("validateRevision rejects option-like, range, and oversized specs", () => {
  assert.throws(() => validateRevision("--help"), /リビジョン指定/)
  assert.throws(() => validateRevision("-r1"), /リビジョン指定/)
  assert.throws(() => validateRevision("1..2"), /リビジョン指定/)
  assert.throws(() => validateRevision("a".repeat(129)), /長すぎます/)
})
