# Phase 4 Template Customization Core 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to execute this plan.

## Goal

Phase 4 企画書を Codex が実行できる v1 Core として実装する。対象は `P4-TPL-01` から `P4-TPL-03` と最小 Readiness Check までに限定し、テンプレートからプロジェクト別 workflow を安全に生成できる状態にする。

## Scope

### 対象

- `workflow-register` に `bob-workflow-template/v1`、`bob-project-profile/v1`、`bob-workflow-customization/v1` の schema と validator を追加する。
- 既存の workspace-relative path 検証を再利用し、absolute path、`..`、workspace 外 sink を拒否する。
- `.bob/template-library/standard/process-code-precheck/` に標準テンプレート metadata と base `WORKFLOW.md` を tracked data として追加する。
- template + project profile + customization から `.bob/workflows/<workflowName>/WORKFLOW.md` を生成する。
- customization で変更できる項目を `title`、`description`、既存 input default、checklist path、prompt 補足、artifact output root、human gate/stepReview に限定する。
- guardrails、command provider、result sink type は customization から変更不可にする。
- VS Code/Bob command surface として `bobTemplate.validateLibrary`、`bobTemplate.validateProjectProfile`、`bobTemplate.validateCustomization`、`bobTemplate.generateWorkflow`、`bobTemplate.checkReadiness` を追加する。
- Readiness Check は schema、naming、required files、guardrails、artifact paths、human gate、templateVersion/baseTemplateHash、UAT evidence presence を評価し、JSON/Markdown を `.bob/template-readiness/...` に出力する。
- `docs/training` と `docs/uat` に最小の Phase 4 Core 手順と readiness 判定例を追加する。

### 非対象

- GUI Studio の本格実装。
- Rollout Dashboard。
- Template Update Assistant。
- mechanical checks runner との本格統合。
- 既存 command ID/provider ID の rename。

## Commit Units

1. `docs: add phase 4 template customization core execution plan`
   - この計画書を追加する。
   - 検証: `git diff --check`

2. `feat(workflow-register): add template profile and customization schemas`
   - 3 schema と TypeScript validator を追加する。
   - valid/invalid project profile、unsupported language/VCS、workspace escape、forbidden customization のテストを追加する。
   - 検証: `npm.cmd test`

3. `feat(workflow-register): add template library and workflow generator`
   - 標準テンプレート metadata/base workflow を追加する。
   - generator と generated workflow validation のテストを追加する。
   - `.gitignore` で `.bob/template-library/**` だけを tracked 化し、`.bob/template-readiness/**` は生成物として ignore のままにする。
   - 検証: `npm.cmd test`

4. `feat(workflow-register): add template readiness commands`
   - template command handlers、package command metadata、readiness report writer を追加する。
   - readiness warning/fail と command registration のテストを追加する。
   - 検証: `npm.cmd test`

5. `docs: add phase 4 customization training and UAT samples`
   - 役割別育成手順、sandbox UAT 操作、Operator/Reviewer/Customizer Ready 判定例を追加する。
   - 検証: `npm.cmd test`、`npm.cmd run architecture:policy`、`npm.cmd run source:policy`、`git diff --check`

## Verification Commands

Run from `C:\Users\stell\.config\superpowers\worktrees\bob_builtin_analyze\phase4-template-customization-core\extensions\workflow-register` unless noted.

```powershell
npm.cmd test
npm.cmd run architecture:policy
npm.cmd run source:policy
```

Run from the worktree root:

```powershell
git diff --check
```

## Acceptance

- All new tests pass.
- Existing `workflow-register` regression suite remains green.
- A generated sample `WORKFLOW.md` validates through the existing workflow validator.
- Readiness report is produced under `.bob/template-readiness/...`.
- Final branch contains the planned commits and remains isolated from `main` through the linked worktree.
