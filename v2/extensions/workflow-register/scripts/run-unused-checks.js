#!/usr/bin/env node
"use strict"

const { spawnSync } = require("node:child_process")

const checks = [
  {
    label: "knip --production",
    command: "knip",
    args: ["--production", "--include", "dependencies,devDependencies,unlisted,unresolved,exports,types"],
  },
  { label: "ts-prune", command: "ts-prune", args: [] },
  { label: "depcheck", command: "depcheck", args: [".", "--ignore-bin-package", "--skip-missing"] },
]

const reported = []

for (const check of checks) {
  console.log(`\n[unused-report] ${check.label}`)
  const result = spawnSync(check.command, check.args, {
    cwd: process.cwd(),
    env: process.env,
    shell: process.platform === "win32",
    stdio: "inherit",
  })

  if (result.error) {
    reported.push(`${check.label}: ${result.error.message}`)
    continue
  }

  if (result.signal) {
    reported.push(`${check.label}: terminated by ${result.signal}`)
    continue
  }

  if (result.status !== 0) {
    reported.push(`${check.label}: exit ${result.status}`)
  }
}

if (reported.length > 0) {
  console.warn("\n[unused-report] Report-only findings or tool errors were observed:")
  for (const item of reported) {
    console.warn(`- ${item}`)
  }
  console.warn("[unused-report] Exiting 0 because this gate is intentionally report-only.")
} else {
  console.log("\n[unused-report] All unused-code tools completed with exit 0.")
}
