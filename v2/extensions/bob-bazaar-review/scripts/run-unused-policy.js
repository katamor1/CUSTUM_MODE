#!/usr/bin/env node
"use strict"

const { spawnSync } = require("node:child_process")

const checks = [
  ["knip dependency policy", "knip", ["--production", "--include", "dependencies,unlisted,unresolved"]],
  ["depcheck dependency policy", "depcheck", [".", "--ignore-bin-package", "--skip-missing"]]
]

const failures = []

for (const [label, command, args] of checks) {
  console.log(`\n[unused-policy] ${label}`)
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    shell: process.platform === "win32",
    stdio: "inherit"
  })
  if (result.error) failures.push(`${label}: ${result.error.message}`)
  else if (result.signal) failures.push(`${label}: terminated by ${result.signal}`)
  else if (result.status !== 0) failures.push(`${label}: exit ${result.status}`)
}

if (failures.length > 0) {
  console.error("\n[unused-policy] Failing unused dependency policy:")
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log("\n[unused-policy] Dependency, unlisted, and unresolved checks passed.")
}
