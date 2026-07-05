const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const { parseWorkflowMarkdown } = require("../out/core/parser")

test("v1 workflow parser accepts inputs, execution contract metadata, typed steps, and result sinks", () => {
  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: "C:/repo/.bob/workflows/sample/WORKFLOW.md",
    text: `---
schemaVersion: workflow-register/v1
name: sample
description: Sample workflow.
title: Sample Workflow
mode: sample-reviewer
category: code-review
permissions:
  - read
requires:
  workspace: true
  bob:
    minVersion: "2.0.0"
  files:
    - .bob/skills/sample/SKILL.md
inputs:
  revision:
    type: string
    title: Revision
    required: true
  target:
    type: select
    title: Target
    requiredWhen: "inputs.revision != ''"
    options:
      - trunk
      - branch
preflight:
  - id: check-workspace
    title: Check workspace
    required: true
    checks:
      - workspaceOpen
    files:
      - .bob/skills/sample/SKILL.md
    failurePolicy: stop
tools:
  sample.collect:
    purpose: Collect context.
    required: true
    outputKey: reviewContext
    failurePolicy: stop
guardrails:
  allowedCommands:
    - sample.collect
  deniedCommands:
    - shell
  requireApproval:
    - id: large-review
      when: "state.changedFiles > 100"
      message: Large review detected.
artifacts:
  - id: reviewContext
    producedBy: collect
    path: .bob/workflows/runs/{{run.id}}/steps/collect.json
completion:
  summary: markdown
  includeArtifacts: true
  validateResult: true
  visualization:
    type: mermaid
    enabled: true
steps:
  - id: collect
    title: Collect context
    type: command
    action:
      provider: sample.collect
      args:
        revision: "{{inputs.revision}}"
    resultKey: reviewContext
  - id: save
    title: Save context
    type: result
    result:
      source: state
      stateKey: reviewContext
      sinks:
        - type: file
          path: ".bob/workflows/runs/{{run.id}}/steps/save.result.json"
---
# Sample
`
  })

  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
  assert.equal(parsed.workflow.schemaVersion, "workflow-register/v1")
  assert.equal(parsed.workflow.mode, "sample-reviewer")
  assert.equal(parsed.workflow.category, "code-review")
  assert.equal(parsed.workflow.requires.workspace, true)
  assert.equal(parsed.workflow.requires.bob.minVersion, "2.0.0")
  assert.equal(parsed.workflow.inputs.revision.type, "string")
  assert.equal(parsed.workflow.inputs.target.requiredWhen, "inputs.revision != ''")
  assert.equal(parsed.workflow.preflight[0].id, "check-workspace")
  assert.equal(parsed.workflow.tools["sample.collect"].outputKey, "reviewContext")
  assert.equal(parsed.workflow.guardrails.allowedCommands[0], "sample.collect")
  assert.equal(parsed.workflow.guardrails.requireApproval[0].id, "large-review")
  assert.equal(parsed.workflow.artifacts[0].id, "reviewContext")
  assert.equal(parsed.workflow.completion.visualization.type, "mermaid")
  assert.equal(parsed.workflow.engineSteps.length, 2)
  assert.equal(parsed.workflow.engineSteps[0].type, "command")
  assert.equal(parsed.workflow.engineSteps[0].action.provider, "sample.collect")
  assert.equal(parsed.workflow.engineSteps[1].type, "result")
  assert.equal(parsed.workflow.engineSteps[1].result.sinks[0].type, "file")
})

test("repository code consistency workflow is clean for strict registration", () => {
  const repoRoot = path.resolve(__dirname, "..", "..", "..")
  const filePath = path.join(repoRoot, ".bob", "workflows", "code-consistency-review", "WORKFLOW.md")
  const text = fs.readFileSync(filePath, "utf8")
  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: ".bob/workflows/code-consistency-review/WORKFLOW.md",
    text
  })

  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
  assert.deepEqual(parsed.diagnostics.filter((line) => line.trimStart().startsWith("- warn:")), [])
})

test("v1 workflow parser preserves Bob adapter metadata from typed steps", () => {
  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: "C:/repo/.bob/workflows/bazaar/WORKFLOW.md",
    text: `---
schemaVersion: workflow-register/v1
name: bazaar
description: Bazaar workflow.
title: Bazaar Workflow
mode: agent
todo: true
todoAsSteps: true
stepCompletion: manual
stepMessage: step
autoApproval: true
workspaceRequired: true
steps:
  - id: collect-context
    title: Collect context
    type: command
    action:
      provider: bobBazaar.collectReviewContext
    prompt: |
      Summarize the Bazaar context.
    sendResult: true
    completeOnSuccess: true
    resultKey: reviewContext
    maxResultBytes: 1234
  - id: output-result
    title: Output result
    type: agent
    prompt: |
      Produce final JSON.
    includeState:
      - reviewContext
    stateRequired: true
    resultKey: reviewResult
    result:
      source: agent
      sinks:
        - type: command
          command: bobBazaar.captureReviewResult
---
# Bazaar
`
  })

  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
  assert.equal(parsed.workflow.todoEnabled, true)
  assert.equal(parsed.workflow.todoAsSteps, true)
  assert.equal(parsed.workflow.stepCompletion, "manual")
  assert.equal(parsed.workflow.stepMessage, "step")
  assert.deepEqual(parsed.workflow.todos.map((todo) => todo.id), ["collect-context", "output-result"])
  assert.equal(parsed.workflow.engineSteps[0].prompt.trim(), "Summarize the Bazaar context.")
  assert.equal(parsed.workflow.engineSteps[0].sendResult, true)
  assert.equal(parsed.workflow.engineSteps[0].completeOnSuccess, true)
  assert.equal(parsed.workflow.engineSteps[0].maxResultBytes, 1234)
  assert.deepEqual(parsed.workflow.engineSteps[1].includeState, ["reviewContext"])
  assert.equal(parsed.workflow.engineSteps[1].stateRequired, true)
})

test("workflow parser preserves top-level command metadata for legacy Bob adapters", () => {
  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: "C:/repo/.bob/workflows/command/WORKFLOW.md",
    text: `---
schemaVersion: workflow-register/v1
name: command
description: Command workflow.
command: sample.open
commandArgs:
  - first
  - second
---
# Command
`
  })

  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
  assert.equal(parsed.workflow.command, "sample.open")
  assert.deepEqual(parsed.workflow.commandArgs, ["first", "second"])
})

test("legacy workflow parser records a definition hash", () => {
  const text = `---
name: legacy
description: Legacy workflow.
---
# Legacy

Do the legacy workflow.
`
  const changedText = text.replace("Do the legacy workflow.", "Do the changed legacy workflow.")
  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: "C:/repo/.bob/workflows/legacy/WORKFLOW.md",
    text
  })
  const changed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: "C:/repo/.bob/workflows/legacy/WORKFLOW.md",
    text: changedText
  })

  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
  assert.equal(changed.ok, true, changed.diagnostics.join("\n"))
  assert.match(parsed.workflow.definitionHash, /^sha256:[0-9a-f]{64}$/)
  assert.notEqual(parsed.workflow.definitionHash, changed.workflow.definitionHash)
})

test("v1 workflow parser keeps legacy todo workflow-step sections executable when front matter steps are absent", () => {
  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: "C:/repo/.bob/workflows/bazaar/WORKFLOW.md",
    text: `---
schemaVersion: workflow-register/v1
name: bazaar
description: Bazaar workflow.
todoSource: yaml
todos:
  - review-input: Confirm target.
  - collect-context: Collect context.
  - output-result: Save result.
---
# Bazaar

## Step: review-input

\`\`\`workflow-step
command: bobBazaar.openReviewGui
sendResult: false
\`\`\`

Confirm.

## Step: collect-context

\`\`\`workflow-step
command: bobBazaar.collectReviewContext
commandArgs:
  - "{{inputs.revision}}"
resultKey: reviewContext
\`\`\`

Collect.

## Step: output-result

\`\`\`workflow-step
includeState:
  - reviewContext
runAgent: true
captureResult: true
resultCommand: bobBazaar.captureReviewResult
\`\`\`

Output.
`
  })

  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
  assert.equal(parsed.workflow.engineSteps.length, 3)
  assert.equal(parsed.workflow.engineSteps[0].type, "command")
  assert.equal(parsed.workflow.engineSteps[0].action.provider, "bobBazaar.openReviewGui")
  assert.equal(parsed.workflow.engineSteps[1].type, "command")
  assert.equal(parsed.workflow.engineSteps[1].resultKey, "reviewContext")
  assert.equal(parsed.workflow.engineSteps[2].type, "agent")
  assert.equal(parsed.workflow.engineSteps[2].result.sinks[0].type, "command")
})

test("v1 workflow parser reports schema validation errors", () => {
  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: "C:/repo/.bob/workflows/bad/WORKFLOW.md",
    text: `---
schemaVersion: workflow-register/v1
name: bad
steps:
  - id: missing-title
    type: command
---
# Bad
`
  })

  assert.equal(parsed.ok, false)
  assert.match(parsed.diagnostics.join("\n"), /description/)
  assert.match(parsed.diagnostics.join("\n"), /action/)
})

test("v1 workflow parser warns about unknown top-level fields without rejecting the workflow", () => {
  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: "C:/repo/.bob/workflows/warn/WORKFLOW.md",
    text: `---
schemaVersion: workflow-register/v1
name: warn
description: Warn workflow.
permissons:
  - read
steps: []
---
# Warn
`
  })

  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
  assert.match(parsed.diagnostics.join("\n"), /unknown top-level field 'permissons'/)
})

test("v1 workflow parser allows namespaced extension fields", () => {
  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: "C:/repo/.bob/workflows/extension-fields/WORKFLOW.md",
    text: `---
schemaVersion: workflow-register/v1
name: extension-fields
description: Allow x- namespaced fields.
x-local-note: kept for round-trip metadata
steps: []
---
# Extension Fields
`
  })

  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
  assert.doesNotMatch(parsed.diagnostics.join("\n"), /unknown top-level field 'x-local-note'/)
})

test("v1 workflow parser warns when steps use fields for the wrong type", () => {
  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: "C:/repo/.bob/workflows/warn-step-fields/WORKFLOW.md",
    text: `---
schemaVersion: workflow-register/v1
name: warn-step-fields
description: Warn step fields.
steps:
  - id: manual-review
    title: Manual review
    type: manual
    action:
      provider: sample.unused
    resultKey: ignoredResult
  - id: result-output
    title: Result output
    type: result
    prompt: This prompt is ignored.
    result:
      source: literal
      text: ok
      sinks:
        - type: file
          path: .bob/out.txt
---
# Warn
`
  })

  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
  assert.match(parsed.diagnostics.join("\n"), /manual-review.*field 'action' is ignored for type 'manual'/)
  assert.match(parsed.diagnostics.join("\n"), /manual-review.*field 'resultKey' is ignored for type 'manual'/)
  assert.match(parsed.diagnostics.join("\n"), /result-output.*field 'prompt' is ignored for type 'result'/)
})
