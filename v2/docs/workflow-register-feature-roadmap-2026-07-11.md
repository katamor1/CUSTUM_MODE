# workflow-register 機能追加・改善ロードマップ

- 作成日: 2026-07-11
- 対象: `extensions/workflow-register`
- ステータス: 企画案
- 対象リポジトリ: `katamor1/bob_builtin_analyze`

## 1. エグゼクティブサマリー

`workflow-register` の次の開発段階では、機能をさらに横へ広げるよりも、まず **「安心して止められる・戻せる・更新できる」ワークフロー基盤として完成度を上げる**ことを優先する。

現在の `workflow-register` は、`.bob/workflows/*/WORKFLOW.md` の登録と検証だけでなく、次の機能を持つ。

- GUI Builder
- Template Customization Studio
- AI による新規設計、改善、診断説明
- `command` / `agent` / `manual` / `result` step の実行
- step review、retry、resume
- pause / resume と run control
- branching、loop checkpoint
- Operation Hub、Runs View、Status Bar
- task snapshot と result handoff 救済
- artifact manifest と成果物からの途中再開
- 他拡張からの action provider / agent provider / result sink 登録

このため、実態は「ワークフロー登録拡張」を超え、ローカルワークスペース上のワークフロー実行プラットフォームになっている。

一方で、2026-07-11 時点の [PR #68](https://github.com/katamor1/bob_builtin_analyze/pull/68) は、provider lifecycle、workflow contract、Windows / Extension Host 品質ゲートなどを3拡張横断で強化する大規模な draft PR であり、最新 head の全体 CI と実 IBM Bob / Bazaar / multi-root 検証は未完了である。

したがって、推奨する実施順は次のとおりとする。

1. 配布・永続データの安全性を閉じる。
2. 復旧機能を、利用者が迷わない UX にする。
3. 長時間・無人実行を自動制御する。
4. 機能増加に耐える構造へ整理する。

## 2. 現状認識

### 2.1 既に強い領域

- workflow parser / validator / runtime の単体テスト範囲が広い。
- run state、run control、task snapshot をファイルへ永続化している。
- file sink や workspace path の境界検査がある。
- provider / command guardrail、Workspace Trust、schema policy、package policy が整備されている。
- Operation Hub、Runs View、Status Bar、Manual Step Panel により、Command Palette だけに依存しない操作経路がある。
- artifact manifest、state hydration、start-from-artifacts により、途中再開の基盤がある。

### 2.2 残る主要リスク

- PR #68 の実機・CIゲートが閉じておらず、新規大規模機能を安全に積む基準点がまだ確定していない。
- stacked PR と main の取り込み状況が、GitHub 上の open / closed 表示だけでは判断しづらい。
- `run.json` 自身の schema version と migration chain がない。
- task snapshot から artifact を復元する際、適用前に差分を確認する UX がない。
- `held` だが Bob task handle を失った run の復旧導線が弱い。
- pause / resume は実装済みだが、業務終了時刻、最大 run 時間、最大 agent step 数などの自動 pause が未実装である。
- run directory 全体の保存期間、容量、cleanup policy がない。
- `WorkflowEngine`、command service、composition root、Webview panel に機能が集中しやすい。

### 2.3 企画上の前提

- `run.json` を実行状態の正本とする。
- Bob Todo / visible step は正本ではなく projection として扱う。
- 実行中 AI / command の強制停止は、provider 契約が明示的に対応するまで標準機能にしない。
- 既存 workflow との後方互換性を維持する。
- schema / parser / validator / Builder / runtime の変更を、単一巨大 PR にまとめない。
- 永続形式を変更する機能は、migration と historical fixture test を必須にする。

## 3. アプローチ比較

| アプローチ | 内容 | 長所 | 弱点 | 判定 |
| --- | --- | --- | --- | --- |
| 機能先行 | Skip Resume Phase 6 や新 step 種別をすぐ追加する | 見た目の進化が速い | PR #68 と競合し、永続データ・構造課題を先送りする | 非推奨 |
| 信頼性先行 | #68 完了、run migration、復旧 UX、自動 pause の順に進める | 既存機能の価値を最大化し、事故を減らせる | 派手さは控えめ | 推奨 |
| 再設計先行 | process / template を別拡張へ分離し全面整理する | 長期的な構造は明確になる | 利用者価値まで遠く、現段階では過剰 | 将来検討 |

## 4. 推奨ロードマップ

## Milestone 0 — `workflow-register/v0.2.0-stabilize`

### P0-1. Stabilization と実環境リリースゲートを閉じる

**Issue title**

```text
[workflow-register][P0] Close the stabilization and real-environment release gates
```

#### 目的

PR #68 で追加された品質ゲートを実際に完走させ、以後の機能追加の基準点を作る。

#### スコープ

- Ubuntu / Windows の品質ジョブ
- VS Code Extension Host activation smoke
- provider-aware workflow contract test
- IBM Bob 上の provider 再登録、step review、result handoff、Webview
- 実 Bazaar 環境での timeout / cancel 後の子 process 非残留確認
- multi-root での Bob root と VCS root の分離確認
- release evidence の更新
- 一時的な diagnostic workflow の削除

#### 受け入れ条件

- PR #68 の必須ジョブが最新 head で green になる。
- 実機試験結果が release evidence に記録される。
- PR #68 を draft 解除できる状態になる。
- 以後の PR が PR #68 の branch へ stack されていない。

### P0-2. Merged / stacked PR の状態を正規化する

**Issue title**

```text
[workflow-register][P0] Normalize merged and stacked pull-request status
```

#### 目的

Skip Resume Phase 2〜5、Todo sync、関連機能について、実装履歴と GitHub 上の open PR 表示を一致させる。

#### スコープ

- 各 PR head が main へ取り込まれているかを commit 単位で確認する。
- 取り込み済み PR は、根拠をコメントして close する。
- 未取り込み差分だけがある場合は、最新 main 基準の小さな PR へ再構成する。
- stacked PR の base を main へ変更するか、後継 Issue へ移管する。
- PR 本文の「未実装」記述を現行 main に同期する。

#### 受け入れ条件

- open PR だけを見て未実装機能を正しく判断できる。
- roadmap が stacked PR の順序に依存しない。
- 各未完機能に対応する Issue または milestone が存在する。

## Milestone 1 — `workflow-register/v0.3.0-recovery-ux`

### P1-1. Workflow Builder に Skip Resume Readiness セットアップを追加する

**Issue title**

```text
[workflow-register][P1] Add Skip Resume Readiness setup to Workflow Builder
```

#### ユーザーストーリー

ワークフロー設計者として、`resultKey`、artifact、`producedBy`、run ごとの保存先を手書きせず、安全な途中再開対応 workflow を作りたい。

#### UI 案

Builder の Artifacts タブに、次の操作を追加する。

- `途中再開に対応する`
- 各 step の再利用対象出力を選ぶ。
- artifact ID、schema、保存先を preview する。
- `x-skipResume.fileBound: true` を設定する。
- 必要な artifact 定義を生成する。
- 既存定義との衝突や、再利用できない step を警告する。

#### 自動生成例

```yaml
x-skipResume:
  fileBound: true

artifacts:
  - id: collectedContext
    producedBy: collect-context
    path: .bob/workflows/runs/{{run.id}}/artifacts/collect-context/collectedContext.md
    schema: text/markdown
```

#### 制約

- 既存 artifact を無断で上書きしない。
- 生成前に diff を表示する。
- `resultKey` がない agent step は自動生成せず、修正候補として提示する。
- opt-in 方式を維持し、既存 workflow の strict validation を壊さない。

#### 受け入れ条件

- Builder だけで file-bound workflow を構成できる。
- 保存後に strict validation が通る。
- YAML 手編集と GUI round-trip で定義が消えない。
- 生成前後の diff test がある。

### P1-2. Task Snapshot Import の preview と選択適用を追加する

**Issue title**

```text
[workflow-register][P1] Add preview and selective apply for task-snapshot artifact import
```

#### 目的

Task snapshot から artifact を生成する前に、利用者が抽出元、生成先、既存ファイルとの差分を確認できるようにする。

#### 表示内容

- 対象 run、workflow、step
- snapshot 日時と reason
- 抽出元: `lastAssistantText` または `taskExport`
- 生成予定 artifact の path、schema、byte 数
- 既存ファイルとの差分
- checksum
- truncation / redaction の可能性
- artifact ごとの選択チェック

#### 安全方針

- 初期表示は preview のみとする。
- truncated snapshot は既定で選択解除する。
- 既存ファイルがある場合は diff 確認を必須にする。
- import 後は task snapshot ではなく artifact manifest を正本とする。
- import provenance を Operation Hub で確認できるようにする。
- 複数 artifact の書き込みと manifest 更新を transaction 相当の単位で扱う。

#### 受け入れ条件

- apply 前に対象 artifact と差分を必ず確認できる。
- 個別 artifact を除外できる。
- 途中失敗時に manifest とファイルが部分適用状態にならない。
- preview と apply が同じ検証ロジックを使う。

### P1-3. Reused / Skipped 状態を一貫表示する

**Issue title**

```text
[workflow-register][P1] Surface reused and skipped workflow steps consistently
```

#### 対象画面

- Operation Hub
- Bob Workflow Runs
- run diagnostics
- Bob chat の control / progress message
- Bob Todo 表示が利用可能な場合の projection

#### 表示例

- `Reused from run: <runId>`
- `Skipped by artifact reuse`
- `Artifact verified`
- `Hydrated state keys: 3`
- `Definition mismatch allowed by user`
- `Imported from task snapshot`

#### 設計方針

- `run.json` を正本とする。
- Bob Todo の同期状態を workflow 完了状態と混同しない。
- reuse 元 run、artifact manifest、hydrate された state key を辿れるようにする。
- 通常 completed と reused completed を視覚的に区別する。

#### 受け入れ条件

- 再利用された前段 step が通常完了と見分けられる。
- source run、artifact、state key まで追跡できる。
- Bob Todo 同期に失敗しても Operation Hub が誤って `synced` と表示しない。
- standalone 実行でも同じ provenance を確認できる。

### P1-4. Detached Held Run の復旧アシスタントを追加する

**Issue title**

```text
[workflow-register][P1] Add recovery actions for detached held runs
```

#### 目的

`run.json` は `held` だが、VS Code 再起動などで Bob task の active handle が失われた run に対し、状態に応じた安全な復旧導線を提示する。

#### 状態分類

- **Connected held**: active handle があり、通常の manual completion が可能。
- **Detached held / resumable**: handle はないが run state から再開可能。
- **Detached held / artifact recoverable**: snapshot または artifact から復旧可能。
- **Blocked**: definition mismatch、必須 state 不足などで自動復旧不可。

#### 主アクション

状態ごとに primary action を1つだけ提示する。

- `手動ステップを完了`
- `保存済み状態から再開`
- `成果物を確認して途中再開`
- `診断を開く`

#### 受け入れ条件

- held run を開いた利用者が、次に押すべきボタンを判断できる。
- Bob task handle がないのに完了済みと誤表示しない。
- `run.json` の手動編集なしで復旧できる。
- 復旧経路を run provenance へ記録する。

## Milestone 2 — `workflow-register/v0.4.0-runtime-guardrails`

### P1-5. 決定的な自動 Pause 制限を追加する

**Issue title**

```text
[workflow-register][P1] Add deterministic automatic pause limits
```

#### 初期スコープ

初回は provider 情報に依存する token / cost 見積もりを含めず、次の3項目に限定する。

```yaml
runControl:
  limits:
    maxRunMinutes: 45
    maxAgentStepsPerRun: 6
    pauseAtLocalTime: "18:00"
    timezone: "Asia/Tokyo"
```

#### 優先順位

workflow 側と workspace setting 側の両方に値がある場合は、より厳しい値を採用する。

#### 動作

- 現在実行中の agent / command は強制停止しない。
- 次の step または次の AI 呼び出し前で pause する。
- pause reason、limit、observed value を構造化して保存する。
- 再開時に同じ制限へ即座に再ヒットする場合は、期限付き override を選べる。
- override の操作者、理由、有効期限を記録する。

#### 非対象

- cooperative interrupt
- provider cancellation token
- hard cancel
- command process kill
- estimated token / cost budget

#### 受け入れ条件

- 3種類の制限が次 step 開始前に発火する。
- clock 注入による決定的な単体テストがある。
- timezone 不正値を validation error とする。
- pause 原因、制限値、実測値が diagnostics に表示される。
- 標準動作では強制 cancel を行わない。

### P1-6. Run 保存期間・容量・プライバシー管理を追加する

**Issue title**

```text
[workflow-register][P1] Add workflow run retention and cleanup controls
```

#### 設定案

```json
{
  "workflowRegister.runs.retention.enabled": false,
  "workflowRegister.runs.retention.completedDays": 30,
  "workflowRegister.runs.retention.maxCompletedRuns": 100,
  "workflowRegister.runs.retention.maxTotalBytes": 524288000
}
```

#### コマンド案

- `Bob Workflow: Run保存容量を確認`
- `Bob Workflow: Run整理をプレビュー`
- `Bob Workflow: 選択したRunを削除`
- `Bob Workflow: 完了Runを整理`

#### 自動削除禁止対象

- `running`
- `paused`
- `checkpoint`
- `reviewing`
- `held`
- artifact reuse の source として参照中の run
- user が pin した run

#### 受け入れ条件

- cleanup 前に件数、容量、対象一覧を表示する。
- preview と実削除の対象が一致する。
- recoverable run を自動削除しない。
- symlink / workspace 外 path を拒否する。
- manifest や reuse provenance の参照関係を考慮する。
- 初期値は自動削除無効とする。

## Milestone 3 — `workflow-register/v0.5.0-platform-hardening`

### P0-3. Run State を versioning し、安全な migration を追加する

**Issue title**

```text
[workflow-register][P0] Version workflow run state and add safe migrations
```

#### 背景

`run.json` は `workflowSchemaVersion` や `engineVersion` を保持するが、run ファイル自身の schema version と migration chain を持たない。機能増加に伴い、古い run を新しい拡張が読み書きする互換性リスクが高まっている。

#### 形式案

```json
{
  "schemaVersion": "workflow-register/run-state/v1",
  "runId": "...",
  "workflowId": "...",
  "status": "paused"
}
```

#### 必要コンポーネント

- `decodeRunState(unknown)`
- `migrateRunStateV0ToV1()`
- migration chain
- migration 前 backup
- unknown newer version の read-only 扱い
- diagnostics 用 migration report
- historical fixture tests

#### 安全方針

- 読めない run を空の run として扱わない。
- newer version を古い拡張が上書きしない。
- migration は idempotent にする。
- migration 中に失敗した場合は元ファイルを維持する。
- `run.json`、`control.json`、task snapshot、artifact manifest の互換性表を文書化する。

#### 受け入れ条件

- 過去 fixture を最新形式へ lossless migration できる。
- unknown newer version は編集・上書きされない。
- 壊れた run は diagnostics へ隔離され、一覧全体を壊さない。
- migration 前後の backup / restore test がある。

### P2-1. 副作用のない実行計画 / Dry Run を追加する

**Issue title**

```text
[workflow-register][P2] Add a side-effect-free workflow execution plan
```

#### 目的

実行前に、解決済み input、呼び出す provider / command、読み書き path、approval、artifact、pause 制限を確認できるようにする。

#### 表示内容

- 解決済み inputs
- 実行予定 step
- provider / VS Code command ID
- preflight
- approval gate
- 読み書き予定 path
- 生成予定 artifact
- 参照する state key
- 分岐候補
- pause 制限
- 未登録 provider / 不明な sink
- Workspace Trust 状態

#### Dry Run で実行しないこと

- provider 実行
- AI 呼び出し
- VS Code command 実行
- ファイル書き込み
- run 作成
- Bob Todo 更新

#### 受け入れ条件

- 実行と同じ resolver / validator を再利用する。
- Dry Run と実実行の解決結果が一致する contract test がある。
- Operation Hub と Builder から起動できる。
- Markdown / JSON で export できる。
- side effect がないことをテストで保証する。

### P1-7. 構造ガードレールを追加する

**Issue title**

```text
[workflow-register][P1] Add layer policy and bounded orchestration controllers
```

#### 今回のスコープ

- import direction の layer policy
- `core` から `commands` / `webview` への依存禁止
- engine の review / branch / artifact completion 境界の固定
- Webview message の discriminated union 化
- message handling の pure function と VS Code adapter への分離
- 最大ファイル行数 top 10 と test/source LOC ratio の CI summary 出力
- 新規 internal import で direct type module を利用する方針の文書化

#### 今回の非対象

- process / template の別 extension 化
- 全モジュールの一括移動
- public API の全面的な破壊的変更

#### 受け入れ条件

- 不正な layer import を CI で検出する。
- `WorkflowEngine` へ新機能を追加する際の拡張ポイントが文書化される。
- Webview message router を Node test で検証できる。
- 大規模なディレクトリ再編を伴わない。

## 5. GitHub 運用案

### 5.1 Milestones

| Milestone | 主な内容 |
| --- | --- |
| `workflow-register/v0.2.0-stabilize` | PR #68、実機ゲート、PR状態整理 |
| `workflow-register/v0.3.0-recovery-ux` | Builder readiness、snapshot preview、reused表示、detached held recovery |
| `workflow-register/v0.4.0-runtime-guardrails` | 自動 pause、run retention |
| `workflow-register/v0.5.0-platform-hardening` | run migration、dry run、layer policy |

### 5.2 Labels

```text
area/workflow-register
priority/P0
priority/P1
priority/P2
type/feature
type/ux
type/runtime
type/architecture
type/operations
epic/recovery
epic/runtime-safety
epic/persistence
blocked-by/pr-68
needs-real-environment
```

### 5.3 PR 分割ルール

- 1 PR につき1つのユーザー行動、または1つの永続契約を扱う。
- schema / parser / validator / Builder / engine を一括で巨大変更しない。
- 実装 PR には、失敗する回帰テスト、設計文書更新、migration / backward compatibility 判断を含める。
- PR #68 が閉じるまで、engine / provider API を変更する大規模機能 PR は原則起こさない。
- UI は core contract を先に作り、その上に薄く載せる。
- 永続形式を変更する PR は historical fixture を追加する。
- 実機依存の機能には `needs-real-environment` label と release evidence 更新を必須にする。

## 6. 成功指標

| 領域 | 指標 |
| --- | --- |
| 復旧 | failed / held / paused 状態ごとに Operation Hub が primary action を1つ提示する |
| 途中再開 | `run.json` の手編集なしで artifact または snapshot から安全に再開できる |
| 自動停止 | 時間、step数、時刻制限が次の AI / step 開始前に発火する |
| 永続互換 | historical run fixture を最新形式へ lossless migration できる |
| 安全な整理 | active / recoverable / 参照中 run を cleanup が削除しない |
| 配布品質 | Ubuntu / Windows / Extension Host / IBM Bob の release gate を通過する |
| 保守性 | layer 違反と Webview message contract 崩れを CI で検知できる |

## 7. 最初に起票する順番

最初の4件は次の順序で進める。

1. `[P0] Close the stabilization and real-environment release gates`
2. `[P0] Normalize merged and stacked pull-request status`
3. `[P0] Version workflow run state and add safe migrations`
4. `[P1] Add Skip Resume Readiness setup to Workflow Builder`

この順序により、PR #68 の未完ゲートを邪魔せず、永続互換の土台を固めた直後に、利用者が価値を実感しやすい Recovery UX へ進められる。

## 8. 関連資料

- [`extensions/workflow-register/README.md`](../extensions/workflow-register/README.md)
- [`extensions/workflow-register/docs/basic-design-ja.md`](../extensions/workflow-register/docs/basic-design-ja.md)
- [`extensions/workflow-register/docs/detailed-design-ja.md`](../extensions/workflow-register/docs/detailed-design-ja.md)
- [`extensions/workflow-register/docs/workflow-skip-resume-plan-ja.md`](../extensions/workflow-register/docs/workflow-skip-resume-plan-ja.md)
- [`extensions/workflow-register/docs/workflow-pause-resume-plan-ja.md`](../extensions/workflow-register/docs/workflow-pause-resume-plan-ja.md)
- [`extensions/workflow-register/docs/workflow-pause-resume-phase235-status-ja.md`](../extensions/workflow-register/docs/workflow-pause-resume-phase235-status-ja.md)
- [`docs/workflow-register-size-architecture-review-2026-07-05-350010e7.md`](workflow-register-size-architecture-review-2026-07-05-350010e7.md)
- [`docs/review-findings-tracking-2026-07-05.md`](review-findings-tracking-2026-07-05.md)
- [PR #68: Harden three extension contracts, process boundaries, and release gates](https://github.com/katamor1/bob_builtin_analyze/pull/68)
