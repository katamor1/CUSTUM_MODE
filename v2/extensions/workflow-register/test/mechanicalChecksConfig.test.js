const assert = require("node:assert/strict")
const path = require("node:path")
const { test } = require("node:test")

const {
  parseMechanicalChecksConfig,
  validateMechanicalChecksConfig
} = require("../out/core/mechanicalChecks/config")

const workspaceRoot = path.resolve(__dirname, "..", "..", "..")

function validConfig(overrides = {}) {
  return {
    schema_version: "bob-mechanical-checks/v1",
    project_id: "product-a",
    profiles: [
      {
        id: "pre-code-review",
        title: "コードレビュー前チェック",
        gate: "pre_code_review",
        checks: ["build-warning-delta"]
      }
    ],
    checks: [
      {
        id: "build-warning-delta",
        title: "ビルド warning/error 増加チェック",
        runner: "node",
        command: "tools/check-build-delta.js",
        cwd: ".",
        args: ["{{inputs.baseRevision}}", "{{inputs.targetRevision}}"],
        timeout_seconds: 30,
        evidence: {
          collect: ["build/logs/**/*.log"]
        },
        parser: {
          type: "regex",
          warning_pattern: "warning",
          error_pattern: "error"
        },
        pass_condition: {
          max_new_warnings: 0,
          max_new_errors: 0
        }
      }
    ],
    ...overrides
  }
}

test("mechanical check config accepts safe profiles, checks, paths, and regex parser", () => {
  const result = validateMechanicalChecksConfig(validConfig(), { workspaceRoot })

  assert.equal(result.ok, true, result.diagnostics.join("\n"))
  assert.equal(result.config.profiles[0].id, "pre-code-review")
  assert.equal(result.config.checks[0].runner, "node")
  assert.deepEqual(result.config.checks[0].evidence.collect, ["build/logs/**/*.log"])
})

test("mechanical check config accepts SARIF and CSV parser definitions", () => {
  const result = validateMechanicalChecksConfig(validConfig({
    profiles: [
      {
        id: "pre-code-review",
        title: "コードレビュー前チェック",
        gate: "pre_code_review",
        checks: ["static-analysis-delta", "reviewed-file-list-match"]
      }
    ],
    checks: [
      {
        ...validConfig().checks[0],
        id: "static-analysis-delta",
        title: "静的解析 SARIF チェック",
        parser: {
          type: "sarif",
          input: "evidence"
        },
        evidence: {
          collect: ["out/analyzer/**/*.sarif"]
        }
      },
      {
        ...validConfig().checks[0],
        id: "reviewed-file-list-match",
        title: "レビュー済みファイル一覧 CSV チェック",
        parser: {
          type: "csv",
          input: "evidence",
          id_column: "code",
          file_column: "path",
          line_column: "row",
          message_column: "text",
          severity_column: "level"
        },
        evidence: {
          collect: ["out/review/**/*.csv"]
        }
      }
    ]
  }), { workspaceRoot })

  assert.equal(result.ok, true, result.diagnostics.join("\n"))
  assert.deepEqual(result.config.checks.map((check) => check.parser.type), ["sarif", "csv"])
  assert.equal(result.config.checks[1].parser.idColumn, "code")
  assert.equal(result.config.checks[1].parser.fileColumn, "path")
})

test("mechanical check config accepts delta evidence, identity columns, and new finding threshold", () => {
  const result = validateMechanicalChecksConfig(validConfig({
    checks: [
      {
        ...validConfig().checks[0],
        parser: {
          type: "sarif",
          input: "evidence",
          baseline_evidence: ["out/baseline/**/*.sarif"],
          target_evidence: ["out/target/**/*.sarif"],
          identity_columns: ["id", "file", "line"]
        },
        evidence: {
          collect: ["out/**/*.sarif"]
        },
        pass_condition: {
          max_new_findings: 0,
          allow_known_ids_file: ".bob/checks/known-static-analysis.txt"
        }
      }
    ]
  }), { workspaceRoot })

  assert.equal(result.ok, true, result.diagnostics.join("\n"))
  assert.deepEqual(result.config.checks[0].parser.baselineEvidence, ["out/baseline/**/*.sarif"])
  assert.deepEqual(result.config.checks[0].parser.targetEvidence, ["out/target/**/*.sarif"])
  assert.deepEqual(result.config.checks[0].parser.identityColumns, ["id", "file", "line"])
  assert.equal(result.config.checks[0].passCondition.maxNewFindings, 0)
})

test("mechanical check config rejects unsupported parser input values", () => {
  const result = validateMechanicalChecksConfig(validConfig({
    checks: [
      {
        ...validConfig().checks[0],
        parser: {
          type: "sarif",
          input: "bogus"
        },
        evidence: {
          collect: ["out/analyzer/**/*.sarif"]
        }
      }
    ]
  }), { workspaceRoot })

  assert.equal(result.ok, false)
  assert.match(result.diagnostics.join("\n"), /unsupported parser input 'bogus'/)
})

test("mechanical check config parses YAML into the normalized config shape", () => {
  const result = parseMechanicalChecksConfig(`
schema_version: bob-mechanical-checks/v1
project_id: product-a
profiles:
  - id: pre-code-review
    title: コードレビュー前チェック
    gate: pre_code_review
    checks:
      - javadoc-comment-rule
checks:
  - id: javadoc-comment-rule
    title: JavaDoc コメントチェック
    runner: powershell
    command: tools/check-comments.ps1
    args:
      - \${BASE_REVISION}
      - \${TARGET_REVISION}
    evidence:
      collect:
        - out/comment-check/*.csv
`)

  assert.equal(result.ok, true, result.diagnostics.join("\n"))
  assert.equal(result.config.projectId, "product-a")
  assert.equal(result.config.checks[0].runner, "powershell")
  assert.deepEqual(result.config.checks[0].args, ["${BASE_REVISION}", "${TARGET_REVISION}"])
})

test("mechanical check config rejects duplicate ids and unknown profile check references", () => {
  const result = validateMechanicalChecksConfig(validConfig({
    profiles: [
      {
        id: "pre-code-review",
        title: "コードレビュー前チェック",
        gate: "pre_code_review",
        checks: ["build-warning-delta", "missing-check"]
      },
      {
        id: "pre-code-review",
        title: "duplicate",
        gate: "pre_test_start",
        checks: ["build-warning-delta"]
      }
    ],
    checks: [
      validConfig().checks[0],
      { ...validConfig().checks[0], title: "duplicate" }
    ]
  }), { workspaceRoot })

  assert.equal(result.ok, false)
  assert.match(result.diagnostics.join("\n"), /Duplicate profile id 'pre-code-review'/)
  assert.match(result.diagnostics.join("\n"), /Duplicate check id 'build-warning-delta'/)
  assert.match(result.diagnostics.join("\n"), /references unknown check 'missing-check'/)
})

test("mechanical check config rejects unsupported runners, parser types, and unsafe paths", () => {
  const result = validateMechanicalChecksConfig(validConfig({
    checks: [
      {
        ...validConfig().checks[0],
        runner: "shell",
        command: "../tools/check-build-delta.bat",
        cwd: "C:/outside",
        evidence: {
          collect: ["../logs/**/*.log", "C:/tmp/result.txt"]
        },
        parser: {
          type: "xml",
          baseline_evidence: ["../baseline/**/*.sarif"],
          target_evidence: ["C:/target/**/*.sarif"]
        }
      }
    ]
  }), { workspaceRoot })

  assert.equal(result.ok, false)
  const diagnostics = result.diagnostics.join("\n")
  assert.match(diagnostics, /unsupported runner 'shell'/)
  assert.match(diagnostics, /command escapes the workspace/)
  assert.match(diagnostics, /cwd must be workspace-relative/)
  assert.match(diagnostics, /evidence collect path escapes the workspace/)
  assert.match(diagnostics, /unsupported parser type 'xml'/)
  assert.match(diagnostics, /baseline evidence path escapes the workspace/)
  assert.match(diagnostics, /target evidence path must be workspace-relative/)
})
