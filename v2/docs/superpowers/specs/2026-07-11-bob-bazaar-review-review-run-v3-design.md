# bob-bazaar-review Review Run Wizard v3 企画・設計書

- 対象リポジトリ: `katamor1/bob_builtin_analyze`
- 対象拡張: `extensions/bob-bazaar-review`
- 作成日: 2026-07-11
- 状態: Design proposal / 実装前レビュー対象
- 対象ブランチ: `agent/bob-bazaar-review-review-run-v3-plan`
- 実装コード変更: なし

## 1. 目的

`bob-bazaar-review` の既存機能を、個別コマンドや分離したGUIの集合ではなく、1回のBazaarレビューを開始から実績集計まで追跡できる **Review Run** としてつなぐ。

標準利用者が次の流れを、campaign ID、review ID、成果物pathを画面ごとに再入力せず完了できる状態を目標とする。

```text
campaign選択または作成
  -> Bazaar target選択
  -> review packet生成・保存
  -> Bob contextへ追加
  -> review-result検証・保存
  -> Human Triage
  -> record確定
  -> campaign summary更新
```

本企画は、既存のBazaar CLI境界、project rules、result capture、review record、triage、summary、workflow-register連携を置き換えない。既存サービスを共通のrun contextで接続し、GUIを薄いオーケストレーション層として完成させる。

## 2. エグゼクティブサマリー

現在の拡張には、以下の中核機能がすでに存在する。

- revision、revision range、working treeのレビューpacket生成
- project rulesの読み込みとreview-result検証
- JSON、Markdown、artifact metadataの保存
- campaign、record、triage、summaryの管理
- Result Capture GUI
- Human Triage GUI
- workflow-register action provider
- 読み取り専用Bazaar MCP

一方、標準GUIでは各工程が同じReview Runとして結び付いていない。

- Review GUIはResult CaptureとHuman Triageを別画面として開くだけである。
- Result Captureが取得した`reviewId`と成果物pathはHuman Triageへ自動継承されない。
- Human Triageではcampaign ID、review ID、review-result pathを再入力する必要がある。
- review packet、review-result、triage、record、summaryの完了状態を一画面で確認できない。
- record metricsは未指定時にゼロで初期化されるため、実績KPIとしての信頼性が弱い。
- 中断後に「どの工程から再開すべきか」を示すrun単位の状態がない。

そこで、推奨案として **Review Run Wizard v3** を導入する。

Review Run Wizard v3は、画面を巨大な単一Webviewへ統合するものではない。既存のReview GUI、Result Capture GUI、Human Triage GUIを維持し、共通の`ReviewRunContext`と`ReviewRunCoordinator`で接続する。これにより、既存の検証・保存ロジックを再利用しながら、利用者には一気通貫の操作体験を提供する。

## 3. 現状

### 3.1 現行の主要入口

| 領域 | 現在の入口 | 主な実装 |
|---|---|---|
| Review target選択・packet生成 | `bobBazaar.openReviewGui` | `src/ui/reviewGui.ts` |
| Bob出力の検証・保存 | `bobBazaar.openResultCaptureGui` | `src/ui/resultCaptureGui.ts` |
| Human Triage・record・summary | `bobBazaar.openHumanTriageGui` | `src/ui/humanTriageGui.ts` |
| record command | `bobBazaar.records.*` | `src/records/reviewRecordCommands.ts` |
| campaign summary | `generateCampaignSummary()` | `src/records/reviewRecordSummary.ts` |
| packet選択・workflow state | `REVIEW_PACKET_STATE_KEY` | `src/bazaar/reviewPacketSelection.ts` |

### 3.2 既存の良い境界

次の設計は維持する。

- Bazaar CLIは`BazaarClient`経由で実行し、`--no-aliases`を強制する。
- MCPは読み取り専用を既定とし、allowed root内だけを扱う。
- Webview messageはhost側でtypeとactionを検証する。
- result captureは保存前に既存validatorを通す。
- AIのfindingはHuman Triageを経て人間が採否を決める。
- review-resultとreview recordは別成果物として保存する。
- 既存command IDとworkflow action provider IDは変更しない。

### 3.3 解消する利用上の分断

現行フローでは、次の情報が画面間で失われるか、再入力を要求される。

| 情報 | 発生元 | 現在の問題 |
|---|---|---|
| `campaignId` | campaign初期化・選択 | Human Triageで再入力する。 |
| `reviewId` | result capture | 保存成功メッセージには出るが次画面へ渡らない。 |
| review packet path | packet生成 | record作成時に自動で結び付かない経路がある。 |
| review-result JSON/Markdown path | result capture | Human Triage側の初期値へ反映されない。 |
| target revision情報 | Review GUI | record作成時に再構成または既定値へ依存する。 |
| workflow run ID / step ID | workflow連携 | GUI操作後の実績recordへ一貫して残らない。 |
| phaseの開始・終了時刻 | 各工程 | metricsが自動計測されない。 |
| 未完了工程 | 各GUI | 全体の進捗や再開位置を判断できない。 |

## 4. ゴール

### 4.1 機能ゴール

1. Review Run開始時にcampaign、target、review IDを確定する。
2. packet、result、triage、record、summaryを同じReview Runへ自動的に関連付ける。
3. Result Capture完了後、入力済み状態でHuman Triageへ進める。
4. VS Codeを閉じた後もReview Runを再開できる。
5. 各工程の状態、問題、成果物をReview GUIから確認できる。
6. review時間とtriage時間を自動記録し、確定前に補正できる。
7. Human Triageのdecisionに応じた必須入力をGUIとdomain validationの両方で保証する。
8. 既存command、workflow、成果物形式の互換性を維持する。

### 4.2 運用ゴール

- 標準ケースでは、campaign ID、review ID、成果物pathの手入力を不要にする。
- invalidなBob出力は保存せず、修正箇所と再試行導線を示す。
- triage未完了、record未作成、summary未更新を見落とさない。
- 1件のレビューについて「対象、入力、AI出力、人間判断、所要時間」を後から説明できる。
- 将来のCampaign Dashboardへ信頼できる入力データを供給する。

## 5. 非ゴール

初回実装では次を行わない。

- Git対応
- `bob-code-consistency-review`との共通UI統合
- Bobの分析promptやレビュー精度そのものの刷新
- 自動的な採用・棄却判断
- 破壊的なBazaar操作
- 既存review-result schemaの全面変更
- 既存record/triage artifactの置換
- 組織横断ダッシュボードの完成
- 複数reviewerによる同時共同編集

## 6. 検討した選択肢

### 6.1 案A: Review Run Wizard v3

共通のReview Run状態を導入し、既存3画面をcoordinator経由で接続する。

**利点**

- 手入力と取り違えを最も減らせる。
- 中断・再開を設計できる。
- metricsと成果物の関連付けを入口から保証できる。
- 既存domain helperを維持できる。
- Dashboardの前提となるデータ品質を上げられる。

**欠点**

- 永続化schemaと状態遷移の追加が必要。
- 複数画面から同じrunを書き換えるため、更新の直列化が必要。

### 6.2 案B: 分離GUIの引数連携のみ

Result CaptureからHuman Triageへ`reviewId`とpathを渡すなど、小さな連携だけを追加する。

**利点**

- 実装範囲が小さい。
- 早期に再入力を減らせる。

**欠点**

- 全体進捗と再開を解決できない。
- packet、record、summaryまでの一貫性が弱い。
- 後からReview Run状態を導入すると二重改修になりやすい。

### 6.3 案C: Campaign Dashboard先行

summaryと可視化を先に強化する。

**利点**

- パイロット報告に使える画面を早く作れる。

**欠点**

- 現在のゼロ初期値や手入力に依存したデータを可視化しても、KPIの信頼性が低い。
- 入力品質の問題を温存する。

### 6.4 採用判断

**案Aを採用する。**

案BはIteration 1の一部として内包する。案CはReview Runによるデータ品質改善後のIteration 3で実施する。

## 7. UX設計

### 7.1 Review GUIをReview Runのホームにする

既存の`bobBazaar.openReviewGui`を互換入口として維持し、次の領域を追加する。

```text
[Review Run]
  campaign: phase1-bazaar-review-uat-001
  review: bazaar-r125-project-rule-review
  status: Human Triage待ち

[1 Campaign] [2 Target] [3 Packet] [4 Bob Result] [5 Triage] [6 Record] [7 Summary]

現在の工程
  Bob Result: 保存・検証済み
  次の操作: Human Triageを開始

成果物
  review-packet.md          開く
  review-result.json        開く
  review-result.md          開く
  triage.yaml               未作成
  record.yaml               未作成
  summary.md                更新前
```

Review GUIはrunの状態と次の推奨操作を表示する。各工程の詳細操作は既存または専用の画面へ委譲する。

### 7.2 開始方法

Review GUIを開いた際、次を表示する。

- `新しいReview Runを開始`
- `未完了のReview Runを再開`
- `従来モードでpacketだけ作成`

従来モードは後方互換用であり、Review Run artifactを必須にしない。

### 7.3 campaign選択

- workspace内の`.bob-review-records/campaigns/*/campaign.yaml`を候補表示する。
- campaignがない場合は、既存`initReviewRecordCampaign()`を利用して初期化する。
- 直近に使ったcampaignを初期選択するが、開始前に利用者が確認する。
- campaign IDを自由入力させず、既存候補の選択または検証付き新規作成とする。

### 7.4 review ID生成

Review Run開始時にreview IDを確定し、packetとBob出力契約の両方へ使用する。

基本形式:

```text
bazaar-<target-slug>-project-rule-review
```

例:

```text
bazaar-r125-project-rule-review
bazaar-r120-r126-project-rule-review
bazaar-working-r126-project-rule-review
```

同じcampaign内で衝突した場合は`-02`、`-03`を付ける。既存成果物を暗黙に上書きしない。

### 7.5 Result Captureへの引き渡し

Review GUIからResult Captureを開く際、次を自動的に渡す。

- run ID
- campaign ID
- expected review ID
- review-result JSON/Markdownの期待path
- checklist/schema情報
- target情報

保存されたJSON内の`review_id`がexpected review IDと異なる場合は、暗黙に関連付けない。

利用者へ次のどちらかを選ばせる。

1. Bob出力を修正して再検証する。
2. 新しいreview IDとして明示的に取り込む。この場合は新しいReview Runへ分岐する。

### 7.6 Human Triageへの引き渡し

Result Capture成功後は、同じrun contextを使用してHuman Triageを開く。

標準画面では以下を編集不可または選択済みで表示する。

- campaign ID
- review ID
- review-result path
- triage path

pathの手動上書きは「詳細設定」に隔離し、workspace containment validationを必須とする。

### 7.7 triage decisionの入力契約

| decision | 必須入力 |
|---|---|
| `accepted` | `owner`または`action` |
| `rejected` | `reason` |
| `needs_investigation` | `owner`と`action` |
| `deferred` | `reason` |

GUIのdisabled制御だけに依存せず、`validateTriage()`でも同じ契約を検証する。

### 7.8 完了操作

Human Triageがvalidになった後、`Review Runを完了して集計`を表示する。

この操作は次を順番に実行する。

1. triageを再検証する。
2. review-resultとpacketの存在を検証する。
3. metricsを確定する。
4. `record.yaml`を作成・検証する。
5. campaign summaryを再生成する。
6. Review Runを`completed`へ更新する。
7. 成果物一覧とsummaryへのリンクを表示する。

途中で失敗した場合、成功済み工程を巻き戻さず、失敗工程から再試行できる。

## 8. アーキテクチャ

### 8.1 基本方針

- Webviewは入力と表示に限定する。
- 状態遷移、path検証、成果物更新はextension host側で行う。
- 既存command/serviceを直接再利用する。
- Review Run固有ロジックは`src/reviewRuns/`へ隔離する。
- `extension.ts`はcommand登録と依存組み立てに留める。
- 既存public command IDを変更しない。

### 8.2 追加モジュール案

```text
src/
  reviewRuns/
    reviewRunTypes.ts
    reviewRunState.ts
    reviewRunPaths.ts
    reviewRunStore.ts
    reviewRunCoordinator.ts
    reviewRunMetrics.ts
    reviewRunRecovery.ts
  ui/
    reviewGui.ts
    resultCaptureGui.ts
    humanTriageGui.ts
```

| モジュール | 責務 |
|---|---|
| `reviewRunTypes.ts` | 永続化型、phase、artifact ref、validation issue型を定義する。 |
| `reviewRunState.ts` | pureな状態遷移と不変条件を定義する。 |
| `reviewRunPaths.ts` | run artifact pathをworkspace内に解決する。 |
| `reviewRunStore.ts` | atomic read/write、backup、schema version確認を行う。 |
| `reviewRunCoordinator.ts` | 既存packet/capture/triage/record/summary serviceを順番に接続する。 |
| `reviewRunMetrics.ts` | phase timing、手動補正、record metrics変換を行う。 |
| `reviewRunRecovery.ts` | 既存成果物からrun状態を再構成する。 |

### 8.3 永続化先

Review Run状態は既存recordディレクトリに保存する。

```text
.bob-review-records/
  campaigns/
    <campaign_id>/
      records/
        <review_id>/
          review-run.json
          review-packet.md
          triage.yaml
          triage.md
          record.yaml
          metrics.json
          notes.md
```

`review-run.json`は進行中状態のsource of truthである。`record.yaml`は完了または記録可能な段階の監査成果物であり、両者を混同しない。

### 8.4 ReviewRunContext v1

```json
{
  "schema_version": "bazaar-review-run/v1",
  "run_id": "brun-20260711-001",
  "campaign_id": "phase1-bazaar-review-uat-001",
  "review_id": "bazaar-r125-project-rule-review",
  "status": "in_progress",
  "workspace": {
    "repository_root": "C:/repo/trunk"
  },
  "target": {
    "mode": "singleRevision",
    "revision": "125"
  },
  "workflow": {
    "workflow_id": "bazaar-project-rule-review",
    "run_id": "workflow-run-id",
    "step_id": "review-input"
  },
  "phases": {
    "campaign": { "status": "completed" },
    "target": { "status": "completed" },
    "packet": { "status": "completed" },
    "bob_result": { "status": "in_progress" },
    "triage": { "status": "not_started" },
    "record": { "status": "not_started" },
    "summary": { "status": "not_started" }
  },
  "artifacts": {
    "review_packet": ".bob-review-records/campaigns/phase1-bazaar-review-uat-001/records/bazaar-r125-project-rule-review/review-packet.md",
    "review_result_json": ".bob/review/results/bazaar-r125-project-rule-review.json",
    "review_result_markdown": ".bob/review/results/bazaar-r125-project-rule-review.md",
    "triage_yaml": ".bob-review-records/campaigns/phase1-bazaar-review-uat-001/records/bazaar-r125-project-rule-review/triage.yaml",
    "record_yaml": ".bob-review-records/campaigns/phase1-bazaar-review-uat-001/records/bazaar-r125-project-rule-review/record.yaml"
  },
  "metrics": {
    "baseline_review_minutes": null,
    "bob_review_seconds": 0,
    "human_triage_seconds": 0,
    "timing_source": "auto_wall_clock",
    "corrected_by_user": false
  },
  "issues": [],
  "created_at": "2026-07-11T10:00:00+09:00",
  "updated_at": "2026-07-11T10:05:00+09:00"
}
```

### 8.5 phase status

利用可能な状態を固定する。

```ts
type ReviewRunPhaseStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "blocked"
  | "failed"
  | "skipped"
```

不変条件:

- `packet.completed`にはreview packet artifactが必要。
- `bob_result.completed`にはvalidなJSONとMarkdownが必要。
- `triage.completed`にはvalidなtriage artifactが必要。
- `record.completed`にはvalidな`record.yaml`が必要。
- `summary.completed`にはsummary JSON/Markdownの再生成成功が必要。
- Review Run全体の`completed`は、必須phaseがすべて`completed`の場合だけ許可する。

### 8.6 状態更新

同じReview Runを複数panelが更新するため、書き込みはcoordinator内で直列化する。

- run IDごとのin-memory mutexを持つ。
- 更新前に最新の`review-run.json`を読み直す。
- pure reducerで次状態を生成する。
- 一時ファイルへ書き、renameで置換する。
- 既存ファイルがある場合は必要に応じてbackupを残す。
- `updated_at`を更新する。

初回実装では複数プロセス間の同時編集はサポートしない。同じrunを別のVS Code windowで開いた場合は、更新時刻の不一致を検出して再読込を要求する。

## 9. データフロー

### 9.1 新規Review Run

```text
Review GUI
  -> campaign選択
  -> target選択・validate
  -> reviewId生成・衝突確認
  -> ReviewRunCoordinator.start()
  -> review-run.json作成
  -> prepareTarget()
  -> buildReviewPacket()
  -> writeReviewPacketArtifactAtPath()
  -> Bob contextへ追加
  -> packet phase completed
```

### 9.2 Result Capture

```text
Review GUI
  -> Result Captureをrun context付きで開く
  -> captureReviewResult()
  -> schema/checklist validation
  -> JSON/Markdown/metadata保存
  -> expected reviewId確認
  -> run artifacts更新
  -> bob_result phase completed
  -> Human Triageへ進む
```

### 9.3 Human Triageと完了

```text
Human Triage GUI
  -> run contextからcampaign/review/path読込
  -> createTriageDraft()
  -> decision編集
  -> validateTriage()
  -> writeTriage()
  -> triage phase completed
  -> finalizeReviewRun()
       -> createReviewRecord()
       -> validateReviewRecord()
       -> generateReviewCampaignSummary()
       -> review-run completed
```

## 10. metrics設計

### 10.1 指標の意味

| 指標 | 意味 |
|---|---|
| `baseline_review_minutes` | 同等変更を従来手順でレビューする想定時間。利用者入力。 |
| `bob_review_minutes` | packetをBobへ追加してからvalid result保存までの経過時間。 |
| `human_triage_minutes` | triage開始からvalid保存までの経過時間。 |
| `estimated_minutes_saved` | baseline - Bob review - Human Triage。summaryで算出。 |

### 10.2 自動計測

- phase開始時に開始時刻を保存する。
- phase完了時に経過秒を加算する。
- VS Code再起動をまたいだ時間は自動計測に含めるが、確定前に補正可能とする。
- 自動値を補正した場合は`corrected_by_user: true`を残す。
- 負数、NaN、過大値は拒否する。
- baseline未入力は完了を妨げないが、campaign policyで必須の場合はwarningまたはblockにする。

### 10.3 recordへの変換

既存`ReviewRecord.metrics`へ分単位で渡す。秒から分への変換は小数第1位までとし、内部run artifactでは秒を保持する。

## 11. エラー処理・リカバリ

### 11.1 原則

- 成功済みartifactを削除または巻き戻さない。
- phase単位で失敗を記録する。
- 再試行可能な操作を明示する。
- pathやreview IDの不一致を暗黙に修正しない。
- invalid resultは正式artifactとして保存しない。

### 11.2 代表ケース

| ケース | 振る舞い |
|---|---|
| Bazaar target取得失敗 | `target.failed`。CLI errorを表示し、target再入力を許可する。 |
| Bob extension未導入 | packet生成と保存は完了。Bob投入は`blocked`または`skipped`として手動導線を表示する。 |
| result JSON invalid | `bob_result.blocked`。issue pathを表示し、同じrunで再Captureできる。 |
| review ID不一致 | 保存を停止し、修正または新規run分岐を選ばせる。 |
| triage必須項目不足 | 保存不可。finding行ごとに不足を表示する。 |
| record作成失敗 | triageまでは保持し、`record.failed`から再試行する。 |
| summary生成失敗 | recordは保持し、`summary.failed`から再試行する。 |
| review-run.json破損 |既存packet/result/triage/recordからrecovery previewを作り、利用者承認後に再構成する。 |
| 既存artifact衝突 | 自動上書きせず、新しいreview ID候補を提示する。 |

### 11.3 legacy成果物からの復旧

`review-run.json`が存在しない既存reviewについて、次の成果物からrun contextを再構成できるようにする。

- `.bob/review/results/<review_id>.json`
- `.bob/review/results/<review_id>.md`
- `.bob-review-records/campaigns/*/records/<review_id>/review-packet.md`
- `triage.yaml`
- `record.yaml`

復旧は推測結果を画面表示し、利用者確認後にのみ`review-run.json`を作成する。

## 12. セキュリティ・プライバシー

- すべてのartifact pathをworkspace containment resolverで検証する。
- symlink escapeを拒否する。
- Webviewから任意command IDを受け取らない。
- run contextにBobの生チャット全文を保存しない。
- packet本文は既存`review-packet.md`にのみ保存する。
- workflow stateへ絶対pathを送る場合もrun ID一致を検証する。
- Bazaar操作は引き続き読み取り専用とし、`--no-aliases`を必須にする。
- Review Run導入を理由にMCP write toolを既定有効化しない。
- artifact共有時の機密情報確認方針は既存運用を維持する。

## 13. 互換性

### 13.1 維持するcommand

少なくとも次を変更しない。

- `bobBazaar.openReviewGui`
- `bobBazaar.openResultCaptureGui`
- `bobBazaar.openHumanTriageGui`
- `bobBazaar.captureReviewResult`
- `bobBazaar.records.initCampaign`
- `bobBazaar.records.createRecord`
- `bobBazaar.records.validateRecord`
- `bobBazaar.records.createTriage`
- `bobBazaar.records.validateTriage`
- `bobBazaar.records.generateSummary`

既存commandは引数なしでも従来動作を継続する。Review Runから呼ぶ場合だけ、optionalなrun context引数を渡す。

### 13.2 workflow互換

- `bazaar-project-rule-review`のprovider IDを変更しない。
- `REVIEW_PACKET_STATE_KEY`を維持する。
- workflow run IDとstep IDがある場合はReview Runへ記録する。
- workflowなしの直接レビューもサポートする。

### 13.3 artifact互換

- 既存review-result JSON/Markdownを変更しない。
- 既存`record.yaml`、`triage.yaml`、summary JSON/Markdownの位置を変更しない。
- 新規追加は`review-run.json`のみとする。
- `review-run.json`を知らない旧バージョンでも、既存成果物は引き続き読める。

## 14. テスト戦略

### 14.1 unit test

`reviewRunState.test.js`

- 正常なphase遷移
- 必須artifactなしのcompleted拒否
- completedから不正な後退を拒否
- failed/blockedからの再試行
- run全体completed条件

`reviewRunPaths.test.js`

- campaign/review ID validation
- workspace escape拒否
- symlink escape拒否
- Windows予約名、末尾dot/space
- 衝突時のreview ID suffix生成

`reviewRunStore.test.js`

- create/read/update
- atomic replacement
- schema version不一致
- malformed JSON
- stale update検出

`reviewRunMetrics.test.js`

- phase秒数の加算
- 分への変換
- user correction
- negative/NaN/過大値拒否

`reviewRunRecovery.test.js`

- resultのみ存在
- resultとtriage存在
- recordまで存在
- artifact間のreview ID不一致
- campaign候補が複数ある場合

### 14.2 GUI contract test

- Result Captureへrun contextが渡る。
- capture成功後にHuman Triageが同じrunで開く。
- campaign/review/pathを標準画面で再入力しない。
- decision別必須入力が不足すると保存不可になる。
- Webview action allowlistを維持する。
- inline handlerを追加しない。
- CSP nonceを維持する。

### 14.3 integration test

代表round trip:

```text
start run
  -> packet保存
  -> valid result capture
  -> triage draft
  -> decision保存
  -> record作成
  -> summary生成
  -> completed
```

異常系round trip:

- invalid resultから修正して再Capture
- triage validation failureから修正
- record失敗後の再試行
- VS Code再起動相当のstore再読込から再開
- legacy artifactから復旧

### 14.4 regression gate

既存gateを維持する。

```powershell
cd extensions\bob-bazaar-review
npm.cmd test
npm.cmd run architecture:policy
npm.cmd run source:policy
npm.cmd run unused:policy
npm.cmd run artifact:policy
npm.cmd run audit:prod
npm.cmd run package
npm.cmd run package:policy
npm.cmd run package:metrics
```

新規runtime dependencyは原則追加しない。

## 15. UAT

### UAT-01 標準single revision

1. campaignを選択する。
2. revisionを指定する。
3. packetを作成しBobへ追加する。
4. valid resultをCaptureする。
5. findingをtriageする。
6. Review Runを完了する。

合格条件:

- campaign ID、review ID、artifact pathを再入力しない。
- packet/result/triage/record/summaryが同じreview IDで結び付く。
- Review Runが`completed`になる。

### UAT-02 invalid resultの修正

合格条件:

- invalid JSONは保存されない。
- issue pathが表示される。
-同じrunで再Captureできる。
- target収集とpacket生成をやり直さない。

### UAT-03 中断・再開

合格条件:

- result capture前にVS Codeを閉じても再開候補に出る。
- 再開時にcurrent phaseと成果物が一致する。
- 完了済みphaseを再実行しなくてよい。

### UAT-04 decision validation

合格条件:

- `rejected`でreasonなしは保存できない。
- `needs_investigation`でowner/action不足は保存できない。
- 修正後はtriage保存とrecord確定へ進める。

### UAT-05 legacy reviewの復旧

合格条件:

- `review-run.json`がなくても既存artifactを検出できる。
- 推測内容を確認後にrun contextを生成できる。
- 既存artifactを変更せず再利用する。

## 16. 段階導入

### Iteration 1: Contextと画面間handoff

範囲:

- `ReviewRunContext v1`
- store/path/state reducer
- campaign選択
- review ID生成
- packetの自動保存
- Result Captureへのcontext引き渡し
- Capture成功後のHuman Triage自動引き渡し
- 標準フローからcampaign/review/path再入力を除去

完了条件:

- 標準single revisionでpacketからtriage draftまで一貫して進める。
- 既存command互換testが通る。

### Iteration 2: 再開・finalize・metrics

範囲:

- 未完了run一覧
- 再開位置判定
- phase status表示
- decision別validation
- record/summaryの一括finalize
- timing収集と手動補正
- legacy recovery

完了条件:

- 中断後に再開できる。
- valid triageからrecord/summaryまで一操作で完了できる。
- metricsがゼロ既定値だけに依存しない。

### Iteration 3: Campaign Dashboard

範囲:

- Review Run一覧
- triage未完了一覧
- schema validation成功率
- finding採用率・棄却率
- rule別の検出・採用傾向
- change type別傾向
- review時間、triage時間、推定削減時間
- Markdown/JSON/CSV export

前提:

- Iteration 1と2でrun artifactとmetricsのデータ品質が確保されていること。

## 17. 受入条件

本企画の実装完了条件を次とする。

1. 標準Review Runでcampaign ID、review ID、artifact pathを再入力しない。
2. packet、result、triage、record、summaryが同じReview Runへ結び付く。
3. invalid resultは保存されない。
4. decision別必須項目がdomain validationで保証される。
5. 中断したrunをVS Code再起動後に再開できる。
6. 完了済みphaseと次の推奨操作がGUIに表示される。
7. review時間とtriage時間が自動記録され、利用者が確定前に補正できる。
8. legacy artifactを壊さず復旧できる。
9. 既存command ID、workflow provider ID、artifact pathが維持される。
10. `npm test`、architecture/source/unused/artifact/package policyが通る。
11. VSIX size budgetを超えない。
12. 新規runtime dependencyを追加しない。

## 18. 想定変更ファイル

実装時の主な変更候補:

```text
extensions/bob-bazaar-review/
  package.json
  src/extension.ts
  src/reviewRuns/reviewRunTypes.ts
  src/reviewRuns/reviewRunState.ts
  src/reviewRuns/reviewRunPaths.ts
  src/reviewRuns/reviewRunStore.ts
  src/reviewRuns/reviewRunCoordinator.ts
  src/reviewRuns/reviewRunMetrics.ts
  src/reviewRuns/reviewRunRecovery.ts
  src/ui/reviewGui.ts
  src/ui/reviewGuiHtmlAssets.ts
  src/ui/resultCaptureGui.ts
  src/ui/resultCaptureGuiHtml.ts
  src/ui/humanTriageGui.ts
  src/ui/humanTriageGuiHtml.ts
  src/records/reviewTriage.ts
  src/records/reviewRecordCommands.ts
  docs/basic-design-ja.md
  docs/detailed-design-ja.md
  docs/unit-test-spec-ja.md
  docs/real-machine-test-spec-ja.md
  README.md
  test/reviewRunState.test.js
  test/reviewRunPaths.test.js
  test/reviewRunStore.test.js
  test/reviewRunMetrics.test.js
  test/reviewRunRecovery.test.js
  test/guiFirstSurfaces.test.js
```

`package.json`は、新しい公開commandを追加する必要が生じた場合だけ変更する。基本設計では既存`bobBazaar.openReviewGui`をReview Runホームとして再利用するため、新commandは必須ではない。

## 19. 実装上の判断記録

| 項目 | 決定 |
|---|---|
| UI構成 | 1枚の巨大Webviewへ統合せず、既存画面をcoordinatorで接続する。 |
| run state保存先 | record directory内の`review-run.json`。 |
| review ID | targetから開始時に生成し、Bob出力にも同じIDを要求する。 |
| 衝突 | 自動上書きせずsuffix付きIDを生成する。 |
| result ID不一致 | 暗黙補正せず、修正または新規run分岐を要求する。 |
| metrics | 自動経過時間を記録し、確定前の補正を許可する。 |
| legacy対応 | 既存artifactから確認付きでrun contextを復旧する。 |
| Dashboard | Review Runのデータ品質改善後に実施する。 |
| 互換性 | 既存command、provider、主要artifactを維持する。 |
| AI判断 | Human Triageを必須の人間ゲートとして維持する。 |

## 20. セルフレビュー結果

- `TBD`、`TODO`、未決定placeholderは残していない。
- Review Runと既存review recordの責務を分離した。
- UI統合と実装モジュール統合を混同せず、画面は分割したまま状態だけを共有する設計にした。
- Iteration 1だけでも利用上の再入力問題を解消できるスコープにした。
- Iteration 2で再開・metrics・finalizeを追加し、Iteration 3のDashboard前提を整える順序にした。
- Git対応、他拡張との共通UI、Bob分析品質変更は非ゴールとして明示した。
- 既存セキュリティ境界、human gate、artifact互換性を維持した。
