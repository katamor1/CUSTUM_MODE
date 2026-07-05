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

test("workflow schema exports document compatibility and runtime boundaries", () => {
  const source = readSrc("core", "modelSchema.ts")

  assertJsDocForExport(source, "WorkflowSchemaVersion", [/WORKFLOW\.md/, /互換性契約/])
  assertJsDocForExport(source, "WorkflowActionDefinition", [/provider ID/, /guardrails/])
  assertJsDocForExport(source, "WorkflowArtifactDefinition", [/artifact path/, /生成物/])
  assertJsDocForExport(source, "CoreWorkflowDefinition", [/schema/, /runtime metadata/])
})

test("process schema exports document schema-version and human-gate contracts", () => {
  const source = readSrc("process", "processTypes.ts")

  assertJsDocForExport(source, "PROCESS_CATALOG_SCHEMA_VERSION", [/schemaVersion/, /互換性契約/])
  assertJsDocForExport(source, "ProcessInput", [/VCS/, /workspace/, /信頼境界/])
  assertJsDocForExport(source, "ProcessRecord", [/生成物/, /humanGate/])
})
