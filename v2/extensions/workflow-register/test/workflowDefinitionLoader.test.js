const assert = require("node:assert/strict")
const { test } = require("node:test")
const { readSrc, readSourceSet } = require("./helpers/sourceReader")

test("Bob registration uses the workflow compiler as the only parsed workflow source", () => {
  const source = readSourceSet([
    "workflowDefinitionLoader.ts",
    "workflowDiscovery.ts",
    "workflowAdapter.ts"
  ])

  assert.match(source, /compileWorkflowDocument\(\{ sourceId, filePath: candidate\.relativePath, text, strict: true \}\)/)
  assert.match(source, /if \(!compiled\.ok \|\| !compiled\.workflow\) return \{ diagnostics \}/)
  assert.match(source, /adaptCoreWorkflowForBob\(/)
  assert.ok(source.indexOf("!compiled.ok") < source.indexOf("adaptCoreWorkflowForBob(coreWorkflow"))
  assert.doesNotMatch(source, /loadCoreWorkspaceWorkflows/)
  assert.doesNotMatch(source, /parseWorkflowMarkdown\(/)
  assert.doesNotMatch(source, /parseYamlFrontMatter\(split\.frontMatter\)/)
})

test("workflow definition loading separates discovery, adapter, and diagnostics responsibilities", () => {
  const source = readSourceSet([
    "workflowDefinitionLoader.ts",
    "workflowDiscovery.ts",
    "workflowAdapter.ts",
    "workflowDiagnostics.ts"
  ])

  assert.match(source, /export async function discoverWorkspaceWorkflowFiles\(\): Promise<WorkflowDiscoveryResult>/)
  assert.match(source, /new vscode\.RelativePattern\(root\.root, "\.bob\/workflows\/\*\/WORKFLOW\.md"\)/)
  assert.match(source, /export function adaptCoreWorkflowForBob\(core: CoreWorkflowDefinition, file: vscode\.Uri\): WorkflowDefinition/)
  assert.match(source, /export function qualifyDuplicateWorkflowIds\(/)
  assert.match(source, /export function validateAndDescribeWorkflow\(input: WorkflowDiagnosticsInput\): WorkflowDiagnosticsResult/)
  assert.match(source, /validateAndDescribeWorkflow\(\{[\s\S]*relativePath: candidate\.relativePath[\s\S]*folderName: candidate\.folderName[\s\S]*workflow[\s\S]*\}\)/)
})

test("workflow definition loading blocks strict compiler diagnostics before registration", () => {
  const source = readSrc("workflowDefinitionLoader.ts")

  assert.match(source, /compileWorkflowDocument\(\{ sourceId, filePath: candidate\.relativePath, text, strict: true \}\)/)
  assert.match(source, /diagnostics\.push\(\.\.\.formatWorkflowDiagnostics\(compiled\)\)/)
  assert.ok(source.indexOf("!compiled.ok") < source.indexOf("adaptCoreWorkflowForBob(coreWorkflow"))
})
