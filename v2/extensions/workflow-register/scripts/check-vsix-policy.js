#!/usr/bin/env node
"use strict"

const fs = require("node:fs")
const path = require("node:path")

function parseArgs(argv) {
  const args = { maxBytes: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--max-bytes") {
      const value = Number(argv[index + 1])
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error("--max-bytes must be a positive integer")
      }
      args.maxBytes = value
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  if (!args.maxBytes) {
    throw new Error("Missing required --max-bytes")
  }
  return args
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

function findEndOfCentralDirectory(buffer) {
  const signature = 0x06054b50
  const minOffset = Math.max(0, buffer.length - 0xffff - 22)
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) {
      return offset
    }
  }
  throw new Error("Could not find ZIP end of central directory")
}

function readZipEntries(zipPath) {
  const buffer = fs.readFileSync(zipPath)
  const eocdOffset = findEndOfCentralDirectory(buffer)
  const entryCount = buffer.readUInt16LE(eocdOffset + 10)
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16)
  const entries = []
  let offset = centralDirectoryOffset

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`Invalid ZIP central directory entry at offset ${offset}`)
    }
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const uncompressedSize = buffer.readUInt32LE(offset + 24)
    const fileNameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const fileName = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength)
    entries.push({ fileName, compressedSize, uncompressedSize })
    offset += 46 + fileNameLength + extraLength + commentLength
  }

  return entries
}

function normalizeMain(main) {
  return `extension/${main.replace(/^\.\//, "").replace(/\\/g, "/")}`
}

function checkForbiddenEntries(entries) {
  const rules = [
    { pattern: /^extension\/src\//, reason: "source directory" },
    { pattern: /^extension\/tests?\//, reason: "test directory" },
    { pattern: /^extension\/docs\//, reason: "development documentation" },
    { pattern: /^extension\/\.vscode\//, reason: "editor settings" },
    { pattern: /^extension\/\.vscode-test\.json$/, reason: "generated VS Code test configuration" },
    { pattern: /^extension\/\.git\//, reason: "git metadata" },
    { pattern: /^extension\/package-lock\.json$/, reason: "package lock" },
    { pattern: /^extension\/tsconfig\.json$/, reason: "TypeScript config" },
    { pattern: /^extension\/.*\.tsbuildinfo$/, reason: "TypeScript incremental build info" },
    { pattern: /^extension\/.*\.vsix$/, reason: "nested VSIX" },
    { pattern: /^extension\/out\/.*\.map$/, reason: "compiled extension source map" }
  ]

  const violations = []
  for (const entry of entries) {
    for (const rule of rules) {
      if (rule.pattern.test(entry.fileName)) {
        violations.push(`${entry.fileName} (${rule.reason})`)
      }
    }
  }
  return violations
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const extensionRoot = process.cwd()
  const packageJson = readJson(path.join(extensionRoot, "package.json"))
  const vsixName = `${packageJson.name}-${packageJson.version}.vsix`
  const vsixPath = path.join(extensionRoot, vsixName)
  if (!fs.existsSync(vsixPath)) {
    throw new Error(`Missing ${vsixName}; run npm run package before package:policy`)
  }

  const stat = fs.statSync(vsixPath)
  const entries = readZipEntries(vsixPath)
  const entryNames = new Set(entries.map((entry) => entry.fileName))
  const errors = []

  if (stat.size > args.maxBytes) {
    errors.push(`${vsixName} is ${stat.size} bytes, above budget ${args.maxBytes}`)
  }

  const mainEntry = normalizeMain(packageJson.main)
  for (const requiredEntry of ["extension/package.json", mainEntry]) {
    if (!entryNames.has(requiredEntry)) {
      errors.push(`Missing required VSIX entry: ${requiredEntry}`)
    }
  }

  for (const violation of checkForbiddenEntries(entries)) {
    errors.push(`Forbidden VSIX entry: ${violation}`)
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(error)
    }
    process.exit(1)
  }

  console.log(`VSIX policy OK: ${vsixName} (${stat.size} bytes, ${entries.length} entries)`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
