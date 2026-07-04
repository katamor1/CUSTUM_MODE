const assert = require("node:assert/strict")
const { test } = require("node:test")
const { readSrc, readSourceSet } = require("./helpers/sourceReader")

test("Bob registration uses CoreWorkflowDefinition as the only parsed workflow source", () => {
  const source = readSourceSet([
    "workflowDefinitionLoader.ts",
    "workflowDiscovery.ts",
    "workflowAdapter.ts"
  ])

  assert.match(source, /parseWorkflowMarkdown\(\{ sourceId, filePath: candidate\.relativePath, text \}\)/)
  assert.match(source, /adaptCoreWorkflowForBob\(/)
  assert.doesNotMatch(source, /loadCoreWorkspaceWorkflows/)
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

test("workflow definition loading blocks parser warnings before registration", () => {
  const source = readSrc("workflowDefinitionLoader.ts")

  assert.match(source, /const parserWarnings = parsed\.diagnostics\.filter\(isParserWarning\)/)
  assert.match(source, /workflow registration is strict; resolve parser warnings before registration/)
  assert.ok(source.indexOf("parserWarnings.length > 0") < source.indexOf("adaptCoreWorkflowForBob(coreWorkflow"))
})
