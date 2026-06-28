---
schemaVersion: workflow-register/v1
name: bazaar-project-rule-review
description: Review a Bazaar revision or range against project-specific rules.
title: Bazaar Project Rule Review
category: code-review
mode: agent
todo: true
todoRequired: true
todoAsSteps: true
stepCompletion: manual
stepMessage: step
permissions:
  - read
  - mcp
  - skill
  - todo
autoApproval: true
workspaceRequired: true
requires:
  workspace: true
  bob:
    minVersion: "2.0.0"
  files:
    - .bob/review/checklist.json
    - .bob/review/review-result.schema.json
    - .bob/skills/project-review-checklist/SKILL.md
inputs:
  revisionMode:
    type: select
    title: Review target
    prompt: false
    options:
      - singleRevision
      - revisionRange
      - workingTreeSinceRevision
  revision:
    type: string
    title: Revision
    prompt: false
  baseRevision:
    type: string
    title: Base revision
    prompt: false
  targetRevision:
    type: string
    title: Target revision
    prompt: false
preflight:
  - id: check-workspace
    title: Check Bob workspace and Bazaar repository
    required: true
    checks:
      - workspaceOpen
      - bazaarRepository
      - bobWorkspaceInitialized
    failurePolicy: stop
  - id: check-review-assets
    title: Check review checklist, schema, and skill files
    required: true
    files:
      - .bob/review/checklist.json
      - .bob/review/review-result.schema.json
      - .bob/skills/project-review-checklist/SKILL.md
    failurePolicy: stop
tools:
  bobBazaar.openReviewGui:
    purpose: Confirm the target Bazaar revision or range with the user.
    required: true
    failurePolicy: stop
  bobBazaar.collectReviewContext:
    purpose: Collect Bazaar revision metadata, changed files, and diff context.
    required: true
    outputKey: reviewContext
    failurePolicy: stop
  bobBazaar.loadReviewRules:
    purpose: Load project review checklist and review result JSON schema.
    required: true
    outputKey: reviewRules
    failurePolicy: stop
  bobBazaar.captureReviewResult:
    purpose: Validate and save final review-result JSON and Markdown summary.
    required: true
    inputSource: lastAssistant
    failurePolicy: stop
guardrails:
  allowedCommands:
    - bobBazaar.openReviewGui
    - bobBazaar.collectReviewContext
    - bobBazaar.loadReviewRules
    - bobBazaar.captureReviewResult
  deniedCommands:
    - shell
    - file.writeOutsideBob
  requireApproval:
    - id: large-review
      when: "reviewContext.changedFiles.count > 100"
      message: Large revision detected. Confirm whether to continue or split the review.
artifacts:
  - id: reviewContext
    producedBy: collect-context
    path: .bob/workflows/runs/{{run.id}}/review-context.json
  - id: reviewRules
    producedBy: load-rules
    path: .bob/workflows/runs/{{run.id}}/review-rules.json
  - id: reviewAnalysis
    producedBy: analyze-changes
    path: .bob/workflows/runs/{{run.id}}/review-analysis.md
  - id: reviewResult
    producedBy: output-result
    path: .bob/review/results/{{review_id}}.json
    schema: .bob/review/review-result.schema.json
completion:
  summary: markdown
  includeArtifacts: true
  validateResult: true
  visualization:
    type: mermaid
    enabled: false
steps:
  - id: review-input
    title: Confirm the target Bazaar revision or revision range.
    type: command
    action:
      provider: bobBazaar.openReviewGui
    prompt: |
      Confirm the target Bazaar revision or revision range in the GUI. The Bazaar Review extension intentionally disables Bob pre-prompts for review target inputs so this workflow starts from the GUI by default.
    sendResult: false
    required: true
    completeOnSuccess: false
  - id: collect-context
    title: Collect Bazaar diff and changed-file context.
    type: command
    action:
      provider: bobBazaar.collectReviewContext
    prompt: |
      Use the Bazaar review context returned by the command. Summarize revision metadata, changed files, and important diff areas. Use the Bazaar review packet already added to Bob context for full diff details.
    sendResult: true
    resultKey: reviewContext
    maxResultBytes: 20000
    required: true
    completeOnSuccess: true
  - id: load-rules
    title: Load project checklist and review result schema.
    type: command
    action:
      provider: bobBazaar.loadReviewRules
    prompt: |
      Load and apply the project review checklist and review result schema. Identify which review categories are relevant to the current change.
    sendResult: true
    resultKey: reviewRules
    maxResultBytes: 20000
    required: true
    completeOnSuccess: true
  - id: analyze-changes
    title: Analyze the changes against project-specific rules.
    type: agent
    prompt: |
      Analyze the changes against the checklist. Focus on interface impact, error handling, regression risk, data compatibility, and missing tests.
    includeState:
      - reviewContext
      - reviewRules
    stateRequired: true
    resultKey: reviewAnalysis
    maxResultBytes: 20000
  - id: output-result
    title: Produce review-result JSON and a Markdown checklist.
    type: agent
    prompt: |
      Produce the final review-result JSON using the saved review analysis. Return exactly one fenced `json` code block and no other JSON-like object.

      The JSON must match this shape:

      Replace `<revision>` with the actual Bazaar revision or range before returning the JSON. Do not copy the placeholder literally.

      `checklist_results[].severity` must always be exactly one of `error`, `warning`, or `info`.
      Never put `N/A`, `not_applicable`, `none`, or any status value in `severity`.
      For `pass`, `unknown`, `not_applicable`, or `blocked` checklist results, use `info` unless there is a concrete issue. For `fail`, use the rule's `severity_on_fail`.

      ```json
      {
        "review_id": "bazaar-r<revision>-project-rule-review",
        "vcs": {
          "type": "bazaar",
          "repository": "<repository root>",
          "revision_mode": "singleRevision",
          "revision": "<revision>"
        },
        "checklist_results": [
          {
            "rule_id": "<checklist rule id>",
            "title": "<checklist rule title>",
            "status": "pass",
            "severity": "info",
            "confidence": "medium",
            "evidence": [
              {
                "file": "<path>",
                "summary": "<evidence summary>"
              }
            ],
            "reason": "<reason>"
          }
        ],
        "findings": [],
        "summary": {
          "pass": 0,
          "fail": 0,
          "unknown": 0,
          "not_applicable": 0,
          "blocked": 0
        }
      }
      ```

      After producing the JSON, the workflow validates it and saves `.bob/review/results/<review_id>.json` and `.bob/review/results/<review_id>.md` automatically.
    includeState:
      - reviewContext
      - reviewRules
      - reviewAnalysis
    stateRequired: true
    result:
      source: agent
      sinks:
        - type: command
          command: bobBazaar.captureReviewResult
---
# Bazaar Project Rule Review

## Goal

Review the selected Bazaar revision or range using project-specific review rules.

## Instructions

Create a Todo list from the workflow step definitions first, then work through each item in order.
