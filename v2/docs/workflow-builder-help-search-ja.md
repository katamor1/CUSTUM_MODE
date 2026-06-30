# Workflow Builder ヘルプ検索・項目ジャンプ

## 背景

Phase 1 では、Workflow Builder に静的な日本語コンテキストヘルプを追加した。

Phase 2 では、設定者が項目名や効果を覚えていなくても、ヘルプパネル上で検索し、該当項目へ移動できるようにする。

## 追加機能

- ヘルプパネル上部に `ヘルプ検索` 入力欄を表示する。
- `resultKey`、`承認`、`成果物`、`Bob`、`stop`、`テンプレート` など、日本語・英語のどちらでも検索できる。
- 検索対象は以下。
  - help entry id
  - 日本語ラベル
  - 実フィールド名
  - 概要
  - 効果
  - 使う場面
  - 注意
  - YAML例
  - select 選択肢の説明
- 検索結果には日本語ラベル、実フィールド名、対象タブを表示する。
- 検索結果をクリックすると、対象タブへ移動し、可能な場合は該当 input / select / textarea へ focus する。
- テンプレート選択、Step 追加ボタン、`includeState` / `Command` / `Result` 見出しにも `?` を表示する。
- `template`、`producedBy`、`stateKey`、`includeState` のような動的選択肢は、現在の選択値や step 一覧から補足説明を表示する。

## 実装方針

`workflowBuilderHelpCatalog.ts` のデータ構造は大きく変更しない。

`workflowBuilderHelpScript.ts` 側で、Phase 2 用の追加 help entry を `Object.assign(helpCatalog, ...)` で登録する。

対象タブは help id から推定する。

| help id prefix | tab |
| --- | --- |
| `step.` / `command.` / `result.` | `Step detail` |
| `section.command` / `section.result` / `section.includeState` | `Step detail` |
| `input.` | `Inputs` |
| `requires.` | `Requires` |
| `preflight.` | `Preflight` |
| `artifact.` | `Artifacts` |
| `guardrails.` / `approval.` | `Guardrails` |
| `completion.` | `Completion` |
| `body.` | `Markdown Body` |
| `tab.*` | 対応するタブ |
| `meta.` / `template.` / `steps.add*` | 左側の基本情報または Steps 操作 |

## 追加説明対象

- テンプレート選択肢。
- Steps の `+ AI step` / `+ Command` / `+ Manual` / `+ Result`。
- Step detail の `prompt`。
- Step detail の `includeState` セクションと各候補。
- Command セクションと `action.provider` / `args[0]` / `extra args` / `sendResult` / `completeOnSuccess`。
- Result セクションと `source` / `stateKey` / `literal text` / `file sink path`。
- `result.source` の `state` / `literal` / `agent` 選択肢。
- `artifacts.producedBy` とその選択肢。

## 非対象

- 検索結果のランキング最適化。
- 類義語辞書の導入。
- Diagnostics からの自動誘導。
- AI による動的説明生成。

これらは後続 Phase の候補とする。
