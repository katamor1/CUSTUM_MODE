const assert = require("node:assert/strict")
const { test } = require("node:test")

const { readSrc } = require("./helpers/sourceReader")

function assertJsDocForExport(source, exportName, requiredTerms) {
  const pattern = new RegExp(`/\\*\\*((?:(?!\\*/)[\\s\\S])*)\\*/\\s*export\\s+(?:const|type|interface|class|async\\s+function|function)\\s+${exportName}(?:\\b|<)`)
  const match = source.match(pattern)
  assert.ok(match, `${exportName} must have JSDoc immediately before its export`)
  for (const term of requiredTerms) {
    assert.match(match[1], term, `${exportName} JSDoc must mention ${term}`)
  }
}

test("review record path APIs document workspace-relative artifact boundaries", () => {
  const source = readSrc("records", "reviewRecordPaths.ts")

  assertJsDocForExport(source, "resolveWorkspaceRelativePath", [/workspaceRoot/, /workspace 外/])
  assertJsDocForExport(source, "normalizeWorkspaceRelativePath", [/絶対パス/, /\.\./])
})

test("review record artifact writers document generated artifact side effects", () => {
  const source = readSrc("records", "reviewRecordStore.ts")

  assertJsDocForExport(source, "writeReviewRecord", [/\.bob-review-records/, /生成物/])
  assertJsDocForExport(source, "writeReviewPacketArtifactAtPath", [/workspace-relative/, /機密/])
})

test("project rules MCP tools document write-tool opt-in and cwd authority", () => {
  const source = readSrc("mcp", "projectRulesTools.ts")

  assertJsDocForExport(source, "ENABLE_WRITE_TOOLS_ENV", [/MCP write tool/, /opt-in/])
  assertJsDocForExport(source, "PROJECT_RULES_WRITE_TOOL_NAMES", [/副作用/, /allowlist/])
  assertJsDocForExport(source, "callProjectRulesTool", [/cwd/, /host/])
})
