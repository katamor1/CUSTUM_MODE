---
schemaVersion: workflow-register/v1
name: code-consistency-review
description: Local parser fixture.
title: Code Consistency Review
mode: agent
guardrails:
  allowedCommands:
    - bobCodeConsistency.captureAiTraceabilityDraft
    - bobCodeConsistency.createReviewInputFromTraceability
steps:
  - id: collect-document-candidates
    title: Collect documents
    type: command
    action:
      provider: bobCodeConsistency.captureAiTraceabilityDraft
  - id: generate-traceability-draft
    title: Generate draft
    type: agent
    prompt: Generate draft.
  - id: apply-traceability-draft
    title: Apply draft
    type: command
    action:
      provider: bobCodeConsistency.captureAiTraceabilityDraft
  - id: approve-traceability-catalog
    title: Approve catalog
    type: command
    action:
      provider: bobCodeConsistency.captureAiTraceabilityDraft
  - id: create-review-input-from-traceability
    title: Create review input
    type: command
    action:
      provider: bobCodeConsistency.createReviewInputFromTraceability
---
# Code Consistency Review
