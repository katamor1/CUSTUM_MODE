---
schemaVersion: workflow-register/v1
name: step-back-branching-approval
description: 入力、生成、事前チェック、ユーザー承認を差し戻し可能にするサンプル
title: Step-back Branching Approval
mode: agent
workspaceRequired: true
stepExecution:
  mode: engineSteps
  allowOutOfOrder: false
  showInBob: true
branching:
  enabled: true
  loops:
    - id: revise-until-approved
      title: 入力修正から承認までの反復
      entryStep: collect-user-input
      maxIterations: 5
      extensionSize: 5
      checkpoint:
        title: ループ上限に到達しました
        message: |
          入力、AI生成結果、チェック結果を確認してください。
          承認すると追加で5回の戻りループを許可します。
steps:
  - id: collect-user-input
    title: Collect user input
    type: manual
    form:
      resultKey: userRequest
      fields:
        - id: request
          title: 依頼内容
          type: string
          required: true
          multiline: true
        - id: constraints
          title: 制約
          type: string
          required: false
          multiline: true

  - id: generate-draft
    title: Generate draft
    type: agent
    includeState:
      - userRequest
    resultKey: generatedDraft
    prompt: |
      userRequest を読み、承認対象のドラフトを生成してください。

  - id: preapproval-check
    title: Preapproval check
    type: command
    includeState:
      - userRequest
      - generatedDraft
    action:
      provider: vscode.executeCommand
      args:
        - example.preapprovalCheck
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
      approveLabel: 承認
      rejectLabel: リジェクト
      message: |
        入力、生成結果、プレアプローバルチェックを確認してください。
    transition:
      decisions:
        - id: user-rejected
          when:
            stateKey: userApproval.decision
            equals: rejected
          goto: collect-user-input
          loop: revise-until-approved
      default: next

  - id: finalize
    title: Write final draft
    type: result
    result:
      source: state
      stateKey: generatedDraft
      sinks:
        - type: file
          path: .bob/artifacts/final-draft.md
---
# Step-back Branching Approval

ユーザー入力、AI生成、事前チェック、ユーザー承認を反復するサンプルです。
