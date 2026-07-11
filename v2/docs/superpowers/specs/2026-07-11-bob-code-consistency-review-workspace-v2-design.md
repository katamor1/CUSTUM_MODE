# Bob Code Consistency Review Workspace v2 機能追加・改善企画

- ステータス: Proposed（設計レビュー待ち）
- 作成日: 2026-07-11
- 対象リポジトリ: `katamor1/bob_builtin_analyze`
- 対象拡張機能: `extensions/bob-code-consistency-review`
- 関連拡張機能: `extensions/workflow-register`、`IBM.bob-code`
- 関連計画: `docs/phase2-git-multilanguage-consistency-prereview-codex-plan-ja.md`
- 関連レビュー管理: `docs/review-findings-tracking-2026-07-05.md`

## 1. 企画要約

`bob-code-consistency-review` は、`review-input.yaml` の作成、traceability catalog の整備、Git / Bazaar 差分収集、文書・コード根拠の抽出、review-package 生成、Bob 出力検証、人間 triage までの主要機能をすでに備えている。

次の改善では解析機能を一度に増やすのではなく、現在分かれている操作と成果物を一つのレビュー単位で束ねる **Consistency Review Workspace v2** を導入する。

推奨する実施順は次のとおりである。

1. Human Triage の保存・出力整合性を修正する。
2. Review Session と Readiness Dashboard を導入する。
3. Bob 出力診断と人間の採否結果をレビュー品質改善へ戻す。
4. 言語別 analyzer adapter を一言語ずつ追加する。

第一弾の主対象は **Triage Integrity + Evidence-centered Triage** とする。データ損失と成果物の意味不一致を先に解消し、その後の UI、品質計測、多言語解析を安全に積み上げる。

## 2. 背景

### 2.1 現在の機能

現在の拡張機能は、概ね次の処理を提供している。

```text
Review Input Wizard / AI Draft / Traceability
  -> review-input.yaml
  -> preprocess
  -> review-package
  -> Bobへ投入
  -> Bob output capture
  -> output validation
  -> human triage
```

主な生成物は次のとおりである。

```text
.bob-review/
  review-package/
  bob-output/
  human-triage/
.bob-trace/
  traceability-catalog.json
  gate-report.md
```

既存 command ID は workflow template や他拡張から参照される互換性契約であるため、本企画でも維持する。

### 2.2 基盤強化との関係

2026-07-11 時点で、soft dependency、provider lifecycle、外部プロセスの timeout / cancel、path・size 境界、workflow contract、Extension Host smoke などの基盤強化が PR #68 で進行している。

本企画はそれらを重複実装しない。PR #68 または同等の基盤変更が merge・再検証された状態を Phase 0 の前提とし、Workspace v2 はその上に構築する。

特に次の仕組みは既存実装を再利用する。

- bounded external process runner
- processing limit の正規化
- workspace path policy
- provider retry / registration controller
- review-package の generation ID と input hash
- Bob output schema と evidence-index validation

## 3. 現状課題

### 3.1 レビュー全体の現在地が見えにくい

現在の Review Wizard、Result Capture、Human Triage は、それぞれの作業を実行できる。一方で、利用者は次の状態を自分で判断する必要がある。

- `review-input.yaml` は現在の base / head と一致しているか。
- 関連文書や traceability 更新後に review-package を再生成したか。
- Bob 出力はどの review-package に対するものか。
- validation warning を許容して triage へ進んでよいか。
- 未判断 finding、owner 未設定、follow-up 未記入が何件あるか。

ファイルとコマンドは存在するが、レビュー単位の状態モデルがないため、古い成果物の取り違えや手順漏れが起きやすい。

### 3.2 Human Triage の保存で情報を失う可能性がある

現在の Triage GUI は、ブラウザから送られた一部フィールドで `items` 配列を置き換える。ブラウザが送らない `follow_up` や将来追加されるフィールドは、保存時に失われる可能性がある。

人間が編集する decision と、Bob output 由来の finding 本文を同じオブジェクトで更新していることが主因である。

### 3.3 Triage 成果物名と内容が一致していない

現在の triage 生成直後は、採否前の finding 全件が `accepted-findings.md` に出力される一方、`rejected-findings.md` は手動追記用のプレースホルダーである。

人間が decision を保存しても、それに基づいて accepted / rejected / investigation / question の各成果物が再投影されない。このままでは、ファイル名が示す意味と実際の内容が一致しない。

### 3.4 複数言語を分類できるが、詳細解析は C/C++ 中心である

現在の language classifier は C/C++、TypeScript、JavaScript、Python、C#、Java、Go、Rust、SQL などを認識する。

ただし詳細 symbol 解析は C-like ファイルが中心であり、その他の言語は変更行をファイル単位で evidence 化する generic analyzer に回る。次の情報はまだ言語固有に抽出されない。

- C# / ASP.NET の Controller、public API、設定、DbContext
- Java / Spring の Controller、Service、Repository、Maven / Gradle
- SQL の table、column、procedure、index、migration、dialect
- framework ごとの interface impact や test hint

### 3.5 人間の採否結果を品質改善へ戻せない

Bob finding を人間が採用・棄却できるが、その結果を analyzer や prompt の品質評価へ戻す仕組みがない。

現状では、次の問いに定量的に答えられない。

- どの category が棄却されやすいか。
- `confidence: high` なのに棄却される finding は何か。
- 根拠数、根拠種別、traceability の強さと採用判断に関係があるか。
- analyzer や prompt template の変更後に重複指摘が増えていないか。
- generic analyzer から専用 adapter へ切り替えた効果は何か。

## 4. 目標

### 4.1 プロダクト目標

1. 一つの review session について、準備、実行、検証、triage の状態を画面で確認できる。
2. 古い review-package や別 session の Bob output を誤って利用しない。
3. Human Triage の保存で Bob finding、follow-up、未知フィールドを失わない。
4. 人間 decision から accepted / rejected / investigation / question の成果物を決定論的に再生成できる。
5. finding から evidence を直接開き、人間が根拠中心に判断できる。
6. 人間の採否結果を、analyzer と prompt の継続改善に利用できる。
7. 言語別 analyzer を共通 interface で一つずつ追加できる。

### 4.2 技術目標

1. 既存 command ID と既存 review-package path を維持する。
2. review session の状態は、保存された stage を盲信せず、成果物と hash から再計算できる。
3. Triage の source data と human decision を分離する。
4. ファイル更新は backup、schema validation、atomic replacement を前提にする。
5. 新規 Webview も既存 CSP、message whitelist、HTML escaping 方針に従う。
6. analyzer adapter は pipeline や package builder に逆依存しない。

## 5. 非目標

本企画では次を実装しない。

- Bob finding からの自動コード修正
- Bob による自動承認、merge 可否判定
- CI の強制 merge gate
- 完全な AST、型解決、build system 相当の解析
- Git push、branch 作成、merge などの VCS 書き込み
- 本番データベースへの接続や SQL 実行
- すべての言語・framework adapter の同時実装
- 既存3画面を最初から一つの巨大 Webview へ置き換えること

## 6. 検討したアプローチ

### 6.1 アプローチ A: 運用 UX 先行

Review Session、Readiness Dashboard、Triage v2 を先に実装する。

長所:

- 日常運用の事故と手作業を早期に減らせる。
- 既存 analyzer と review-package をそのまま活用できる。
- 後続機能の受け皿を先に作れる。

短所:

- 解析精度そのものは初期段階では大きく増えない。

### 6.2 アプローチ B: 解析精度先行

C#、Java、SQL adapter を先に実装する。

長所:

- 対応案件を早く広げられる。
- 言語固有の interface impact を増やせる。

短所:

- UI と評価基盤が弱いまま finding 数が増える。
- 誤検知や重複の改善効果を測りにくい。
- Triage の情報損失問題が残る。

### 6.3 アプローチ C: 品質評価先行

run 履歴、golden fixture、採否分析を先に実装する。

長所:

- 精度改善を客観的に評価できる。
- analyzer や prompt の regression を検知できる。

短所:

- 初期の利用者向け変化が小さい。
- 現在の triage data model のままでは信頼できる評価データを作りにくい。

### 6.4 採用方針

**アプローチ A を中心に、アプローチ C の最小データ基盤を同時導入する。**

Triage Integrity を最初に直し、信頼できる decision data を作った後に Review Session と品質評価を追加する。言語 adapter はその後、一言語ずつ導入する。

## 7. 全体アーキテクチャ

### 7.1 段階導入の構造

```text
Existing Commands / Existing Webviews
  -> ReviewSessionService
  -> ReadinessEvaluator
  -> Existing review-input / package / output validators

Bob Output
  -> TriageSourceBuilder
  -> triage-source.yaml          immutable snapshot
  -> TriageDecisionStore
  -> triage-decisions.yaml       human mutable data
  -> TriageProjectionBuilder
  -> triage-result.yaml          compatibility projection
  -> accepted / rejected / questions / follow-up Markdown

Review Session + Triage Decisions
  -> ReviewQualityMetrics
  -> metrics JSON / Markdown

Diff Summary
  -> LanguageAdapterRegistry
      -> C/C++ adapter
      -> Generic adapter
      -> SQL adapter v1
      -> later C# / Java adapters
```

### 7.2 新規コンポーネント

| コンポーネント | 責務 |
|---|---|
| `ReviewSessionService` | session 作成、読み込み、hash 更新、既存成果物との関連付け |
| `ReadinessEvaluator` | input、range、traceability、package、output、triage の状態再計算 |
| `TriageSourceBuilder` | Bob output から immutable な source snapshot を作成 |
| `TriageDecisionStore` | source ID 単位で人間 decision を保存・merge |
| `TriageProjectionBuilder` | source と decision を結合し、互換 YAML と Markdown を再生成 |
| `ResultValidationReportBuilder` | parse / schema / evidence / identity 診断を構造化 |
| `ReviewQualityMetrics` | category、confidence、decision、evidence 解決率などを集計 |
| `LanguageAdapterRegistry` | 言語ごとに adapter を選択し、統一形式へ集約 |
| `SqlLanguageAdapter` | SQL 固有 symbol、DB impact、risk tag の最初の専用 adapter |

### 7.3 依存方向

```text
commands / webview
  -> application services
      -> domain models / validators / analyzers
          -> shared io / path / limits
```

禁止する依存:

- analyzer から `core/pipeline.ts` への import
- analyzer から review-package writer への import
- domain service から VS Code Webview への import
- TriageDecisionStore から Bob output parser への暗黙 fallback
- workflow integration module から Webview 実装詳細への import

## 8. Review Session 設計

### 8.1 保存先

既定保存先を次とする。

```text
.bob-review/
  sessions/
    <run_id>/
      review-session.json
```

既存の `reviewPackagePath`、`bobOutputPath`、`triagePath` は移動しない。session はそれらの path、hash、generation ID を参照する。

### 8.2 Run ID

`run_id` は次の形式で生成する。

```text
CCR-YYYYMMDD-HHMMSS-<6-hex>
```

時刻は UTC とし、suffix は `crypto.randomBytes(3)` 相当の乱数から生成する。session 作成時に review input が未確定でも生成でき、同一秒の衝突を避けられる方式とする。

### 8.3 Stage と Health

単一の state に進捗と異常状態を混在させず、次の2軸で管理する。

```ts
type ReviewSessionStage =
  | "draft"
  | "input_validated"
  | "package_ready"
  | "output_captured"
  | "output_validated"
  | "triage_in_progress"
  | "completed"

type ReviewSessionHealth =
  | "ready"
  | "warning"
  | "stale"
  | "blocked"
```

`stage` は到達済み工程を表し、`health` は現在の成果物が利用可能かを表す。複数の health 条件が同時に成立した場合は、次の優先順位で一つを表示する。

```text
blocked > stale > warning > ready
```

package と Bob output はそれぞれ `fresh` / `stale` の内部 freshness を持ち、session health は各 readiness check の結果から導出する。

### 8.4 Session schema

```json
{
  "schema_version": "review-session/v1",
  "run_id": "CCR-20260711-021500-a1b2c3",
  "review_id": "timeout-bugfix-r1",
  "created_at": "2026-07-11T02:15:00Z",
  "updated_at": "2026-07-11T02:22:00Z",
  "stage": "output_validated",
  "health": "warning",
  "range": {
    "vcs": "git",
    "base_input": "main",
    "head_input": "feature/timeout",
    "base_resolved": "0123456789abcdef",
    "head_resolved": "fedcba9876543210",
    "working_tree_included": false
  },
  "input": {
    "path": "review-input.yaml",
    "sha256": "<sha256>"
  },
  "artifacts": {
    "document_hashes": {},
    "traceability_catalog_sha256": "<sha256>"
  },
  "package": {
    "path": ".bob-review/review-package",
    "generation_id": "package-001",
    "manifest_sha256": "<sha256>",
    "created_at": "2026-07-11T02:18:00Z",
    "freshness": "fresh"
  },
  "bob_output": {
    "path": ".bob-review/bob-output/bob-output.yaml",
    "sha256": "<sha256>",
    "validation_report_path": ".bob-review/bob-output/validation-report.json",
    "freshness": "fresh"
  },
  "triage": {
    "path": ".bob-review/human-triage",
    "source_sha256": "<sha256>",
    "decisions_sha256": "<sha256>",
    "open_items": 3
  }
}
```

### 8.5 Freshness 判定

次のいずれかが変わった場合、package freshness を `stale` とする。

- resolved base / head
- `review-input.yaml` の SHA-256
- review input が参照する文書の SHA-256
- accepted traceability item の投影結果
- prompt template ID
- processing limits
- analyzer version / adapter set

Bob output freshness は次の場合に `stale` とする。

- package generation ID が一致しない。
- review ID が一致しない。
- package manifest hash が一致しない。
- package 再生成後に Bob output が更新されていない。

次の場合は freshness ではなく session health を `blocked` とする。

- Bob output を parse できない。
- schema error がある。
- evidence-index に存在しない evidence を参照する。
- triage source と Bob output hash が一致しない。

### 8.6 Readiness の再計算

保存された `stage` は表示高速化に利用できるが、正しさの根拠にはしない。Dashboard refresh 時に次を再計算する。

1. review input schema と artifact path validation
2. VCS range の解決可能性
3. traceability gate status
4. package manifest の存在、hash、generation ID
5. Bob output parse / schema / evidence / identity validation
6. triage source と decision の整合性

## 9. Readiness Dashboard

### 9.1 新規 command

次の command を追加する。

```text
bobCodeConsistency.openReviewWorkspace
bobCodeConsistency.refreshReviewSession
```

既存 command は維持し、Workspace から呼び出す。

### 9.2 画面構成

Dashboard は次のカードを表示する。

| カード | 表示内容 |
|---|---|
| Review Input | schema、文書 path、review focus、input hash |
| Revision | VCS、base / head、resolved revision、working tree |
| Traceability | accepted / proposed / rejected / deprecated、gate errors / warnings |
| Review Package | generation ID、作成時刻、fresh / stale、主要 file、size summary |
| Bob Output | captured、raw / normalized、validation errors / warnings、identity match |
| Human Triage | finding 数、未判断、owner 未設定、follow-up 未完了 |

各カードには次を表示する。

- 修正または生成に進む primary action を一つ
- 詳細ファイルを開く secondary action
- stale / blocked の理由

### 9.3 導入方針

最初から全作業を一画面へ埋め込まない。

1. Dashboard を session-aware な入口として追加する。
2. 既存 Review Wizard、Result Capture、Human Triage を開く。
3. 各既存画面が同じ `run_id` を受け取り、操作後に session を更新する。
4. 利用実績を見て、必要な機能だけ Dashboard 内へ統合する。

これにより、既存 Webview を一度に作り直すリスクを避ける。

## 10. Human Triage Integrity

### 10.1 保存モデルの分離

既定の triage directory を次の構成へ変更する。

```text
.bob-review/human-triage/
  triage-source.yaml
  triage-decisions.yaml
  triage-result.yaml
  accepted-findings.md
  rejected-findings.md
  investigation-items.md
  questions-to-author.md
  follow-up-actions.md
```

役割は次のとおりである。

| ファイル | 更新主体 | 内容 |
|---|---|---|
| `triage-source.yaml` | 拡張機能 | Bob output 由来の immutable snapshot |
| `triage-decisions.yaml` | 人間 / GUI | source ID ごとの decision、severity、owner、理由、follow-up |
| `triage-result.yaml` | 拡張機能 | source と decision の互換 projection |
| 各 Markdown | 拡張機能 | decision に基づく人間向け projection |

### 10.2 Triage source schema

```yaml
schema_version: triage-source/v1
review_id: timeout-bugfix-r1
package_generation_id: package-001
bob_output_sha256: "<sha256>"
items:
  - source_id: PRE-001
    source_type: finding
    category: requirement-code-consistency
    severity: high
    confidence: medium
    summary: timeout 処理が要求と一致しない可能性がある
    reason: 要求の異常系と変更後コードの分岐が一致しない
    impact: timeout 時の上位通知が正常扱いとなる可能性がある
    recommended_action: 詳細設計と実装を確認する
    human_check: 設計担当者が今回の対象範囲を確認する
    evidence:
      - evidence_id: REQ-0001
        type: requirement
        ref: REQ-123
```

### 10.3 Triage decision schema

```yaml
schema_version: triage-decisions/v1
review_id: timeout-bugfix-r1
source_sha256: "<sha256>"
decision_revision: 3
updated_at: "2026-07-11T02:30:00Z"
items:
  PRE-001:
    decision: accepted
    final_severity: high
    owner: design-owner
    reason: 要求と実装の差を確認済み
    review_comment: 正式レビュー対象とする
    follow_up:
      required: true
      action: 詳細設計と実装を修正する
      due: "2026-07-18"
```

配列ではなく source ID を key とする map を使用し、並び替えや一部更新で別 item を誤更新しないようにする。

### 10.4 Decision enum

```ts
type TriageDecision =
  | "accepted"
  | "rejected"
  | "needs_investigation"
  | "deferred"
  | "question"
```

### 10.5 保存ルール

- GUI は decision field だけを更新する。
- source item は GUI message から受け取らず、disk の `triage-source.yaml` を正とする。
- 更新は `source_id` 単位の merge とする。
- 未知の decision field は schema version が同じ限り保持する。
- `source_sha256` が変わっていた場合は保存を中止し、競合として再読込を促す。
- `decision_revision` による optimistic locking を行う。
- 書き込み前に既存ファイルを backup する。
- 一時ファイルを同一 directory に書き、rename で置換する。

### 10.6 Decision validation

| decision | 必須条件 |
|---|---|
| `accepted` | `reason`、`owner`、`final_severity` |
| `rejected` | `reason` |
| `needs_investigation` | `reason`、`owner` または follow-up action |
| `deferred` | `reason`、follow-up due |
| `question` | `reason`、`owner` |

### 10.7 Markdown projection

- `accepted-findings.md`: decision が `accepted` の finding のみ
- `rejected-findings.md`: decision が `rejected` の finding のみ
- `investigation-items.md`: `needs_investigation` と `deferred`
- `questions-to-author.md`: Bob question と decision が `question` の item
- `follow-up-actions.md`: `follow_up.required: true` の item

projection は source と decisions から毎回再生成し、人手で Markdown を編集する運用は採用しない。

### 10.8 既存 `triage-result.yaml` の移行

`triage-decisions.yaml` がなく、既存 `triage-result.yaml` がある場合は次の移行を行う。

1. Bob output から `triage-source.yaml` を再生成する。
2. 既存 `triage-result.yaml` から decision 関連 field だけを抽出する。
3. source ID が一致する item を `triage-decisions.yaml` へ移す。
4. source ID 不一致 item は migration warning として report する。
5. 既存ファイルを backup する。
6. 新しい projection を生成する。

移行済みかどうかは `triage-decisions.yaml` の存在と schema version で判定する。結果を `migration-report.md` に残し、同じ旧ファイルを繰り返し移行しない。

## 11. Evidence-centered Triage UI

### 11.1 表示情報

各 finding / question について次を表示する。

- ID、source type
- summary
- category
- original severity / confidence
- reason / impact
- recommended action / human check
- evidence 一覧
- decision
- final severity
- owner
- human reason
- review comment
- follow-up action / due

### 11.2 Evidence navigation

Evidence ID をクリックした際は `evidence-index.json` を参照し、次を開く。

- `code-slices/<evidence_id>.md`
- `tables/<evidence_id>.md`
- `document-excerpts.md` の該当 section
- `diff-context.md` の該当 block
- 原文書 path と selector

解決できない evidence は無視せず、item 上に validation error として表示する。

### 11.3 操作

- category、severity、confidence、decision、owner で filter
- source ID、summary、evidence ID で検索
- 同じ category / owner への一括設定
- 未判断 item のみ表示
- unsaved change warning
- validation error がある item の絞り込み
- keyboard で前後 item へ移動

一括操作でも、各 item の必須条件を個別に validation する。

## 12. Result Capture Diagnostics v2

### 12.1 保存物と正本

設定済み `bobOutputPath` を、normalized Bob output の正本として維持する。既定値は `.bob-review/bob-output/bob-output.yaml` である。

既定配置は次のとおりとする。

```text
.bob-review/bob-output/
  bob-output.yaml          configured bobOutputPath / normalized canonical output
  raw-output.txt           Bobから受け取った未変更テキスト
  validation-report.json
  validation-report.md
```

`bobOutputPath` が custom path の場合、support files はその parent directory に生成する。別 directory へ暗黙に二重保存しない。

### 12.2 Raw と normalized の分離

- `raw-output.txt` は Bob から受け取った内容を変更せず保存する。
- 設定済み `bobOutputPath` は normalized output の正本とする。
- 自動補正した field は validation report に記録する。
- raw schema error と normalized schema error を別に表示する。
- `final_approval` など固定値の違反を黙って補正して成功扱いにしない。
- raw output を normalized output で上書きしない。

### 12.3 診断モデル

```json
{
  "schema_version": "bob-output-validation/v1",
  "status": "error",
  "review_id": "timeout-bugfix-r1",
  "package_generation_id": "package-001",
  "errors": [
    {
      "code": "EVIDENCE_NOT_FOUND",
      "path": "/findings/0/evidence/1/evidence_id",
      "message": "SRC-9999 is not present in evidence-index.json",
      "line": 18,
      "column": 24
    }
  ],
  "warnings": [],
  "normalizations": []
}
```

### 12.4 UI

Result Capture では、単一 status 文字列ではなく診断一覧を表示する。

- parse error の行・列
- JSON schema path
- unknown evidence ID
- duplicate finding candidate
- review ID / package generation ID mismatch
- raw と normalized の差分
- warning を許容した user decision

validation error がある場合、明示的な override なしで Triage へ進まない。override は `run_id`、user、reason、timestamp とともに session へ記録する。

## 13. Review Quality Feedback Loop

### 13.1 保存する集計

各 review session について次を集計する。

- finding / question 件数
- category 別件数
- original severity / confidence 分布
- accepted / rejected / needs_investigation / deferred / question 件数
- evidence 参照解決率
- finding 1件あたりの evidence 数
- duplicate candidate 件数
- validation error / warning 件数
- triage 未完了件数
- analyzer set / adapter version
- prompt template ID
- package bytes と truncation 件数

### 13.2 保存先

```text
.bob-review/
  metrics/
    <run_id>-review-quality.json
    <run_id>-review-quality.md
```

機密情報を増やさないため、metrics は本文を持たず ID、category、count、hash、version を中心にする。

### 13.3 評価上の注意

採用率だけを精度と定義しない。案件や review policy により、意図的に recall を高くする場合がある。

優先して見る指標は次の組み合わせである。

- `confidence: high` かつ `rejected`
- `confidence: low` かつ `accepted`
- evidence が1件だけの finding の判断分布
- category ごとの `needs_investigation` 率
- 同一 evidence・類似 summary の重複率
- adapter version 更新前後の必須 finding 検出率

### 13.4 Golden fixture

代表的な差分、文書、期待 finding を fixture として保存し、analyzer / prompt 変更時に比較する。

評価は全文完全一致ではなく次の条件で行う。

- 必須 finding が存在する。
- 禁止 finding が存在しない。
- evidence ID が期待 source を参照する。
- category と impact tag が期待集合に入る。
- duplicate が閾値を超えない。
- package size と truncation 件数が急増しない。

## 14. Language Adapter 設計

### 14.1 Interface

```ts
export interface LanguageAdapter {
  readonly language: ReviewLanguage
  readonly version: string
  supports(file: ChangedFile): boolean
  analyze(input: LanguageAnalysisInput): Promise<LanguageAnalysisResult>
}
```

```ts
export interface LanguageAnalysisResult {
  symbols: ChangedSymbolV2[]
  interfaceImpacts: InterfaceImpact[]
  dbImpacts: DbImpact[]
  testHints: TestHint[]
  warnings: string[]
  codeSlices: CodeSlice[]
  evidence: EvidenceRef[]
}
```

### 14.2 Registry

`LanguageAdapterRegistry` は file ごとに最も具体的な adapter を一つ選択する。

選択順:

1. 専用 adapter
2. C/C++ 既存 analyzer adapter
3. generic adapter

一つの file を複数 adapter が同時に解析して evidence を重複生成しないようにする。

### 14.3 最初の専用 adapter

最初の pilot は **SQL adapter v1** とする。

理由:

- file extension と domain が比較的明確である。
- 実 DB 接続や build を行わず、fixture だけで評価しやすい。
- `db-impact` という独立成果物で adapter interface を検証できる。
- C# / Java adapter より framework variation が少なく、段階導入に向く。

SQL adapter v1 の対象:

- `CREATE / ALTER / DROP TABLE`
- column add / alter / drop
- `CREATE / ALTER VIEW`
- procedure / function / trigger
- index add / drop
- DML の table 参照候補
- migration file naming
- SQL Server / PostgreSQL / MySQL / generic dialect hint

SQL を実行せず、diff と file content の静的抽出だけを行う。

### 14.4 後続順

SQL adapter の評価後、次の順を既定とする。

1. C# / .NET / ASP adapter
2. Java / Spring adapter
3. C/C++ adapter v2 の interface / struct / test hint 強化

事業案件の優先度で順番を変更する場合も、同じ adapter contract と quality fixture を利用する。

## 15. エラー処理

### 15.1 原則

- 読み取り失敗と validation failure を区別する。
- recoverable warning と次工程を止める error を区別する。
- user message、structured report、log に同じ error code を持たせる。
- fallback を使った場合は source path と理由を明示する。
- 古い成果物へ暗黙 fallback しない。

### 15.2 主な error code

| code | 条件 | 動作 |
|---|---|---|
| `SESSION_INPUT_STALE` | input hash が session と不一致 | package / output を stale にする |
| `PACKAGE_ID_MISMATCH` | Bob output と package generation ID 不一致 | triage を blocked にする |
| `TRIAGE_SOURCE_CHANGED` | decision 保存中に source hash が変化 | 保存を中止し再読込 |
| `TRIAGE_REVISION_CONFLICT` | decision revision 不一致 | 保存を中止し conflict 表示 |
| `EVIDENCE_NOT_FOUND` | evidence-index に ID がない | output validation error |
| `PROJECTION_FAILED` | decision projection 生成失敗 | 既存 projection を維持し error report |
| `ADAPTER_LIMIT_EXCEEDED` | adapter の item / bytes budget 超過 | truncation warning と残り skip |

### 15.3 部分成功

複数 projection のうち一部だけ更新された状態を作らない。

1. 全 projection を temporary directory へ生成する。
2. 全 schema / content validation を行う。
3. 成功後に対象ファイルを置換する。
4. 失敗時は既存 projection を維持する。

## 16. セキュリティ・プライバシー

- `.bob-review` と `.bob-trace` は引き続き機密情報を含む生成物として扱う。
- session と metrics には文書本文や code slice 本文を重複保存しない。
- evidence navigation は workspace path policy と realpath containment を通す。
- Webview message は action whitelist と schema validation を行う。
- HTML へ埋め込む workspace data は必ず escape する。
- CSP nonce 方針を維持する。
- output override、validation override、migration は監査可能な記録を残す。
- Bob output raw data を normalized output で上書きしない。
- untrusted workspace では外部 VCS 実行と自動ファイル生成を既存 trust policy に従って制限する。

## 17. 互換性

### 17.1 維持するもの

- 既存 `bobCodeConsistency.*` command ID
- `review-input.yaml`
- 既存 `reviewPackagePath`
- 設定済み `bobOutputPath`
- `triagePath`
- workflow-register action provider contract
- `triage-result.yaml` の互換 projection

### 17.2 追加するもの

- `review-session/v1`
- `triage-source/v1`
- `triage-decisions/v1`
- `bob-output-validation/v1`
- `review-quality/v1`
- `LanguageAdapter` contract

### 17.3 Migration policy

- 新 schema は `schema_version` を必須とする。
- 読み取りは現行版と直前版をサポートする。
- 書き込みは常に現行版とする。
- migration 前に backup を作成する。
- migration warning を Markdown と JSON で残す。
- 自動 migration で source finding の本文を補完・推測しない。

## 18. テスト戦略

### 18.1 Unit test

追加する主なテスト:

- `triageSourceBuilder.test.js`
- `triageDecisionStore.test.js`
- `triageDecisionValidation.test.js`
- `triageProjection.test.js`
- `triageMigration.test.js`
- `reviewSessionService.test.js`
- `reviewSessionFreshness.test.js`
- `readinessEvaluator.test.js`
- `resultValidationReport.test.js`
- `reviewQualityMetrics.test.js`
- `languageAdapterRegistry.test.js`
- `sqlLanguageAdapter.test.js`

### 18.2 Triage regression

最低限、次を検証する。

1. `follow_up` が GUI 保存後も失われない。
2. 未知 field が同じ schema version 内で保持される。
3. source ID の並び順を変えても decision が別 item に移らない。
4. source hash が変わった状態で保存を拒否する。
5. decision revision conflict を検出する。
6. accepted / rejected / investigation / question の Markdown が正しく分かれる。
7. projection 失敗時に既存ファイルを壊さない。
8. 旧 `triage-result.yaml` から decision を移行できる。

### 18.3 Review Session regression

1. input 変更後に package が stale になる。
2. 文書変更後に package が stale になる。
3. base / head の resolved revision 変更を検出する。
4. package 再生成後に古い Bob output を stale にする。
5. review ID / generation ID mismatch で triage を blocked にする。
6. custom output path でも path policy を維持する。
7. session JSON が壊れていても既存成果物から再構築できる。

### 18.4 Webview test

source regex だけでなく、message handler の pure function と mock panel を使用した behavior test を追加する。

- action whitelist
- posted payload validation
- session ID 引き回し
- stale state 表示
- evidence open action
- unsaved change warning
- conflict response
- bulk update の個別 validation

### 18.5 Extension Host / UAT

次を実 VS Code Extension Host で確認する。

- Workspace Dashboard から既存3画面へ遷移できる。
- extension dependency が遅延 activation しても session refresh が回復する。
- multi-root で Bob workspace root と VCS root を取り違えない。
- Bob output capture 後に validation diagnostics が表示される。
- triage 保存、再読込、projection 再生成が一致する。
- SQL fixture で db-impact と evidence navigation が動作する。

## 19. 段階リリース

### Phase 0: 基盤ベースライン

前提:

- PR #68 または同等の基盤変更が merge・検証済みである。
- external process、path、limits、provider lifecycle、Extension Host smoke の基準を満たす。

成果物:

- release evidence 更新
- 既存 test / policy の green 確認

### Phase 1: Triage Integrity

実装:

- `triage-source.yaml`
- `triage-decisions.yaml`
- keyed merge
- optimistic locking
- decision validation
- decision-based Markdown projection
- 旧 `triage-result.yaml` migration

完了条件:

- GUI 保存で source field と未知 field が失われない。
- accepted / rejected 成果物が decision と一致する。
- migration と conflict の regression test が通る。

### Phase 2: Review Session + Dashboard

実装:

- `ReviewSessionService`
- `ReadinessEvaluator`
- session JSON
- freshness 判定
- `openReviewWorkspace`
- 既存画面への run ID 引き回し

完了条件:

- input、document、range、package、output の stale を検知できる。
- 次に実行すべき action が Dashboard に一つ表示される。
- 古い Bob output で triage を開始しない。

### Phase 3: Diagnostics + Quality Feedback

実装:

- raw / normalized output 分離
- structured validation report
- evidence navigation
- review quality metrics
- golden fixture runner

完了条件:

- validation error の path、line、evidence ID を表示できる。
- analyzer / prompt version と triage decision を関連付けられる。
- fixture regression を CI summary に出せる。

### Phase 4: SQL Adapter Pilot

実装:

- `LanguageAdapterRegistry`
- SQL adapter v1
- db-impact schema / output
- SQL prompt guidance
- SQL fixture と UAT

完了条件:

- SQL change が generic `unknown` だけでなく DB object と risk tag を出す。
- 実 DB 接続なしで解析できる。
- required / forbidden finding fixture を満たす。
- generic fallback と重複 evidence を生成しない。

## 20. 成功指標

### 20.1 Phase 1 / 2 の必須指標

| 指標 | 目標 |
|---|---:|
| Triage 保存時の既知 field 保持率 | 100% |
| 同一 schema version の未知 field 保持率 | 100% |
| decision と projection Markdown の不一致 | 0件 |
| 解決不能 evidence を正常扱いする件数 | 0件 |
| stale package / output の検知 fixture | 100% pass |
| 別 session の output 取り違え | 0件 |
| session 再構築 fixture | 100% pass |

### 20.2 運用指標

| 指標 | 初期目標 |
|---|---:|
| Bob output 初回 validation 成功率 | 90%以上 |
| finding から evidence を直接開ける割合 | 100% |
| 手書きで `review-input.yaml` の全 field を編集する session | 20%未満 |
| owner / follow-up 未設定のまま completed になる accepted finding | 0件 |
| stale 理由を表示できない session | 0件 |

採用率と棄却率は、最初の実運用データを baseline とし、単独の品質目標にはしない。

## 21. 優先度付きバックログ

| 優先度 | 項目 | 効果 | 規模 |
|---|---|---|---|
| P0 | Triage 保存時の field loss 修正 | データ破壊防止 | S |
| P0 | decision-based projection | 成果物の意味整合 | S |
| P1 | finding 詳細と evidence navigation | 判断品質向上 | M |
| P1 | Review Session model | 取り違え防止 | M |
| P1 | Readiness Dashboard | 操作短縮 | M |
| P1 | structured validation diagnostics | Bob output 修正容易化 | M |
| P2 | quality metrics / golden fixture | 精度改善の定量化 | M |
| P2 | SQL adapter pilot | 多言語 adapter 基盤検証 | L |
| P2 | package size detail report | 負荷・truncation 可視化 | S-M |
| P3 | feature root / type / module budget 整理 | 長期保守性 | M |

## 22. 保守性改善との接続

既存レビューで継続管理されている次の項目は、本企画に組み込んで解消する。

| 継続項目 | 本企画での扱い |
|---|---|
| code-slices / tables 個別 size limit | Phase 3 の package health と metrics に統合 |
| `review-package-size-report.json` | Dashboard の package card で利用 |
| `core/` feature root 分割 | 新 service 追加時に `session/`、`triage/`、`quality/` へ配置 |
| command / provider module 分割 | Workspace command 追加時に `commands/` へ統一 |
| coverage / metrics trend | Phase 3 の CI summary に統合 |
| schema-derived type | session / triage schema 安定後に段階導入 |
| `noUnusedLocals` | 新規 module から先行適用し、既存へ拡大 |
| facade export budget | LanguageAdapter registry 導入時に policy 化 |

本企画と無関係な一括リファクタリングは行わず、機能境界を追加する際に対象 module を移動する。

## 23. 受け入れ条件

Workspace v2 の企画完了条件は次のとおりである。

1. Human Triage の source と decision が分離されている。
2. GUI 保存で source data、follow-up、未知 field を失わない。
3. decision から全 Markdown projection を決定論的に再生成できる。
4. Review Session が input、range、package、output、triage を関連付ける。
5. stale / blocked の理由を Readiness Dashboard で説明できる。
6. Bob raw output と normalized output を別に監査できる。
7. validation diagnostics から evidence を開ける。
8. 人間 decision と analyzer / prompt version を metrics で関連付けられる。
9. SQL adapter pilot が共通 adapter contract 上で動作する。
10. 既存 command ID、workflow provider、既存 path の互換性テストが通る。
11. unit、contract、Extension Host、UAT の結果を release evidence に残す。
12. Bob が最終承認を行わず、人間 triage が最終判断であるという製品境界を維持する。

## 24. 決定事項

本設計で提案する決定事項は次のとおりである。

1. 第一弾は Triage Integrity とする。
2. Triage source と human decision を別ファイルへ分離する。
3. `triage-result.yaml` は互換 projection として維持する。
4. Review Session は既存成果物を移動せず、hash と generation ID で関連付ける。
5. session の進捗は `stage`、利用可否は `health` で表す。
6. health の優先順位は `blocked > stale > warning > ready` とする。
7. Readiness は成果物から再計算し、保存状態を盲信しない。
8. Workspace は既存3画面の facade として段階導入する。
9. 設定済み `bobOutputPath` を normalized output の正本として維持する。
10. Bob raw output を normalized output で上書きしない。
11. 採用率だけをレビュー品質指標にしない。
12. 最初の専用 language adapter は SQL とする。
13. 既存 command ID と workflow contract を維持する。
14. 基盤強化 PR #68 と重複する実装は行わない。

## 25. 実装計画への移行条件

実装計画を作成する前に、利用者レビューで次を確認する。

- Phase 1 の triage file schema
- 既存 `triage-result.yaml` の migration 方針
- Review Session の storage path と hash 対象
- Dashboard が既存 Webview を開く段階導入方針
- SQL adapter を最初の pilot とする優先順位

設計承認後は、Phase 1 を独立した実装計画として作成し、Triage Integrity の完了後に Phase 2 以降を別計画として進める。
