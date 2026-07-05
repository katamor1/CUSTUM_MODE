const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { parseMechanicalCheckOutput } = require("../out/core/mechanicalChecks/parser")

function tempWorkspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mechanical-checks-parser-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function writeFile(root, relativePath, text) {
  const filePath = path.join(root, ...relativePath.split("/"))
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, text)
  return filePath
}

test("mechanical check parser keeps regex warning and error counts from process output and evidence", async (t) => {
  const workspaceRoot = tempWorkspace(t)
  const evidencePath = writeFile(workspaceRoot, ".bob/mechanical-checks/runs/run/checks/regex/evidence/build/logs/check.log", [
    "warning W-MC-001",
    "error E-MC-001"
  ].join("\n"))

  const result = await parseMechanicalCheckOutput({
    workspaceRoot,
    parser: {
      type: "regex",
      warningPattern: "warning",
      errorPattern: "error"
    },
    processResult: {
      stdout: "warning W-MC-002",
      stderr: "error E-MC-002",
      timedOut: false
    },
    evidence: [
      {
        absolutePath: evidencePath,
        relativePath: "build/logs/check.log",
        type: "log"
      }
    ]
  })

  assert.equal(result.ok, true, result.reason)
  assert.deepEqual(result.metrics, {
    new_warnings: 2,
    new_errors: 2
  })
  assert.deepEqual(result.findings, [])
})

test("mechanical check parser normalizes unique SARIF results from evidence", async (t) => {
  const workspaceRoot = tempWorkspace(t)
  const sarifPath = writeFile(workspaceRoot, ".bob/mechanical-checks/runs/run/checks/sarif/evidence/out/analyzer/result.sarif", JSON.stringify({
    version: "2.1.0",
    runs: [
      {
        results: [
          {
            ruleId: "SA001",
            level: "error",
            message: { text: "Null dereference" },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: "src/foo.c" },
                  region: { startLine: 10 }
                }
              }
            ]
          },
          {
            ruleId: "SA001",
            level: "error",
            message: { text: "Null dereference" },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: "src/foo.c" },
                  region: { startLine: 10 }
                }
              }
            ]
          },
          {
            ruleId: "SA002",
            level: "warning",
            message: { text: "Missing region still parses" },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: "src/bar.c" }
                }
              }
            ]
          }
        ]
      }
    ]
  }))

  const result = await parseMechanicalCheckOutput({
    workspaceRoot,
    parser: { type: "sarif", input: "evidence" },
    processResult: { stdout: "", stderr: "", timedOut: false },
    evidence: [
      {
        absolutePath: sarifPath,
        relativePath: "out/analyzer/result.sarif",
        type: "sarif"
      }
    ]
  })

  assert.equal(result.ok, true, result.reason)
  assert.deepEqual(result.metrics, {
    total_findings: 2,
    new_findings: 2,
    violations: 2
  })
  assert.deepEqual(result.findings.map((finding) => ({
    id: finding.id,
    file: finding.file,
    line: finding.line,
    message: finding.message,
    severity: finding.severity
  })), [
    {
      id: "SA001",
      file: "src/foo.c",
      line: 10,
      message: "Null dereference",
      severity: "error"
    },
    {
      id: "SA002",
      file: "src/bar.c",
      line: undefined,
      message: "Missing region still parses",
      severity: "warning"
    }
  ])
})

test("mechanical check parser reports malformed SARIF as blocked parse result", async (t) => {
  const workspaceRoot = tempWorkspace(t)
  const sarifPath = writeFile(workspaceRoot, ".bob/mechanical-checks/runs/run/checks/sarif/evidence/out/analyzer/bad.sarif", "{not-json")

  const result = await parseMechanicalCheckOutput({
    workspaceRoot,
    parser: { type: "sarif", input: "evidence" },
    processResult: { stdout: "", stderr: "", timedOut: false },
    evidence: [
      {
        absolutePath: sarifPath,
        relativePath: "out/analyzer/bad.sarif",
        type: "sarif"
      }
    ]
  })

  assert.equal(result.ok, false)
  assert.match(result.reason, /failed to parse SARIF/)
})

test("mechanical check parser normalizes CSV findings with custom columns and quoted values", async (t) => {
  const workspaceRoot = tempWorkspace(t)
  const csvPath = writeFile(workspaceRoot, ".bob/mechanical-checks/runs/run/checks/csv/evidence/out/review/mismatch.csv", [
    "code,path,row,text,level",
    "REV001,src/foo.c,12,\"Missing reviewed file, target changed\",error",
    "REV002,src/bar.c,not-a-number,Extra reviewed file,warning"
  ].join("\n"))

  const result = await parseMechanicalCheckOutput({
    workspaceRoot,
    parser: {
      type: "csv",
      input: "evidence",
      idColumn: "code",
      fileColumn: "path",
      lineColumn: "row",
      messageColumn: "text",
      severityColumn: "level"
    },
    processResult: { stdout: "", stderr: "", timedOut: false },
    evidence: [
      {
        absolutePath: csvPath,
        relativePath: "out/review/mismatch.csv",
        type: "csv"
      }
    ]
  })

  assert.equal(result.ok, true, result.reason)
  assert.deepEqual(result.metrics, {
    total_findings: 2,
    new_findings: 2,
    violations: 2
  })
  assert.equal(result.findings[0].message, "Missing reviewed file, target changed")
  assert.equal(result.findings[0].line, 12)
  assert.equal(result.findings[1].line, undefined)
  assert.deepEqual(result.findings.map((finding) => finding.severity), ["error", "warning"])
})

test("mechanical check parser reports only target findings absent from baseline evidence", async (t) => {
  const workspaceRoot = tempWorkspace(t)
  const baselinePath = writeFile(workspaceRoot, ".bob/mechanical-checks/runs/run/checks/sarif/evidence/out/baseline/result.sarif", JSON.stringify({
    runs: [
      {
        results: [
          {
            ruleId: "SA001",
            level: "error",
            message: { text: "Known baseline issue" },
            locations: [{ physicalLocation: { artifactLocation: { uri: "src/foo.c" }, region: { startLine: 10 } } }]
          }
        ]
      }
    ]
  }))
  const targetPath = writeFile(workspaceRoot, ".bob/mechanical-checks/runs/run/checks/sarif/evidence/out/target/result.sarif", JSON.stringify({
    runs: [
      {
        results: [
          {
            ruleId: "SA001",
            level: "error",
            message: { text: "Known baseline issue" },
            locations: [{ physicalLocation: { artifactLocation: { uri: "src/foo.c" }, region: { startLine: 10 } } }]
          },
          {
            ruleId: "SA002",
            level: "warning",
            message: { text: "New target issue" },
            locations: [{ physicalLocation: { artifactLocation: { uri: "src/bar.c" }, region: { startLine: 20 } } }]
          }
        ]
      }
    ]
  }))

  const result = await parseMechanicalCheckOutput({
    workspaceRoot,
    parser: {
      type: "sarif",
      input: "evidence",
      baselineEvidence: ["out/baseline/**/*.sarif"],
      targetEvidence: ["out/target/**/*.sarif"],
      identityColumns: ["id", "file", "line"]
    },
    processResult: { stdout: "", stderr: "", timedOut: false },
    evidence: [
      { absolutePath: baselinePath, relativePath: "out/baseline/result.sarif", type: "sarif" },
      { absolutePath: targetPath, relativePath: "out/target/result.sarif", type: "sarif" }
    ]
  })

  assert.equal(result.ok, true, result.reason)
  assert.deepEqual(result.metrics, {
    total_findings: 2,
    new_findings: 1,
    known_findings: 0,
    violations: 1
  })
  assert.deepEqual(result.findings.map((finding) => finding.id), ["SA002"])
})

test("mechanical check parser excludes configured known IDs and fingerprints from new findings", async (t) => {
  const workspaceRoot = tempWorkspace(t)
  const csvPath = writeFile(workspaceRoot, ".bob/mechanical-checks/runs/run/checks/csv/evidence/out/review/mismatch.csv", [
    "id,file,line,message,severity",
    "REV001,src/foo.c,12,Missing reviewed file,error",
    "REV002,src/bar.c,34,Known mismatch,warning"
  ].join("\n"))

  const result = await parseMechanicalCheckOutput({
    workspaceRoot,
    parser: { type: "csv", input: "evidence" },
    processResult: { stdout: "", stderr: "", timedOut: false },
    evidence: [
      { absolutePath: csvPath, relativePath: "out/review/mismatch.csv", type: "csv" }
    ],
    knownIds: new Set(["REV002"])
  })

  assert.equal(result.ok, true, result.reason)
  assert.deepEqual(result.metrics, {
    total_findings: 2,
    new_findings: 1,
    known_findings: 1,
    violations: 1
  })
  assert.deepEqual(result.findings.map((finding) => finding.id), ["REV001"])
})
