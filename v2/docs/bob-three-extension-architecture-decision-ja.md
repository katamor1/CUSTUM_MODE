# Bob 3拡張機能構成 評価・判断ドキュメント

- 対象リポジトリ: `katamor1/bob_builtin_analyze`
- 対象ディレクトリ: `extensions/`
- 対象拡張機能:
  - `workflow-register`
  - `bob-bazaar-review`
  - `bob-code-consistency-review`
- 作成日: 2026-07-04
- 目的: 現状の3拡張機能構成について、機能や責務でさらに分割すべきか、単一拡張へ統合すべきか、現行構成を維持すべきかを判断できる材料を整理する。

---

## 1. 結論

現時点の推奨は、**現行の3拡張機能構成を維持する**ことである。

ただし、「今のまま何もしない」という意味ではない。今後の開発では、次の方針に寄せる。

1. **ユーザー可視のVS Code拡張機能は3つのまま維持する。**
2. **`workflow-register` を共通実行基盤として明確に扱う。**
3. **`bob-bazaar-review` と `bob-code-consistency-review` は domain extension / action provider として分ける。**
4. **共通化は、単一VSIX化ではなく、workflow action contract、成果物schema、CI、共通テスト、必要最小限のshared helperで行う。**
5. **さらに細かいVSIX分割は行わず、各拡張内部のファイル・モジュール分割で対応する。**
6. **将来、導入手順を簡単にする必要が出た場合は、コード統合ではなく extension pack または配布手順で吸収する。**

一文で表すと、次の判断になる。

> **3拡張を「基盤1つ + 業務/工程別連携2つ」として維持し、統合は契約・成果物・品質ゲートで行う。単一巨大拡張にはしない。**

---

## 2. 判断の背景

`extensions/README.md` では、3拡張機能は次の関係で整理されている。

```text
IBM.bob-code
  └─ workflow-register
       ├─ bob-bazaar-review
       └─ bob-code-consistency-review
```

この構図は、実装上も計画上も妥当である。

- `workflow-register` は `.bob/workflows/*/WORKFLOW.md` を読み込み、Bob ワークフローとして登録・検証・実行・再開・診断する基盤拡張である。
- `bob-bazaar-review` は Bazaar 差分レビュー、project rules、review-result JSON検証、読み取り専用 Bazaar MCPを提供する連携拡張である。
- `bob-code-consistency-review` はコード変更と要求・設計・テスト仕様の整合プレレビュー用 review-package、traceability sidecar、Bob出力検証、人間triageを提供する連携拡張である。

全体計画でも、Phase 0では3拡張共通の安全性・運用品質・配布再現性を固め、Phase 1では `bob-bazaar-review` を主対象にBazaarレビュー実績を作成し、Phase 2では `bob-code-consistency-review` を主対象にGit/複数言語の整合プレレビューへ展開し、Phase 3以降では `workflow-register` を中心に工程別Bobワークフローを整備する流れになっている。

つまり、3拡張は横並びの便利ツールではない。**実行基盤、Bazaarレビュー実績化、コード/文書整合プレレビュー**という異なる責務を持つ。

---

## 3. 現状の責務整理

| 拡張 | 現在の主責務 | 主な入力 | 主な出力 | 外部依存 / 連携 | 評価 |
|---|---|---|---|---|---|
| `workflow-register` | Bob workflow の登録、検証、実行、manual/command/agent/result step、run state、診断、GUI Builder | `.bob/workflows/*/WORKFLOW.md`、workflow inputs、Bob task context | `.bob/workflows/runs/**`、diagnostics、result sink出力 | `IBM.bob-code` はBob UI登録時のみ必須。standalone実行も可能 | 3拡張の基盤。別拡張として維持すべき |
| `bob-bazaar-review` | Bazaar revision / range / working tree差分のreview packet化、project rules、review-result保存、Bazaar MCP | Bazaar repo、revision/range、`.bob/review/**` | review packet、`.bob/review/results/*.json|md`、MCP設定 | Bazaar CLI、任意で `IBM.bob-code` / `workflow-register` | Bazaar固有。基盤に混ぜず別拡張が妥当 |
| `bob-code-consistency-review` | コード差分と要求・設計・テスト仕様の整合プレレビュー、review-package生成、traceability、人間triage | `review-input.yaml`、Git/Bazaar diff、docs、traceability catalog | `.bob-review/**`、`.bob-trace/**`、Bob output validation、triage | `IBM.bob-code` と `local.workflow-register` に依存 | 重い業務pipeline。別拡張が妥当 |

---

## 4. 選択肢評価

| 選択肢 | 内容 | 長所 | 短所 | 判定 |
|---|---|---|---|---|
| A. 現行3拡張を維持 | `workflow-register`、`bob-bazaar-review`、`bob-code-consistency-review` を別VSIXとして維持 | 責務境界が明確。Phase計画と一致。障害影響範囲を限定できる。依存を分けられる | 導入手順・CI・バージョン管理は3つ分必要 | **採用** |
| B. 単一VSIXへ統合 | 3拡張を1つの巨大拡張にする | インストールは簡単。コマンド連携は内部呼び出しにできる | 基盤と業務機能が密結合。依存・設定・UIが肥大化。障害切り分けが悪化。Phaseごとの展開が難しい | **非推奨** |
| C. さらに細かくVSIX分割 | workflow engine、GUI Builder、Bazaar MCP、traceability等を別拡張にする | 一部責務はより小さくなる | 拡張間APIが増え、導入順・互換性・テストが難しくなる。利用者体験が悪化 | **現時点では非推奨** |
| D. 3拡張 + shared package | 3VSIXは維持し、重複helperだけ共有する | path/revision/schemaなどを統一できる | shared packageのAPI安定性とVSIX同梱管理が必要 | **条件付き採用** |
| E. extension pack追加 | 3拡張とIBM.bob-codeの導入をまとめる | 導入手順が簡単。コード統合不要 | private/local配布では効果が限定的。依存version管理が必要 | **将来候補** |

---

## 5. 単一拡張へ統合しない理由

### 5.1 `workflow-register` は基盤であり、業務機能ではない

`workflow-register` は `.bob/workflows/*/WORKFLOW.md` を読み、`agent` / `command` / `manual` / `result` step を実行する。これは Bazaarレビューや整合プレレビューだけでなく、Phase 3以降の調査、設計、テスト設計、QA、レビュー工程にも使う前提の共通基盤である。

ここへ Bazaar固有処理や文書抽出処理を直接入れると、基盤の責務が濁る。

`workflow-register` は、次のような公開APIとコマンド契約を持つ「実行基盤」として独立させるのがよい。

```ts
registerActionProvider(...)
registerAgentProvider(...)
registerResultSink(...)
runWorkflow(...)
runWorkflowStep(...)
runNextStep(...)
```

### 5.2 `bob-bazaar-review` はVCS固有で、Phase 1の主役である

`bob-bazaar-review` は Bazaar CLI、revision/range、`--no-aliases`、MCP、project rules、review-result schema などに強く依存している。

全体計画では、Phase 1は `bob-bazaar-review` を主対象に、Bazaarレビュー実績を作るフェーズである。このため、Bazaarレビューは独立した改善・UAT・リリースサイクルを持つべきである。

これを `workflow-register` に統合すると、Bazaarを使わないプロジェクトにもBazaar固有機能が見えてしまう。逆に、`bob-code-consistency-review` に統合すると、Bazaarレビュー実績作成という明確な目的が、コード/文書整合レビューの中に埋もれる。

### 5.3 `bob-code-consistency-review` は重いpipelineであり、依存も別種である

`bob-code-consistency-review` は、`review-input.yaml`、文書抽出、Git/Bazaar diff、C/C++解析、traceability sidecar、review-package、Bob output YAML検証、human triageを持つ。実行時依存も `ajv`、`cheerio`、`mammoth`、`read-excel-file`、`yaml` など、3拡張の中で最も重い。

これは単なるレビューコマンドではなく、**工程間整合プレレビューpipeline**である。

このpipelineを `workflow-register` や `bob-bazaar-review` に混ぜると、基盤拡張やBazaar専用拡張のbundle、テスト、脆弱性監査、障害原因が重くなる。

### 5.4 Phase計画が「3拡張の役割分担」を前提にしている

全体計画は次のように段階化されている。

- Phase 0: `workflow-register` を中心に基盤安定化、3拡張共通のCI・VSIX・安全境界を整える。
- Phase 1: `bob-bazaar-review` を中心にBazaarレビュー実績を作る。
- Phase 2: `bob-code-consistency-review` を中心にGit/複数言語の整合プレレビューへ展開する。
- Phase 3: `workflow-register` を中心に工程別 workflow catalog を作る。
- Phase 4: `workflow-register` のテンプレートカスタマイズ基盤を使い、7プロジェクトへ展開する。

この計画は、単一巨大拡張よりも、**基盤拡張 + 専門拡張 + workflow契約**の方が自然に進められる。

---

## 6. さらに細かくVSIX分割しない理由

### 6.1 分割単位は「VSIX」ではなく「内部モジュール」で十分

既存のリファクタリングでは、3拡張ともAIと人間が読みやすい単位への内部分割が進んでいる。

例:

- `workflow-register`
  - `bobWorkflowFactory.ts`
  - `bobWorkflowMessages.ts`
  - `bobTaskInputs.ts`
  - `taskSnapshotRecovery.ts`
  - `bobApi.ts`
  - `reports.ts`
- `bob-bazaar-review`
  - `workflowRegisterBridge.ts` 相当の workflow接続層
  - `bazaarReviewCommands.ts`
  - `reviewResultValidationCommand.ts`
- `bob-code-consistency-review`
  - `extensionCommandOptions.ts`
  - `reviewInputWizard.ts`
  - `workflowProviderRegistration.ts`
  - `workspaceInitializer.ts`
  - `traceabilityCommands.ts`
  - `reviewExecutionCommands.ts`

この方向性は正しい。追加で行うべきなのは、VSIX分割ではなく、`extension.ts` から責務別 command handler をさらに切り出すことだ。

### 6.2 VSIX分割は利用者・UAT担当に負担が大きい

Bob活用基盤は7プロジェクト展開が前提であり、PL、SE、UAT担当、拡張機能オーナーが利用する。細かくVSIXを分けると、次の負担が増える。

- 導入順の説明
- extension ID / version の互換性確認
- 「どの拡張が足りないのか」の問い合わせ対応
- UAT環境の再現性
- command IDやaction provider IDの存在確認
- CI matrix とVSIX成果物数

現時点では、1つの基盤拡張と2つの専門拡張という粒度が、利用者に説明しやすい。

### 6.3 workflow action provider が既に疎結合点になっている

`workflow-register` は action provider / result sink / agent provider の拡張点を持つ。`bob-bazaar-review` と `bob-code-consistency-review` は、この接続点を使えばよい。

この構成では、専門拡張を内部に取り込まなくても、workflow step から専門処理を呼べる。

つまり、**拡張機能を分けたまま、workflow上では統合体験を作れる**。

---

## 7. 現行構成で強化すべき境界

現行構成は妥当だが、次の境界を明文化・強化しないと、3拡張が徐々に密結合になる。

### 7.1 workflow action contract

`workflow-register` から専門拡張を呼ぶときの入出力を、拡張ごとに文書化する。

最低限、次を決める。

```text
provider id
command id
action input schema
action output schema
resultKey に保存する値
sendResult でBobへ渡してよい情報
失敗時の戻り値
required step が失敗したときの扱い
```

特に `bob-bazaar-review` の `collectReviewContext`、`loadReviewRules`、`captureReviewResult`、`bob-code-consistency-review` の `preprocess`、`captureBobOutput`、`validateOutput`、`triage` は、workflowから安定して呼ばれる public contract として扱う。

### 7.2 成果物contract

3拡張の成果物は、次の領域に分かれている。

```text
.bob/workflows/runs/
.bob/review/results/
.bob-review/
.bob-trace/
.bob-process-runs/       # Phase 3以降の候補
.bob-process-records/    # Phase 3以降の候補
```

成果物ごとに次を定義する。

```yaml
schema_version: ...
producer_extension: ...
producer_version: ...
workflow_run_id: ...
source_vcs: git|bazaar|none
source_revision: ...
input_hash: ...
contains_sensitive_context: true|false
human_review_required: true|false
```

これにより、3拡張を統合しなくても、成果物を横断的に追跡できる。

### 7.3 security / privacy boundary

Phase 0の計画に従い、次は3拡張横断の共通原則にする。

- workflow command は trusted workspace 前提でも防御的に検証する。
- `vscode.executeCommand` は provider ID だけでなく実 command ID を検証する。
- task snapshot は機密情報を含む前提で扱い、messages保存は明示opt-inにする。
- VCS / MCP は read-only by default とする。
- workspace外への読み書きは原則禁止にする。
- Git/Bazaar revision はCLI引数に渡す前に検証する。
- Bob/AI出力はschema検証と人間triageを通す。

### 7.4 extension dependency policy

依存関係は次の方針で固定する。

```text
workflow-register
  - IBM.bob-code は Bob UI 登録時のみ必要
  - standalone authoring / validation / execution は可能

bob-bazaar-review
  - extensionDependencies は原則持たない
  - IBM.bob-code / workflow-register は任意連携
  - Bazaar review packet 生成だけでも動く

bob-code-consistency-review
  - IBM.bob-code と local.workflow-register に依存
  - workflow連携前提の工程間整合レビュー拡張として扱う
```

この非対称性は、統合すべき問題ではなく、役割の違いとして維持する。

---

## 8. 共通化してよいもの / してはいけないもの

### 8.1 共通化してよいもの

次は重複が増えた時点で shared helper / shared package 化してよい。

| 候補 | 理由 | 注意 |
|---|---|---|
| workspace path strict resolver | Phase 0で3拡張横断の安全境界になる | 外部path opt-inは明示設計する |
| Git/Bazaar revision validator | `bob-bazaar-review` と `bob-code-consistency-review` で近い問題を扱う | Bazaar専用とGit専用を無理に1関数へ混ぜない |
| artifact metadata writer | `.bob-review` / `.bob-trace` / `.bob/review/results` の追跡性を上げる | schema_versionを固定する |
| JSON/YAML schema validation wrapper | Bob出力検証、review-input検証、review-result検証で共通化余地がある | 各domain schemaの責務は分ける |
| redaction / secret scan helper | snapshot、Bob output、review packageで共通に必要 | 誤検出時の扱いを定義する |
| CI / package policy scripts | 既にroot scriptsがあり、拡張横断で有効 | ルールを厳しくしすぎて開発を止めない |

### 8.2 共通化しないもの

次は共通化しない。

| 対象 | 理由 |
|---|---|
| workflow runtime本体 | `workflow-register` の中核責務であり、専門拡張に漏らすべきではない |
| Bob task snapshot形式 | privacy / compatibility に直結するため基盤側で管理する |
| Bazaar MCP server内部 | Bazaar固有の境界であり、整合レビュー側に混ぜない |
| `review-input.yaml` domain model全体 | `bob-code-consistency-review` の中核責務であり、汎用化しすぎると曖昧になる |
| GUI Builder / Traceability Prep / Bazaar Review GUI | それぞれユーザー目的が違う。共通Webview基盤化は時期尚早 |
| command ID / provider ID | 互換性に直結するため、移動や統合で名前を変えない |

---

## 9. 将来の見直し条件

### 9.1 単一VSIX化を再検討してよい条件

次をすべて満たす場合だけ、単一VSIX化を再検討する。

- 7プロジェクトすべてが常に3拡張を同時利用する。
- Bazaar専用機能とGit/整合レビュー機能の利用者がほぼ完全に一致する。
- `bob-code-consistency-review` の重い依存を全利用者に配布しても問題ない。
- Phase 0〜4のリリースサイクルが完全に同期する。
- 単一障害で全Bob workflow運用が止まるリスクを許容できる。

現状、この条件は満たしていない。

### 9.2 さらにVSIX分割してよい条件

次のいずれかが明確になった場合のみ検討する。

- `workflow-register` の GUI Builder が独立製品級に大きくなり、workflow runtimeと別リリースした方が安全になる。
- `bob-code-consistency-review` の文書抽出・多言語解析が巨大化し、review input / output pipelineと別プロセス化した方がよい。
- Bazaar MCP server を他ツールからも再利用する必要が出て、VS Code拡張ではなく単独MCP packageとして管理した方がよい。

ただし、この場合も最初に検討するのは **VSIX分割ではなく、内部module分割、lazy import、別process化、shared package化**である。

### 9.3 extension pack を検討してよい条件

次の課題が出たら、コード統合ではなく extension pack を検討する。

- 導入手順が長く、UAT担当が間違えやすい。
- 3拡張の対応versionを毎回説明する必要がある。
- 7プロジェクト展開時に、標準セットとして一括導入したい。

extension pack は導入体験を統合するだけで、実装責務は統合しない。

---

## 10. 推奨アクション

### 10.1 すぐ行う

1. この判断を `extensions/README.md` から参照できるようにする。
2. `workflow-register` の public API / action provider contract を `docs/` にまとめる。
3. `bob-bazaar-review` と `bob-code-consistency-review` の workflow action input / output schema を文書化する。
4. Phase 0の work packageに沿って、security / privacy / path / revision boundaryを先に固める。
5. 3拡張のCI matrix、VSIX package、lockfile、package policyを継続してそろえる。

### 10.2 次に行う

1. `review-record` / `process-record` / `artifact metadata` の共通schemaを作る。
2. `workspace path strict resolver` と `revision validator` の共通化可否を実装差分から判断する。
3. `bob-code-consistency-review` は `reviewInputCommands.ts` を切り出し、entrypointを薄くする。
4. `workflow-register` は `bobStepRuntime.ts` を切り出し、runtime責務を明確にする。
5. `bob-bazaar-review` は必要になった時点で provider / project rules / MCP command を小分けにする。

### 10.3 後で判断する

1. shared package を作るか、root scripts / docs / schema共有に留めるか。
2. extension pack が必要か。
3. Phase 3 / Phase 4 の工程別workflow catalogを、3拡張のどこに置くか。
4. 7プロジェクト展開時のversion compatibility matrixをどの形式で管理するか。

---

## 11. 最終判断

現状の3拡張機能構成は、**分け方として妥当**である。

理由は、3拡張がそれぞれ次の異なる責務を持っているためである。

```text
workflow-register
  = Bob workflow 実行・登録・診断の共通基盤

bob-bazaar-review
  = Bazaar review 実績作成の専門拡張

bob-code-consistency-review
  = 要求・設計・テスト仕様とコード変更の整合プレレビューpipeline
```

統合すべきなのは、コード本体やVSIXではなく、次の領域である。

```text
workflow action contract
成果物schema
review record / triage record
security / privacy policy
CI / package / lockfile policy
導入・UAT・運用ガイド
```

したがって、採用すべき構成は次である。

```text
ユーザー可視の拡張: 3つのまま維持
実行基盤: workflow-register に集約
業務別機能: bob-bazaar-review / bob-code-consistency-review に分離
統合体験: workflow-register の action provider / workflow catalog で実現
共通化: schema・成果物・安全境界・CI から始める
単一巨大VSIX: 現時点では非推奨
追加VSIX分割: 現時点では非推奨
```

この方針なら、Phase 0〜4の計画、7プロジェクト展開、Bob出力の人間確認、read-only by default、安全な成果物保存、AI/CODEXが扱いやすい内部粒度のすべてと整合する。
