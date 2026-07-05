const test = require("node:test")
const assert = require("node:assert/strict")

const { parseWorkflowMarkdown } = require("../out/core/parser")
const { validateWorkflowText } = require("../out/core/workflowValidator")

function workflowText(frontMatter) {
  return `---
schemaVersion: workflow-register/v1
name: branching-sample
description: Branching sample.
${frontMatter.trim()}
---
# Branching Sample
`
}

test("v1 parser accepts branching transitions and structured manual steps", () => {
  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: "C:/repo/.bob/workflows/branching/WORKFLOW.md",
    text: workflowText(`
stepExecution:
  mode: engineSteps
branching:
  enabled: true
  loops:
    - id: revise-until-approved
      title: Revise until approved
      entryStep: collect-user-input
      maxIterations: 5
      extensionSize: 5
      checkpoint:
        title: Loop limit reached
        message: Review the current inputs before continuing.
steps:
  - id: collect-user-input
    title: Collect input
    type: manual
    form:
      resultKey: userRequest
      fields:
        - id: request
          title: Request
          type: string
          required: true
          multiline: true
  - id: generate-draft
    title: Generate draft
    type: agent
    includeState:
      - userRequest
    resultKey: generatedDraft
    prompt: Generate the draft.
  - id: preapproval-check
    title: Preapproval check
    type: command
    includeState:
      - userRequest
      - generatedDraft
    action:
      provider: sample.preapproval
    resultKey: preapproval
    transition:
      decisions:
        - id: preapproval-ng
          when:
            stateKey: preapproval.status
            equals: ng
          goto: collect-user-input
          loop: revise-until-approved
      default: next
  - id: user-approval
    title: User approval
    type: manual
    includeState:
      - userRequest
      - generatedDraft
      - preapproval
    approval:
      resultKey: userApproval
      approveLabel: Approve
      rejectLabel: Reject
      message: Review the generated draft.
    transition:
      decisions:
        - id: user-rejected
          when:
            stateKey: userApproval.decision
            equals: rejected
          goto: collect-user-input
          loop: revise-until-approved
      default: next
`)
  })

  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
  assert.equal(parsed.workflow.branching.enabled, true)
  assert.equal(parsed.workflow.branching.loops[0].id, "revise-until-approved")
  assert.equal(parsed.workflow.engineSteps[0].form.resultKey, "userRequest")
  assert.equal(parsed.workflow.engineSteps[0].form.fields[0].multiline, true)
  assert.equal(parsed.workflow.engineSteps[2].transition.decisions[0].when.stateKey, "preapproval.status")
  assert.equal(parsed.workflow.engineSteps[3].approval.rejectLabel, "Reject")
})

test("validator rejects invalid branching references and unsafe back transitions", () => {
  const validation = validateWorkflowText({
    sourceId: "workflow-register",
    filePath: "C:/repo/.bob/workflows/invalid-branching/WORKFLOW.md",
    text: workflowText(`
branching:
  enabled: true
  loops:
    - id: revise-loop
      entryStep: missing-entry
      maxIterations: 0
      extensionSize: 0
steps:
  - id: start
    title: Start
    type: command
    action:
      provider: sample.start
    resultKey: sharedState
  - id: review
    title: Review
    type: manual
    form:
      resultKey: sharedState
      fields: []
    transition:
      decisions:
        - id: duplicate
          when:
            stateKey: sharedState.status
            equals: ng
          goto: start
        - id: duplicate
          when:
            stateKey: sharedState.status
            equals: rejected
          goto: missing-step
          loop: missing-loop
        - id: ambiguous
          when:
            stateKey: sharedState.status
            equals: ng
            notEquals: ok
          goto: start
          loop: revise-loop
      default: missing-step
`)
  })

  assert.equal(validation.ok, false)
  const messages = validation.diagnostics.map((item) => item.message).join("\n")
  assert.match(messages, /entryStep references unknown step 'missing-entry'/)
  assert.match(messages, /maxIterations must be greater than zero/)
  assert.match(messages, /extensionSize must be greater than zero/)
  assert.match(messages, /form resultKey 'sharedState' conflicts/)
  assert.match(messages, /Duplicate transition decision id 'duplicate'/)
  assert.match(messages, /backward goto to 'start' must specify loop/)
  assert.match(messages, /goto references unknown step 'missing-step'/)
  assert.match(messages, /loop references unknown loop 'missing-loop'/)
  assert.match(messages, /condition must specify exactly one operator/)
})

test("validator rejects reserved workflow result key prefixes", () => {
  const validation = validateWorkflowText({
    sourceId: "workflow-register",
    filePath: "C:/repo/.bob/workflows/reserved-result-keys/WORKFLOW.md",
    text: workflowText(`
steps:
  - id: collect
    title: Collect
    type: command
    action:
      provider: sample.collect
    resultKey: workflow.approval.collect
  - id: form
    title: Form
    type: manual
    form:
      resultKey: workflow.review.form
      fields: []
  - id: approve
    title: Approve
    type: manual
    approval:
      resultKey: workflow.branching.approval
`)
  })

  assert.equal(validation.ok, false)
  const messages = validation.diagnostics.map((item) => item.message).join("\n")
  assert.match(messages, /resultKey 'workflow\.approval\.collect' uses the reserved workflow state namespace/)
  assert.match(messages, /form resultKey 'workflow\.review\.form' uses the reserved workflow state namespace/)
  assert.match(messages, /approval resultKey 'workflow\.branching\.approval' uses the reserved workflow state namespace/)
})

test("validator rejects loop transitions that do not target the loop entry step", () => {
  const validation = validateWorkflowText({
    sourceId: "workflow-register",
    filePath: "C:/repo/.bob/workflows/invalid-loop-entry/WORKFLOW.md",
    text: workflowText(`
branching:
  enabled: true
  loops:
    - id: revise-loop
      entryStep: collect-input
      maxIterations: 5
      extensionSize: 2
steps:
  - id: collect-input
    title: Collect input
    type: manual
    form:
      resultKey: input
      fields: []
  - id: regenerate
    title: Regenerate
    type: agent
    resultKey: draft
    prompt: Regenerate.
  - id: review
    title: Review
    type: manual
    approval:
      resultKey: approval
    transition:
      decisions:
        - id: retry
          when:
            stateKey: approval.decision
            equals: rejected
          goto: regenerate
          loop: revise-loop
      default: next
`)
  })

  assert.equal(validation.ok, false)
  assert.match(
    validation.diagnostics.map((item) => item.message).join("\n"),
    /loop 'revise-loop' must target entryStep 'collect-input'/
  )
})

test("validator rejects transition conditions that read state produced only by a later step", () => {
  const validation = validateWorkflowText({
    sourceId: "workflow-register",
    filePath: "C:/repo/.bob/workflows/future-state/WORKFLOW.md",
    text: workflowText(`
branching:
  enabled: true
  loops:
    - id: retry-loop
      entryStep: first
      maxIterations: 5
      extensionSize: 2
steps:
  - id: first
    title: First
    type: command
    action:
      provider: sample.first
    resultKey: firstResult
    transition:
      decisions:
        - id: use-future-state
          when:
            stateKey: laterResult.status
            equals: retry
          goto: first
          loop: retry-loop
      default: next
  - id: second
    title: Second
    type: command
    action:
      provider: sample.second
    resultKey: laterResult
`)
  })

  assert.equal(validation.ok, false)
  assert.match(
    validation.diagnostics.map((item) => item.message).join("\n"),
    /condition stateKey 'laterResult.status' is produced by later step 'second'/
  )
})
