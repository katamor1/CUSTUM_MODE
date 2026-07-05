# Phase 4 Template Customization Core UAT

## 目的

v1 Core の UAT は、GUI なしでも標準テンプレートからプロジェクト別 workflow を生成し、readiness report で UAT 投入可否を判断できることを確認する。対象は `process-code-precheck` テンプレートに限定する。

## Sandbox 準備

1. UAT workspace に `.bob/process/process-catalog.yaml` を配置する。
2. project checklist を配置する。
   - 例: `.bob/process/checklists/alpha-code-precheck.yaml`
3. UAT evidence の保存先を作る。
   - 例: `docs/uat/evidence/alpha-product.md`
4. Bazaar workspace の場合は、作業手順書と profile の両方で `bzr --no-aliases` を明記する。

## Profile 例

```yaml
schemaVersion: bob-project-profile/v1
projectId: alpha-product
displayName: Alpha Product
targetLanguage: c_cpp
vcs:
  type: bazaar
  root: .
  noAliases: true
paths:
  checklistPath: .bob/process/checklists/alpha-code-precheck.yaml
  artifactOutputRoot: .bob-process-runs/{{run.id}}/alpha-code-precheck
  uatEvidencePath: docs/uat/evidence/alpha-product.md
workflowPreferences:
  requireHumanGate: true
  stepReviewPauseAfter: agentAndCommand
```

## Customization 例

`baseTemplateHash` は実際の `.bob/template-library/standard/process-code-precheck/WORKFLOW.md` に対する値へ置き換える。

```yaml
schemaVersion: bob-workflow-customization/v1
customizationId: alpha-code-precheck
templateId: process-code-precheck
templateVersion: 1.0.0
baseTemplateHash: sha256:<actual-base-template-hash>
projectId: alpha-product
workflowName: alpha-code-precheck
customize:
  title: Alpha コード事前チェック
  description: Alpha Product 向けコード事前チェック。
  inputs:
    defaults:
      phase2ReviewInputPath: review-input-alpha.yaml
      textEncoding: shift_jis
  checklist:
    path: .bob/process/checklists/alpha-code-precheck.yaml
  prompts:
    supplement: Alpha Product の用語を確認し、Bazaar 操作では bzr --no-aliases を使う。
  artifactOutputRoot: .bob-process-runs/{{run.id}}/alpha-code-precheck
  humanGate:
    required: true
    stepReviewPauseAfter: agentAndCommand
```

## UAT ケース

| ID | 操作 | 期待結果 |
| --- | --- | --- |
| P4-TPL-UAT-001 | `bobTemplate.validateLibrary` を実行する。 | 標準テンプレート metadata と base workflow が `status: ok`。 |
| P4-TPL-UAT-002 | profile/customization を検証する。 | `bob-project-profile/v1` と `bob-workflow-customization/v1` が `status: ok`。 |
| P4-TPL-UAT-003 | `bobTemplate.generateWorkflow` を実行する。 | `.bob/workflows/alpha-code-precheck/WORKFLOW.md` が生成され、`x-bob-template` が入る。 |
| P4-TPL-UAT-004 | checklist file を消して readiness を実行する。 | `readiness.status: fail`、`required-files` が fail。 |
| P4-TPL-UAT-005 | `artifactOutputRoot: ../outside` にして readiness を実行する。 | `readiness.status: fail`、workspace escape 診断が出る。 |
| P4-TPL-UAT-006 | UAT evidence を消して readiness を実行する。 | `readiness.status: warning`、UAT evidence warning が出る。 |
| P4-TPL-UAT-007 | checklist と UAT evidence を戻して readiness を実行する。 | `readiness.status: pass`、JSON/Markdown report が `.bob/template-readiness/alpha-product/` に出る。 |

## 合格条件

- 生成 workflow が既存 workflow validator を通る。
- readiness report に schema、naming、required files、guardrails、artifact paths、human gate、template metadata、UAT evidence の check が含まれる。
- forbidden override は UAT 前に fail になる。
- Bazaar 操作がある project profile は `vcs.noAliases: true` を持つ。
