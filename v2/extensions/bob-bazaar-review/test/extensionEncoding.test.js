const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { TextDecoder } = require("node:util")
const { test } = require("node:test")
const { extensionRoot } = require("./helpers/sourceReader")

const ignoredDirectoryNames = new Set([
  ".git",
  ".vscode-test",
  "node_modules",
  "out"
])

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

function collectExtensionFiles() {
  const files = []
  const pending = [extensionRoot]
  while (pending.length > 0) {
    const current = pending.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name)
      const relativePath = path.relative(extensionRoot, entryPath).replace(/\\/g, "/")
      if (entry.isDirectory()) {
        if (!ignoredDirectoryNames.has(entry.name)) pending.push(entryPath)
      } else if (entry.isFile()) {
        files.push(relativePath)
      }
    }
  }
  return files.sort()
}

function classifyTextEncoding(filePath) {
  const bytes = fs.readFileSync(path.join(extensionRoot, filePath))
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

test("extension text files use UTF-8 without BOM consistently", () => {
  const mismatches = collectExtensionFiles()
    .filter((filePath) => !binaryExtensions.has(path.extname(filePath).toLowerCase()))
    .map((filePath) => ({ filePath, encoding: classifyTextEncoding(filePath) }))
    .filter((entry) => entry.encoding !== "utf8")

  assert.deepEqual(mismatches, [])
})
