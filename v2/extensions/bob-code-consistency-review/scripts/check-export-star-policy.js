#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")

function usage() {
  return [
    "Usage: node scripts/check-export-star-policy.js <file-or-directory>... [--allow <relative-path>...]",
    "",
    "Checks TypeScript sources for export-star barrels. Allowed paths are relative to the current working directory."
  ].join("\n")
}

function parseArgs(argv) {
  const targets = []
  const allowed = new Set()
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === "--allow") {
      const allowedPath = argv[index + 1]
      if (!allowedPath) throw new Error("Missing --allow path")
      allowed.add(normalizeRelative(allowedPath))
      index += 1
    } else {
      targets.push(value)
    }
  }
  if (targets.length === 0) throw new Error("At least one file or directory target is required")
  return { targets, allowed }
}

function normalizeRelative(value) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "")
}

function collectTsFiles(targetPath) {
  const stat = fs.statSync(targetPath)
  if (stat.isFile()) return targetPath.endsWith(".ts") ? [targetPath] : []
  if (!stat.isDirectory()) return []

  const files = []
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    const childPath = path.join(targetPath, entry.name)
    if (entry.isDirectory()) files.push(...collectTsFiles(childPath))
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(childPath)
  }
  return files
}

function main() {
  const { targets, allowed } = parseArgs(process.argv.slice(2))
  const root = process.cwd()
  const files = targets.flatMap((target) => collectTsFiles(path.resolve(root, target)))
  const violations = []

  for (const filePath of files) {
    const relativePath = normalizeRelative(path.relative(root, filePath))
    if (allowed.has(relativePath)) continue
    const source = fs.readFileSync(filePath, "utf8")
    if (/^\s*export\s+\*\s+from\s+/m.test(source)) violations.push(relativePath)
  }

  if (violations.length > 0) {
    for (const violation of violations) console.error(`${violation}: export * is not allowed`)
    process.exitCode = 1
    return
  }

  console.log(`Export-star policy OK: ${files.length} TypeScript files checked`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  console.error(usage())
  process.exitCode = 1
}
