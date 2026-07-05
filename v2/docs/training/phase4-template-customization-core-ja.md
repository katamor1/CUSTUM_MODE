# Phase 4 Template Customization Core Training

## 目的

この手順は、7プロジェクト展開前に `process-code-precheck` 標準テンプレートを安全にプロジェクト別 workflow へカスタマイズできる人を育成するための v1 Core 教材である。GUI Studio、Rollout Dashboard、Template Update Assistant は後続範囲であり、この教材では command surface と readiness report を使う。

## 対象ロール

| ロール | できる状態 | 主な成果物 |
| --- | --- | --- |
| Operator | 生成済み workflow を Bob/VS Code から実行し、artifact と human gate を確認できる。 | 実行 run、review-result、process record |
| Reviewer | `WORKFLOW.md` と readiness report を読み、UAT へ進めるか判断できる。 | readiness 判定、差戻しコメント |
| Customizer | project profile と customization を作成し、生成と readiness check を通せる。 | profile YAML、customization YAML、生成 workflow |

## Core 手順

1. 標準テンプレートを確認する。
   - metadata: `.bob/template-library/standard/process-code-precheck/metadata.yaml`
   - base workflow: `.bob/template-library/standard/process-code-precheck/WORKFLOW.md`
   - command: `bobTemplate.validateLibrary`

2. project profile を作る。
   - `schemaVersion: bob-project-profile/v1`
   - `targetLanguage` は `c_cpp`、`csharp`、`java`、`javascript_typescript`、`python` など既存 process language に合わせる。
   - Bazaar の場合は `vcs.noAliases: true` を必ず設定し、手順上も `bzr --no-aliases` を使う。
   - command: `bobTemplate.validateProjectProfile`

3. customization を作る。
   - `schemaVersion: bob-workflow-customization/v1`
   - `baseTemplateHash` は対象 base `WORKFLOW.md` の hash と一致させる。
   - 変更できるのは title、description、既存 input default、checklist path、prompt 補足、artifact output root、human gate/stepReview のみ。
   - guardrails、command provider、result sink type は変更しない。
   - command: `bobTemplate.validateCustomization`

4. workflow を生成する。
   - command: `bobTemplate.generateWorkflow`
   - 出力先: `.bob/workflows/<workflowName>/WORKFLOW.md`
   - 生成 workflow の front matter に `x-bob-template` が入り、templateId、templateVersion、baseTemplateHash、projectId、customizationPath を追跡できる。

5. readiness check を実行する。
   - command: `bobTemplate.checkReadiness`
   - 出力先: `.bob/template-readiness/<projectId>/<workflowName>-readiness.json`
   - Markdown report も同じ場所へ出る。

## Ready 判定

| 判定 | 条件 |
| --- | --- |
| Operator Ready | `bobTemplate.generateWorkflow` で生成された workflow を選び、human gate で承認/差戻しを説明できる。 |
| Reviewer Ready | readiness report の fail/warning を読み、required files、guardrails、artifact paths、UAT evidence の問題を説明できる。 |
| Customizer Ready | profile/customization を作成し、unsafe path や forbidden override を readiness で fail にできることを確認してから pass へ修正できる。 |

## 最小演習

1. `alpha-product` 用 profile を作り、Bazaar profile では `vcs.noAliases: true` を設定する。
2. `alpha-code-precheck` customization で checklist path と prompt supplement を変更する。
3. `bobTemplate.generateWorkflow` を実行し、生成 workflow が `.bob/workflows/alpha-code-precheck/WORKFLOW.md` にあることを確認する。
4. checklist file を一度削除して `bobTemplate.checkReadiness` を実行し、`required-files` が fail になることを確認する。
5. checklist file と UAT evidence を戻して readiness を pass にする。
