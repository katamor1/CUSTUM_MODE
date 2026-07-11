const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")
const { resolveWorkspacePathForKind } = require("../out/core/fileSystem")

test("generated artifact paths preserve meaningful inner spaces", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bob-generated-path-"))
  const resolved = resolveWorkspacePathForKind(
    workspaceRoot,
    ".custom/review package",
    "review-package-output"
  )
  assert.equal(path.relative(workspaceRoot, resolved), path.join(".custom", "review package"))
})

test("generated artifact paths reject silent whitespace and segment normalization", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bob-generated-path-"))
  for (const candidate of [
    " .custom/review-package",
    ".custom/review-package ",
    "\u00a0.custom/review-package",
    ".custom/ review-package",
    ".custom/review-package /nested",
    ".custom/./review-package",
    ".custom//review-package"
  ]) {
    assert.throws(
      () => resolveWorkspacePathForKind(workspaceRoot, candidate, "review-package-output"),
      /outer whitespace|segment whitespace|empty or \. segments/
    )
  }
})

test("generated artifact paths reject control characters before filesystem resolution", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bob-generated-path-"))
  for (const candidate of [
    ".custom/review\u0000package",
    ".custom/review\npackage",
    ".custom/review\tpackage"
  ]) {
    assert.throws(
      () => resolveWorkspacePathForKind(workspaceRoot, candidate, "review-package-output"),
      /control characters/
    )
  }
})
