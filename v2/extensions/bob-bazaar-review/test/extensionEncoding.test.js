const assert = require("node:assert/strict")
const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")
const { TextDecoder } = require("node:util")
const { test } = require("node:test")
const { repoRoot } = require("./helpers/sourceReader")

const extensionRoots = [
  "extensions/workflow-register",
  "extensions/bob-bazaar-review",
  "extensions/bob-code-consistency-review"
]

const binaryExtensions = new Set([
  ".bmp",
  ".gif",
  ".ico",
  ".jpg",
  ".jpeg",
  ".pdf",
  ".png",
  ".vsix",
  ".webp",
  ".zip"
])

function gitTrackedExtensionFiles() {
  return execFileSync("git", ["ls-files", ...extensionRoots], {
    cwd: repoRoot,
    encoding: "utf8"
  }).split(/\r?\n/).filter(Boolean)
}

function classifyTextEncoding(filePath) {
  const bytes = fs.readFileSync(path.join(repoRoot, filePath))
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return "utf8-bom"
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return "utf16le-bom"
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return "utf16be-bom"
  }
  if (bytes.includes(0)) {
    return "binary-or-utf16-with-nul"
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return "utf8"
  } catch {
    return "invalid-utf8"
  }
}

test("tracked extension text files use UTF-8 without BOM consistently", () => {
  const mismatches = gitTrackedExtensionFiles()
    .filter((filePath) => !binaryExtensions.has(path.extname(filePath).toLowerCase()))
    .map((filePath) => ({ filePath, encoding: classifyTextEncoding(filePath) }))
    .filter((entry) => entry.encoding !== "utf8")

  assert.deepEqual(mismatches, [])
})
