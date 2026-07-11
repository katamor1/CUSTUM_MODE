const assert = require("node:assert/strict")
const { test } = require("node:test")
const { parseDiffFixture, parseDiffFixtureText } = require("../out/core/diffFixture")

test("diff fixture parser returns a normalized trusted summary", () => {
  const parsed = parseDiffFixture({
    vcs: "git",
    vcsRoot: ".",
    base: "main",
    head: "feature/fixture",
    files: [
      {
        path: "src\\payment review.ts",
        status: "modified",
        additions: 3,
        deletions: 1,
        is_test: false
      }
    ],
    unifiedDiff: "diff --git a/src/payment.ts b/src/payment.ts\n",
    warnings: ["fixture warning"],
    ignored: "not propagated"
  })

  assert.deepEqual(parsed, {
    vcs: "git",
    vcsRoot: ".",
    base: "main",
    head: "feature/fixture",
    files: [
      {
        path: "src/payment review.ts",
        status: "modified",
        additions: 3,
        deletions: 1,
        language: "typescript",
        is_test: false
      }
    ],
    unifiedDiff: "diff --git a/src/payment.ts b/src/payment.ts\n",
    warnings: ["fixture warning"]
  })
})

test("diff fixture parser defaults optional warnings and classifies languages", () => {
  const parsed = parseDiffFixture({
    base: "base",
    head: "head",
    files: [
      { path: "include/example.hpp", status: "added" }
    ]
  })

  assert.deepEqual(parsed.warnings, [])
  assert.equal(parsed.files[0].language, "hpp")
})

test("diff fixture text parser reports invalid JSON at the fixture boundary", () => {
  assert.throws(
    () => parseDiffFixtureText('{"base":"base",'),
    /diff fixture JSON is invalid/
  )
})

test("diff fixture parser rejects malformed roots and required fields", () => {
  for (const fixture of [
    null,
    [],
    {},
    { base: "", head: "head", files: [] },
    { base: "base", head: "", files: [] },
    { base: "base", head: "head", files: {} },
    { base: "base", head: "head", files: [], unifiedDiff: 42 },
    { base: "base", head: "head", files: [], warnings: ["ok", 42] },
    { base: "base", head: "head", files: [], vcs: "svn" }
  ]) {
    assert.throws(() => parseDiffFixture(fixture), /diff fixture/)
  }
})

test("diff fixture parser rejects invalid file records and metrics", () => {
  const invalidFiles = [
    null,
    { path: "src/example.ts", status: "changed" },
    { path: "src/example.ts", status: "modified", additions: -1 },
    { path: "src/example.ts", status: "modified", deletions: 1.5 },
    { path: "src/example.ts", status: "modified", language: "" },
    { path: "src/example.ts", status: "modified", is_test: "false" },
    { path: "src/example.ts", status: "modified", is_interface_candidate: 1 }
  ]

  for (const file of invalidFiles) {
    assert.throws(
      () => parseDiffFixture({ base: "base", head: "head", files: [file] }),
      /diff fixture\.files\[0\]/
    )
  }
})

test("diff fixture parser rejects duplicate normalized paths", () => {
  assert.throws(
    () => parseDiffFixture({
      base: "base",
      head: "head",
      files: [
        { path: "src\\example.ts", status: "modified" },
        { path: "src/example.ts", status: "added" }
      ]
    }),
    /duplicate changed file path/
  )
})
