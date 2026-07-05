# Phase 4 Template Customization GUI Core Training

## 目的

この手順は、`process-code-precheck` 標準テンプレートを VS Code Webview から安全にプロジェクト別 workflow へ変換するための v1 GUI Core 教材である。Rollout Dashboard、Template Update Assistant、mechanical checks integration は対象外とする。

## 開始

1. VS Code/Bob extension host で対象 workspace を開く。
2. Command Palette から `Bob Workflow: テンプレートカスタマイズ Studio` を実行する。
3. `Template Library` タブで `process-code-precheck` が選択されていることを確認する。

## Customize タブ

編集できる項目は次に限定する。

- projectId、displayName、targetLanguage、vcs.type、vcs.root
- checklist path
- artifact output root
- UAT evidence path
- workflowName、title、description
- 既存 input default
- prompt supplement
- human gate / stepReview pauseAfter

guardrails、command provider、result sink type は Studio 上で編集しない。Bazaar または bzr profile では保存時に `vcs.noAliases: true` を持ち、手順上も `bzr --no-aliases` を使う。

## 操作順

1. `profile を検証` を押し、unsupported language/VCS や unsafe path がないことを確認する。
2. `customization を検証` を押し、許可外項目や hash 不整合がないことを確認する。
3. `preview` を押し、`Preview / Diagnostics` に生成予定の `WORKFLOW.md` と diagnostics を表示する。
4. 既存 workflow がある場合は `diff` を押し、上書き前に差分を見る。
5. `workflow を生成` を押し、次のファイルが作られることを確認する。
   - `.bob/template-profiles/<projectId>.yaml`
   - `.bob/template-customizations/<workflowName>.yaml`
   - `.bob/workflows/<workflowName>/WORKFLOW.md`
6. `Readiness` タブで `readiness check` を押し、status、score、checks、nextActions を確認する。
7. `report を開く` で Markdown report を確認する。

## Ready 判定

| ロール | Ready 条件 |
| --- | --- |
| Operator Ready | Studio で生成された workflow を Bob から実行し、human gate の承認/差戻しを説明できる。 |
| Reviewer Ready | Readiness の fail/warning と nextActions を読み、UAT へ進めるか判断できる。 |
| Customizer Ready | Studio で profile/customization を保存し、preview、diff、generate、readiness を一通り実行できる。 |

## 注意

- GUI の入力だけを信頼せず、Host 側 Core validator/generator/readiness の diagnostics を最終判断にする。
- workspace がない状態では Studio command は実行しない。
- warning は UAT evidence 未配置など、投入前に解消または明示承認が必要な状態として扱う。
