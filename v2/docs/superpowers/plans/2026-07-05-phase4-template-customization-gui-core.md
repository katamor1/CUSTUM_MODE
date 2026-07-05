# Phase 4 Template Customization GUI Core 実行計画

## 前提

- 作業基点は `codex/phase4-template-customization-core`。
- 作業 branch は `codex/phase4-template-customization-gui-core`。
- 作業 worktree は `C:\Users\stell\.config\superpowers\worktrees\bob_builtin_analyze\phase4-template-customization-gui-core`。
- 実装対象は `P4-GUI-01` から `P4-GUI-03` までの v1 GUI Core に限定する。
- Core branch の `bob-workflow-template/v1`、`bob-project-profile/v1`、`bob-workflow-customization/v1`、generator、readiness check を再利用する。

## 対象

- VS Code command `bobTemplate.openCustomizationStudio` を追加する。
- `package.json` の activation、contributes、commandPalette に command を登録する。
- `extensionWithAuthoring.ts` から workspace root 前提で command を登録する。
- Template Customization Studio Webview を追加する。
- Webview は 3 タブ固定とする。
  - `Template Library`
  - `Customize`
  - `Readiness`
- `.bob/template-library/**/metadata.yaml` を一覧し、標準 `process-code-precheck` を既定選択にする。
- profile/customization の安全編集フォームを実装する。
  - title
  - description
  - 既存 input default
  - checklist path
  - prompt supplement
  - artifact output root
  - human gate / stepReview
- GUI から Core 実装を呼び出す。
  - profile: `.bob/template-profiles/<projectId>.yaml`
  - customization: `.bob/template-customizations/<workflowName>.yaml`
  - workflow: `.bob/workflows/<workflowName>/WORKFLOW.md`
  - readiness: `.bob/template-readiness/<projectId>/<workflowName>-readiness.json|md`
- 生成前 preview、既存 workflow diff、readiness 結果表示を実装する。
- Bazaar profile では `vcs.noAliases: true` を必須にし、UI 文言に `bzr --no-aliases` を残す。

## 非対象

- Rollout Dashboard。
- Template Update Assistant。
- mechanical checks integration。
- YAML 自由編集 UI。
- guardrails、command provider、result sink type の編集 UI。
- 既存 schema / command result shape の変更。

## Commit 単位

1. `docs: add phase 4 template customization gui execution plan`
2. `feat(workflow-register): add template customization studio command`
3. `feat(workflow-register): add template library and customization webview`
4. `feat(workflow-register): wire gui generation preview and diff`
5. `feat(workflow-register): add readiness ui and report actions`
6. `docs: add phase 4 gui customization UAT notes`

## 検証

各実装 commit では focused test を先に追加し、失敗を確認してから実装する。最後に次を実行する。

```powershell
cd C:\Users\stell\.config\superpowers\worktrees\bob_builtin_analyze\phase4-template-customization-gui-core\extensions\workflow-register
npm.cmd test
npm.cmd run architecture:policy
npm.cmd run source:policy
cd C:\Users\stell\.config\superpowers\worktrees\bob_builtin_analyze\phase4-template-customization-gui-core
git diff --check
```

## Manual Smoke

VS Code/Bob extension host で `Bob Workflow: テンプレートカスタマイズ Studio` を開く。`process-code-precheck` を選択し、profile/customization 保存、workflow 生成、readiness report 確認までを実施する。
