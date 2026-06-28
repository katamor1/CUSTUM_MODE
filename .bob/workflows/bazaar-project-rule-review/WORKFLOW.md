---
name: bazaar-project-rule-review
description: Review a Bazaar revision or range against project-specific rules.
title: Bazaar Project Rule Review
mode: agent
todo: true
todoSource: markdown
todoRequired: true
todoAsSteps: true
autoCompleteSteps: false
permissions:
  - read
  - mcp
  - skill
  - todo
autoApproval: true
workspaceRequired: true
command: bobBazaar.openReviewGui
---
# Bazaar Project Rule Review

## Goal

Review the selected Bazaar revision or range using project-specific review rules.

## Todo

- [ ] review-input: Confirm the target Bazaar revision or revision range.
- [ ] collect-context: Collect Bazaar diff and changed-file context.
- [ ] load-rules: Load `.bob/review/checklist.json` and the review result schema.
- [ ] analyze-changes: Analyze the changes against project-specific rules.
- [ ] output-result: Produce review-result JSON and a Markdown checklist.

## Instructions

Create a Todo list from the `Todo` section first, then work through each item in order. Do not mark a Todo item complete until the corresponding work is actually done.
