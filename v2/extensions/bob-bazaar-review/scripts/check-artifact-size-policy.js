#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")

function usage() {
  return [
    "Usage: node scripts/check-artifact-size-policy.js --max-bytes <bytes> <file-or-directory>...",
    "",
    "Checks every supplied file, and every file under supplied directories, against a per-file byte budget."
  ].join("\n")
}

function parseArgs(argv) {
  const maxBytesIndex = argv.indexOf("--max-bytes")
  if (maxBytesIndex === -1 || maxBytesIndex === argv.length - 1) {
    throw new Error("Missing required --max-bytes value")
  }

  const maxBytes = Number(argv[maxBytesIndex + 1])
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error(`Invalid --max-bytes value: ${argv[maxBytesIndex + 1]}`)
  }

  const targets = argv.filter((_, index) => index !== maxBytesIndex && index !== maxBytesIndex + 1)
  if (targets.length === 0) {
    throw new Error("At least one file or directory target is required")
  }

  return { maxBytes, targets }
}

function collectFiles(targetPath) {
  const stat = fs.statSync(targetPath)
  if (stat.isFile()) {
    return [targetPath]
  }
  if (!stat.isDirectory()) {
    return []
  }

  const files = []
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    const childPath = path.join(targetPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectFiles(childPath))
    } else if (entry.isFile()) {
      files.push(childPath)
    }
  }
  return files
}

function main() {
  const { maxBytes, targets } = parseArgs(process.argv.slice(2))
  const root = process.cwd()
  const files = targets.flatMap((target) => collectFiles(path.resolve(root, target)))
  if (files.length === 0) {
    throw new Error("No files matched artifact policy targets")
  }

  const violations = files
    .map((filePath) => ({ filePath, size: fs.statSync(filePath).size }))
    .filter(({ size }) => size > maxBytes)

  if (violations.length > 0) {
    for (const violation of violations) {
      const relativePath = path.relative(root, violation.filePath).replace(/\\/g, "/")
      console.error(`${relativePath}: ${violation.size} bytes exceeds ${maxBytes} bytes`)
    }
    process.exitCode = 1
    return
  }

  console.log(`Artifact size policy OK: ${files.length} files <= ${maxBytes} bytes`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  console.error(usage())
  process.exitCode = 1
}
