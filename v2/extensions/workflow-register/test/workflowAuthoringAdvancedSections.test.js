const test = require("node:test")
const assert = require("node:assert/strict")

const { createAuthoringModelFromTemplate } = require("../out/core/workflowAuthoringDefaults")
const { serializeAuthoringModelToMarkdown } = require("../out/core/workflowAuthoringSerializer")
const { loadAuthoringModelFromMarkdown } = require("../out/core/workflowAuthoringLoader")
const { validateWorkflowText } = require("../out/core/workflowValidator")

function renderAndValidate(model) {
  const rendered = serializeAuthoringModelToMarkdown(model)
  const validation = validateWorkflowText({ sourceId: "workflow-register", filePath: rendered.filePath, text: rendered.markdown })
  return { rendered, validation }
}

test("serializes requires, preflight, completion, approval guardrails, and markdown body", () => {
  const model = createAuthoringModelFromTemplate({
    name: "advanced-sections",
    title: "Advanced Sections",
    description: "高度な section を GUI で編集する。",
    template: "simple-agent"
  })
  model.requires = { workspace: true, bob: { minVersion: "2.0.0" }, files: ["docs/spec.md", "src/**/*.ts"] }
  model.preflight = [{ id: "check-inputs", title: "Check inputs", required: true, checks: ["workflow.filesExist"], files: ["docs/spec.md"], failurePolicy: "stop" }]
  model.guardrails = {
    allowedCommands: ["workflow.safeCommand"],
    deniedCommands: ["workflow.dangerousCommand"],
    requireApproval: [{ id: "approve-dangerous-change", when: "command.requiresApproval", message: "人間の承認が必要です。" }]
  }
  model.completion = { summary: "Advanced workflow completed.", includeArtifacts: true, validateResult: true, visualization: { type: "markdown", enabled: true } }
  model.body = "# Advanced Sections\n\n## Review Procedure\n\n1. Collect context.\n2. Review changes."

  const { rendered, validation } = renderAndValidate(model)
  assert.equal(validation.ok, true)
  assert.match(rendered.markdown, /requires:/)
  assert.match(rendered.markdown, /minVersion: "2\.0\.0"/)
  assert.match(rendered.markdown, /preflight:/)
  assert.match(rendered.markdown, /failurePolicy: stop/)
  assert.match(rendered.markdown, /guardrails:/)
  assert.match(rendered.markdown, /requireApproval:/)
  assert.match(rendered.markdown, /approve-dangerous-change/)
  assert.match(rendered.markdown, /when: "command\.requiresApproval"/)
  assert.match(rendered.markdown, /completion:/)
  assert.match(rendered.markdown, /includeArtifacts: true/)
  assert.match(rendered.markdown, /## Review Procedure/)
})

test("quotes approval conditions with comparison expressions", () => {
  const model = createAuthoringModelFromTemplate({
    name: "approval-condition",
    title: "Approval Condition",
    description: "条件式を引用符付きで出力する。",
    template: "simple-agent"
  })
  model.requires = { bob: { minVersion: "2.0.0" } }
  model.guardrails = { requireApproval: [{ id: "large-change", when: "reviewContext.changedFiles.count > 100", message: "変更ファイル数が多いため承認してください。" }] }

  const { rendered, validation } = renderAndValidate(model)
  assert.equal(validation.ok, true)
  assert.match(rendered.markdown, /minVersion: "2\.0\.0"/)
  assert.match(rendered.markdown, /when: "reviewContext\.changedFiles\.count > 100"/)
})

test("validation rejects unsupported approval guardrail expressions", () => {
  const text = `---
schemaVersion: workflow-register/v1
name: bad-approval
description: Bad approval expression.
guardrails:
  requireApproval:
    - id: bad
      when: "run this arbitrary expression"
      message: Unsupported expression.
steps:
  - id: collect
    title: Collect
    type: command
    action:
      provider: sample.collect
---
# Bad Approval
`

  const validation = validateWorkflowText({
    sourceId: "workflow-register",
    filePath: "C:/repo/.bob/workflows/bad-approval/WORKFLOW.md",
    text
  })

  assert.equal(validation.ok, false)
  assert.ok(validation.diagnostics.some((item) => item.severity === "error" && /Unsupported approval guardrail expression/.test(item.message)))
})

test("loads advanced sections, approval guardrails, and markdown body back into the authoring model", () => {
  const model = createAuthoringModelFromTemplate({
    name: "advanced-roundtrip",
    title: "Advanced Roundtrip",
    description: "高度な section を往復変換する。",
    template: "simple-agent"
  })
  model.requires = { workspace: false, bob: { minVersion: "2.1.0" }, files: ["README.md"] }
  model.preflight = [{ id: "check-readme", title: "Check README", required: false, checks: ["workflow.filesExist"], files: ["README.md"], failurePolicy: "warn" }]
  model.guardrails = { requireApproval: [{ id: "approve-report", when: "artifact.externalOutput", message: "外部出力前に承認してください。" }] }
  model.completion = { summary: "Done.", includeArtifacts: false, validateResult: true, visualization: { type: "table", enabled: false } }
  model.body = "# Existing Body\n\n## Manual Notes\n\nKeep this section editable outside YAML."

  const { rendered } = renderAndValidate(model)
  const loaded = loadAuthoringModelFromMarkdown({ sourceId: "workflow-register", filePath: rendered.filePath, text: rendered.markdown })

  assert.equal(loaded.model.requires.bob.minVersion, "2.1.0")
  assert.deepEqual(loaded.model.requires.files, ["README.md"])
  assert.equal(loaded.model.preflight[0].id, "check-readme")
  assert.equal(loaded.model.preflight[0].failurePolicy, "warn")
  assert.equal(loaded.model.guardrails.requireApproval[0].id, "approve-report")
  assert.equal(loaded.model.guardrails.requireApproval[0].when, "artifact.externalOutput")
  assert.equal(loaded.model.completion.summary, "Done.")
  assert.equal(loaded.model.completion.visualization.type, "table")
  assert.match(loaded.model.body, /## Manual Notes/)
})

test("serializes and loads branching transitions and structured manual steps", () => {
  const model = createAuthoringModelFromTemplate({
    name: "branching-authoring",
    title: "Branching Authoring",
    description: "差し戻し分岐を GUI model から保存する。",
    template: "simple-agent"
  })
  model.branching = {
    enabled: true,
    loops: [
      {
        id: "approval-loop",
        title: "Approval loop",
        entryStep: "collect-user-input",
        maxIterations: 5,
        extensionSize: 5,
        checkpoint: {
          title: "Loop limit reached",
          message: "Review inputs before continuing."
        }
      }
    ]
  }
  model.steps = [
    {
      id: "collect-user-input",
      title: "Collect user input",
      type: "manual",
      form: {
        resultKey: "userRequest",
        fields: [
          { id: "request", title: "Request", type: "string", required: true, multiline: true }
        ]
      }
    },
    {
      id: "generate-draft",
      title: "Generate draft",
      type: "agent",
      includeState: ["userRequest"],
      resultKey: "generatedDraft",
      prompt: "Generate a draft."
    },
    {
      id: "user-approval",
      title: "User approval",
      type: "manual",
      includeState: ["userRequest", "generatedDraft"],
      approval: {
        resultKey: "userApproval",
        approveLabel: "Approve",
        rejectLabel: "Reject",
        message: "Review the draft."
      },
      transition: {
        decisions: [
          {
            id: "user-rejected",
            when: { stateKey: "userApproval.decision", equals: "rejected" },
            goto: "collect-user-input",
            loop: "approval-loop"
          }
        ],
        default: "next"
      }
    }
  ]

  const { rendered, validation } = renderAndValidate(model)
  const loaded = loadAuthoringModelFromMarkdown({ sourceId: "workflow-register", filePath: rendered.filePath, text: rendered.markdown })

  assert.equal(validation.ok, true, validation.diagnostics.map((item) => item.message).join("\n"))
  assert.match(rendered.markdown, /branching:/)
  assert.match(rendered.markdown, /transition:/)
  assert.match(rendered.markdown, /form:/)
  assert.match(rendered.markdown, /approval:/)
  assert.equal(loaded.model.branching.loops[0].id, "approval-loop")
  assert.equal(loaded.model.steps[0].form.resultKey, "userRequest")
  assert.equal(loaded.model.steps[0].form.fields[0].multiline, true)
  assert.equal(loaded.model.steps[2].approval.resultKey, "userApproval")
  assert.equal(loaded.model.steps[2].transition.decisions[0].loop, "approval-loop")
})
