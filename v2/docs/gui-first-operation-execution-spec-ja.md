# GUIファースト操作設計 実装仕様

- 対象: GUI-00 から GUI-07
- 対象拡張: `workflow-register`, `bob-bazaar-review`, `bob-code-consistency-review`
- 方針: GUI は既存 command / service / artifact を呼ぶ薄い入口とし、レビュー、検証、path 判定、workflow 実行の本体を重複実装しない。

## 1. 用語

| 画面表示 | 内部用語 | 用途 |
|---|---|---|
| Bob Operation Hub | Operation Hub | 主要操作の入口。Explorer の View と command から開く。 |
| ワークフロー | workflow | `.bob/workflows` の定義。 |
| 実行 | run | `.bob/workflows/runs` の実行状態。 |
| 成果物 | artifact | workflow、review package、record、triage などの生成物。 |
| 根拠 | evidence | review-input / review-package / Bob output が参照する証跡。 |
| 取り込み | capture | Bob 出力候補を検出し、保存前に検証する操作。 |
| 検証 | validation | schema、evidence ref、path、guardrail の確認。 |
| 採否判断 | human triage | Bob finding を人間が採用、棄却、追加調査、保留へ分類する操作。 |

## 2. 共通画面契約

すべての Webview / WebviewView は次の契約を守る。

| 項目 | 契約 |
|---|---|
| CSP | `webview.cspSource` と nonce を使い、inline handler を使わない。 |
| message | host 側で `type` と `action` を allowlist 検証する。 |
| command | GUI action から呼ぶ command ID は固定 allowlist だけにする。 |
| path | workspace 外 path を保存先、入力候補、open 対象にしない。 |
| VCS | GUI-00..07 では VCS 書き込み操作を作らない。 |
| Bob 出力 | 保存前に既存 validator / capture helper を通す。 |
| human gate | AI / Bob 出力は GUI で人間の採否判断を残す。 |

## 3. Command から GUI への対応

| ID | 追加 / 既存 | 表示入口 | 実装責務 |
|---|---|---|---|
| `workflowRegister.openOperationHub` | 追加 | Hub を開く | Operation Hub panel / view を表示する。 |
| `workflowRegister.operationHub` | 追加 View ID | Explorer | Home、Setup Checklist、Workflow Catalog、Run Monitor を表示する。 |
| `workflowRegister.openWorkflowBuilder` | 既存 | Hub > ワークフローを作る | 既存 GUI Builder を開く。 |
| `workflowRegister.runWorkflow` | 既存 | Hub > Workflow Catalog > 開始 | 既存 workflow 実行 command を呼ぶ。 |
| `workflowRegister.resumeWorkflowRun` | 既存 | Hub > Run Monitor > 再開 | 既存 resume command を呼ぶ。 |
| `workflowRegister.openRunControlView` | 既存 | Hub > Run Monitor > 詳細 | 既存 Run Control View を開く。 |
| `bobBazaar.openReviewGui` | 既存拡張 | Hub > Bazaar レビュー | Wizard v2 を開く。 |
| `bobBazaar.openResultCaptureGui` | 追加 | Bazaar > Result Capture | 既存 result capture helper を呼ぶ GUI。 |
| `bobBazaar.openHumanTriageGui` | 追加 | Bazaar > Human Triage | 既存 review record / triage helper を呼ぶ GUI。 |
| `bobCodeConsistency.openReviewWizard` | 追加 | Hub > 整合プレレビュー | VCS、文書、focus、traceability、package 作成を案内する。 |
| `bobCodeConsistency.openResultCaptureGui` | 追加 | 整合 > Result Capture | 既存 Bob output capture / validator を呼ぶ GUI。 |
| `bobCodeConsistency.openHumanTriageGui` | 追加 | 整合 > Human Triage | 既存 human triage helper を呼ぶ GUI。 |

既存 command ID は互換性のため変更しない。新しい GUI action は、上表の command か既存 command allowlist だけを実行する。

## 4. 画面契約

### GUI-01 Bob Operation Hub

Home は次を表示する。

- workspace 名
- `.bob` / `.bob/workflows` / `.bob/workflows/runs` の検出状態
- Bob / Bob Bazaar Review / Bob Code Consistency Review 拡張の有効化状態
- 推奨アクション: `レビューを開始`, `整合プレレビューを開始`, `工程別ワークフローを開く`, `前回の続きを再開`, `セットアップを確認`

Setup Checklist は不足を状態カードで表示し、修正は既存初期化 command かドキュメント表示に委譲する。

Workflow Catalog は `workflow-register` の登録済み workflow 定義、または `.bob/workflows` の定義ファイルを一覧化し、`開始` ボタンから既存実行 command へ渡す。

### GUI-02 Run Monitor

Run Monitor は `.bob/workflows/runs` の run state を source of truth とする。

| 状態 | 表示 | 操作 |
|---|---|---|
| 実行中 | current step を強調 | `詳細を開く`, `ログを見る` |
| 承認待ち | human gate badge | `承認して次へ`, `再試行` |
| manual step | manual badge | `手順を開く`, `完了にする` |
| failed | error card | `再試行`, `失敗理由を見る` |
| artifact あり | 成果物 list | `成果物を開く` |

操作は Run Control の既存 command / provider に委譲する。

### GUI-03 Bazaar Review Wizard v2

ステップは `campaign`, `target`, `rules`, `Bob投入`, `result capture`, `human triage`, `summary` の順に表示する。Wizard は既存 Bazaar review GUI を拡張し、次を満たす。

- `--no-aliases`, readonly MCP, allowed root を状態カードで表示する。
- packet / result / record / summary は既存 helper と artifact を使う。
- invalid result は保存不可にし、schema issue を Result Capture へ表示する。

### GUI-04 Consistency Review Wizard v2

ステップは `VCS`, `revision`, `文書候補`, `review focus`, `traceability`, `review-input`, `package preview`, `Bob output`, `human triage` の順に表示する。

- VCS は `git` / `bazaar` / `working_tree` の候補から選ぶ。
- 文書候補は既存 discovery / review-input builder の候補を表示する。
- review focus は既存 schema enum を使う。
- package 作成は既存 preprocess command / service を呼ぶ。

### GUI-05 Evidence Picker

Evidence Picker は `bob-code-consistency-review` の wizard 内に組み込む。

- 文書候補、変更ファイル、traceability proposed / accepted 件数を表示する。
- traceability の承認操作は既存 Traceability Prep Webview へ委譲する。
- selected evidence から review-input を生成するときは既存 builder を通す。

### GUI-06 Result Capture

Result Capture は clipboard / active editor / 手動貼り付け候補を画面に表示し、保存前に検証する。

| 対象 | 検証 |
|---|---|
| Bazaar review-result JSON | 既存 result capture / schema validation |
| Consistency Bob output YAML | 既存 `captureBobOutput` と `validateBobOutput` |

保存できない場合は保存ボタンを disabled にし、issue path と修正導線を表示する。

### GUI-07 Human Triage

Human Triage は finding table を表示し、判断結果を既存 triage artifact へ保存する。

| decision | 必須入力 |
|---|---|
| 採用 | owner または next action |
| 棄却 | reason |
| 追加調査 | owner と next action |
| 保留 | reason |

保存後は summary / record 生成 command へ進める。

## 5. GUI-UAT

| ID | 範囲 | 操作 | 合格条件 |
|---|---|---|---|
| GUI-UAT-001 | GUI-01 | Command Palette を使わず Hub を開き Setup Checklist を確認する。 | workspace 状態と不足項目が表示される。 |
| GUI-UAT-002 | GUI-02 | Run Monitor から中断 run を開く。 | current step、成果物、再開/再試行導線が表示される。 |
| GUI-UAT-003 | GUI-03,06,07 | Bazaar wizard から packet、result capture、triage へ進む。 | invalid result は保存されず、有効 result は triage へ進める。 |
| GUI-UAT-004 | GUI-04,05 | 整合 wizard で VCS と文書候補を選び review-input を作る。 | YAML / JSON を手編集せず review-input が生成される。 |
| GUI-UAT-005 | GUI-04,06 | Bob output YAML を取り込んで検証する。 | evidence ref error が画面に表示され、保存不可になる。 |
| GUI-UAT-006 | GUI-07 | finding を採用、棄却、追加調査へ分類する。 | triage artifact に decision と reason / owner が残る。 |
| GUI-UAT-007 | 互換性 | 既存 Command Palette command を実行する。 | 既存 tests と workflow provider tests が通る。 |

## 6. 実装単位

1. docs: 本仕様を GUI-00 の契約として追加する。
2. `workflow-register`: Operation Hub / Run Monitor を追加し、package contribution と Webview model tests を追加する。
3. `bob-bazaar-review`: Wizard v2、Result Capture GUI、Human Triage GUI を追加し、既存 GUI command 互換 test を維持する。
4. `bob-code-consistency-review`: Consistency Wizard、Evidence Picker、Result Capture GUI、Human Triage GUI を追加し、capture / validation / triage tests を追加する。
5. docs: operator guide と sandbox UAT 手順を追加する。
