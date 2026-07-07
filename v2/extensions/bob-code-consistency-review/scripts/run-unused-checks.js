#!/usr/bin/env node
"use strict"

const { spawnSync } = require("node:child_process")

const checks = [
  ["knip --production", "knip", ["--production", "--include", "dependencies,devDependencies,unlisted,unresolved,exports,types"]],
  ["ts-prune", "ts-prune", []],
  ["depcheck", "depcheck", [".", "--ignore-bin-package", "--skip-missing"]]
]

const reported = []

for (const [label, command, args] of checks) {
  console.log(`\n[unused-report] ${label}`)
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    shell: process.platform === "win32",
    stdio: "inherit"
  })
  if (result.error) reported.push(`${label}: ${result.error.message}`)
  else if (result.signal) reported.push(`${label}: terminated by ${result.signal}`)
  else if (result.status !== 0) reported.push(`${label}: exit ${result.status}`)
}

if (reported.length > 0) {
  console.warn("\n[unused-report] Report-only findings or tool errors were observed:")
  for (const item of reported) console.warn(`- ${item}`)
  console.warn("[unused-report] Exiting 0 because this gate is intentionally report-only.")
} else {
  console.log("\n[unused-report] All unused-code tools completed with exit 0.")
}
