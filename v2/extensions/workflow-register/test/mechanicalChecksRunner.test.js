const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { validateMechanicalChecksConfig } = require("../out/core/mechanicalChecks/config")
const { runMechanicalChecksProfile } = require("../out/core/mechanicalChecks/runner")

function tempWorkspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mechanical-checks-runner-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function writeFile(root, relativePath, text) {
  const filePath = path.join(root, ...relativePath.split("/"))
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, text)
  return filePath
}

function configFor(checks, profileChecks = checks.map((check) => check.id)) {
  const raw = {
    schema_version: "bob-mechanical-checks/v1",
    project_id: "product-a",
    profiles: [
      {
        id: "pre-code-review",
        title: "コードレビュー前チェック",
        gate: "pre_code_review",
        checks: profileChecks
      }
    ],
    checks
  }
  const validated = validateMechanicalChecksConfig(raw)
  assert.equal(validated.ok, true, validated.diagnostics.join("\n"))
  return validated.config
}

test("mechanical check runner executes node checks and writes profile and evidence artifacts", async (t) => {
  const workspaceRoot = tempWorkspace(t)
  writeFile(workspaceRoot, "tools/pass.js", [
    "const fs = require('node:fs')",
    "fs.mkdirSync('build/logs', { recursive: true })",
    "fs.writeFileSync('build/logs/check.log', 'clean build\\n')",
    "console.log('mechanical check passed')"
  ].join("\n"))
  const config = configFor([
    {
      id: "build-warning-delta",
      title: "Build warning delta",
      runner: "node",
      command: "tools/pass.js",
      cwd: ".",
      evidence: { collect: ["build/logs/**/*.log"] }
    }
  ])

  const result = await runMechanicalChecksProfile({
    workspaceRoot,
    config,
    profile: "pre-code-review",
    runId: "run-pass",
    now: () => "2026-07-05T00:00:00.000Z"
  })

  assert.equal(result.status, "passed")
  assert.equal(result.run_id, "run-pass")
  assert.equal(result.checks_total, 1)
  assert.equal(result.passed, 1)
  assert.equal(result.checks[0].status, "passed")
  assert.equal(result.checks[0].exit_code, 0)
  assert.match(fs.readFileSync(path.join(workspaceRoot, ".bob", "mechanical-checks", "runs", "run-pass", "profile-summary.md"), "utf8"), /Build warning delta/)
  assert.ok(fs.existsSync(path.join(workspaceRoot, ".bob", "mechanical-checks", "runs", "run-pass", "profile-result.json")))
  assert.ok(fs.existsSync(path.join(workspaceRoot, ".bob", "mechanical-checks", "runs", "run-pass", "checks", "build-warning-delta", "stdout.log")))
  assert.equal(
    fs.readFileSync(path.join(workspaceRoot, ".bob", "mechanical-checks", "runs", "run-pass", "checks", "build-warning-delta", "evidence", "build", "logs", "check.log"), "utf8"),
    "clean build\n"
  )
})

test("mechanical check runner maps regex pass-condition violations to failed or warning", async (t) => {
  const workspaceRoot = tempWorkspace(t)
  writeFile(workspaceRoot, "tools/warn.js", "console.log('warning MC-WARN-001')\n")
  const baseCheck = {
    id: "warning-delta",
    title: "Warning delta",
    runner: "node",
    command: "tools/warn.js",
    parser: { type: "regex", warning_pattern: "warning" },
    pass_condition: { max_new_warnings: 0 }
  }

  const failed = await runMechanicalChecksProfile({
    workspaceRoot,
    config: configFor([baseCheck]),
    profile: "pre-code-review",
    runId: "run-failed"
  })
  const warning = await runMechanicalChecksProfile({
    workspaceRoot,
    config: configFor([{ ...baseCheck, allow_failure: true }]),
    profile: "pre-code-review",
    runId: "run-warning"
  })

  assert.equal(failed.status, "failed")
  assert.equal(failed.failed, 1)
  assert.equal(failed.checks[0].metrics.new_warnings, 1)
  assert.match(failed.checks[0].summary, /new warnings 1 exceeds limit 0/)
  assert.equal(warning.status, "warning")
  assert.equal(warning.warnings, 1)
  assert.equal(warning.failed, 0)
})

test("mechanical check runner writes normalized parser findings into check results", async (t) => {
  const workspaceRoot = tempWorkspace(t)
  writeFile(workspaceRoot, "tools/write-sarif.js", [
    "const fs = require('node:fs')",
    "fs.mkdirSync('out/analyzer', { recursive: true })",
    "fs.writeFileSync('out/analyzer/result.sarif', JSON.stringify({",
    "  version: '2.1.0',",
    "  runs: [{ results: [{",
    "    ruleId: 'SA001',",
    "    level: 'error',",
    "    message: { text: 'Null dereference' },",
    "    locations: [{ physicalLocation: { artifactLocation: { uri: 'src/foo.c' }, region: { startLine: 10 } } }]",
    "  }] }]",
    "}))"
  ].join("\n"))
  const config = configFor([
    {
      id: "static-analysis-delta",
      title: "Static analysis delta",
      runner: "node",
      command: "tools/write-sarif.js",
      evidence: { collect: ["out/analyzer/**/*.sarif"] },
      parser: { type: "sarif", input: "evidence" }
    }
  ])

  const result = await runMechanicalChecksProfile({
    workspaceRoot,
    config,
    profile: "pre-code-review",
    runId: "run-sarif"
  })

  assert.equal(result.status, "passed")
  assert.equal(result.checks[0].metrics.total_findings, 1)
  assert.equal(result.checks[0].findings[0].id, "SA001")
  assert.equal(result.checks[0].findings[0].file, "src/foo.c")
  assert.equal(result.checks[0].findings[0].line, 10)
  const summary = fs.readFileSync(path.join(workspaceRoot, ".bob", "mechanical-checks", "runs", "run-sarif", "profile-summary.md"), "utf8")
  assert.match(summary, /New findings/)
  assert.match(summary, /Known findings/)
  assert.match(summary, /SA001: Null dereference/)
})

test("mechanical check runner applies known IDs file and max new findings gate", async (t) => {
  const workspaceRoot = tempWorkspace(t)
  writeFile(workspaceRoot, ".bob/checks/known-static-analysis.txt", [
    "# accepted existing analyzer finding",
    "SA001"
  ].join("\n"))
  writeFile(workspaceRoot, "tools/write-known-and-new-sarif.js", [
    "const fs = require('node:fs')",
    "fs.mkdirSync('out/analyzer', { recursive: true })",
    "fs.writeFileSync('out/analyzer/result.sarif', JSON.stringify({",
    "  runs: [{ results: [",
    "    { ruleId: 'SA001', level: 'error', message: { text: 'Known issue' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'src/foo.c' }, region: { startLine: 10 } } }] },",
    "    { ruleId: 'SA002', level: 'warning', message: { text: 'New issue' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'src/bar.c' }, region: { startLine: 20 } } }] }",
    "  ] }]",
    "}))"
  ].join("\n"))
  const config = configFor([
    {
      id: "static-analysis-delta",
      title: "Static analysis delta",
      runner: "node",
      command: "tools/write-known-and-new-sarif.js",
      evidence: { collect: ["out/analyzer/**/*.sarif"] },
      parser: { type: "sarif", input: "evidence" },
      pass_condition: {
        max_new_findings: 0,
        allow_known_ids_file: ".bob/checks/known-static-analysis.txt"
      }
    }
  ])

  const result = await runMechanicalChecksProfile({
    workspaceRoot,
    config,
    profile: "pre-code-review",
    runId: "run-known"
  })

  assert.equal(result.status, "failed")
  assert.equal(result.checks[0].metrics.total_findings, 2)
  assert.equal(result.checks[0].metrics.known_findings, 1)
  assert.equal(result.checks[0].metrics.new_findings, 1)
  assert.deepEqual(result.checks[0].findings.map((finding) => finding.id), ["SA002"])
  assert.match(result.checks[0].summary, /new findings 1 exceeds limit 0/)
})

test("mechanical check runner reports missing regex evidence as blocked", async (t) => {
  const workspaceRoot = tempWorkspace(t)
  writeFile(workspaceRoot, "tools/no-evidence.js", "console.log('no evidence written')\n")
  const config = configFor([
    {
      id: "missing-evidence",
      title: "Missing evidence",
      runner: "node",
      command: "tools/no-evidence.js",
      evidence: { collect: ["out/missing/**/*.log"] },
      parser: { type: "regex", input: "evidence", warning_pattern: "warning" },
      pass_condition: { max_new_warnings: 0 }
    }
  ])

  const result = await runMechanicalChecksProfile({
    workspaceRoot,
    config,
    profile: "pre-code-review",
    runId: "run-missing-evidence"
  })

  assert.equal(result.status, "blocked")
  assert.equal(result.checks[0].status, "blocked")
  assert.match(result.checks[0].summary, /regex evidence not found/)
})

test("mechanical check runner reports missing scripts and timeouts as blocked", async (t) => {
  const workspaceRoot = tempWorkspace(t)
  writeFile(workspaceRoot, "tools/sleep.js", "setTimeout(() => console.log('late'), 2000)\n")
  const result = await runMechanicalChecksProfile({
    workspaceRoot,
    config: configFor([
      {
        id: "missing-script",
        title: "Missing script",
        runner: "node",
        command: "tools/missing.js"
      },
      {
        id: "timeout-script",
        title: "Timeout script",
        runner: "node",
        command: "tools/sleep.js",
        timeout_seconds: 0.05
      }
    ]),
    profile: "pre-code-review",
    runId: "run-blocked"
  })

  assert.equal(result.status, "blocked")
  assert.equal(result.blocked, 2)
  assert.match(result.checks[0].summary, /script not found/)
  assert.match(result.checks[1].summary, /timed out/)
  assert.ok(fs.existsSync(path.join(workspaceRoot, ".bob", "mechanical-checks", "runs", "run-blocked", "checks", "timeout-script", "stderr.log")))
})
