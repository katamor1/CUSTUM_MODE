#!/usr/bin/env node
"use strict"

const fs = require("node:fs")
const path = require("node:path")

function parseArgs(argv) {
  return {
    extensionRoot: path.resolve(process.cwd(), argv[0] ?? "."),
  }
}

function packageBudget(packageJson) {
  const match = String(packageJson.scripts?.["package:policy"] ?? "").match(/--max-bytes\s+(\d+)/)
  return match ? Number(match[1]) : undefined
}

function main() {
  const { extensionRoot } = parseArgs(process.argv.slice(2))
  const packageJsonPath = path.join(extensionRoot, "package.json")
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
  const vsixName = `${packageJson.name}-${packageJson.version}.vsix`
  const vsixPath = path.join(extensionRoot, vsixName)
  if (!fs.existsSync(vsixPath)) {
    throw new Error(`Missing ${vsixName}; run npm run package before package:metrics`)
  }

  const sizeBytes = fs.statSync(vsixPath).size
  const budget = packageBudget(packageJson)
  const budgetCell = typeof budget === "number" ? String(budget) : ""
  const usageCell = typeof budget === "number" ? `${((sizeBytes / budget) * 100).toFixed(1)}%` : ""
  const markdown = [
    "## VSIX Package Metrics",
    "",
    "| extension | version | vsix | size bytes | budget bytes | budget used |",
    "| --- | --- | --- | ---: | ---: | ---: |",
    `| ${packageJson.name} | ${packageJson.version} | ${vsixName} | ${sizeBytes} | ${budgetCell} | ${usageCell} |`,
    "",
  ].join("\n")

  process.stdout.write(markdown)
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown)
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
