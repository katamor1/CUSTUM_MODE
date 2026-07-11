# workflow-register 実機テスト仕様書

## 1. 目的

本書は `extensions/workflow-register` の実機テスト仕様を定義する。単体テストでは mock 化する VS Code Extension Host、IBM Bob 拡張、Bob Workflow UI、Bob task、Webview、Explorer view、Status Bar、multi-root workspace、実ファイル I/O を含めて確認する。

## 2. テスト対象

| 区分 | 対象 |
| --- | --- |
| VS Code 拡張 | `workflow-register` |
| Bob 連携 | `IBM.bob-code` 拡張の workflow source / workflow step / task API 連携 |
| Workflow 定義 | `.bob/workflows/*/WORKFLOW.md` |
| 実行状態 | `.bob/workflows/runs/<runId>/run.json` |
| Run Control | `.bob/workflows/runs/<runId>/control.json` |
| Task Snapshot | `.bob/workflows/runs/<runId>/task-snapshots/*.json`, `latest.json` |
| GUI | Workflow Builder Webview、Explorer view `workflowRegister.runs`、Status Bar |
| Diagnostics | VS Code Diagnostics、Markdown report |

## 3. 前提環境

| 項目 | 条件 |
| --- | --- |
| OS | Windows 11 を主対象。可能であれば macOS / Linux でも代表ケースを確認する。 |
| VS Code / Bob IDE | `package.json` の `engines.vscode` を満たすバージョン。 |
| IBM Bob 拡張 | `IBM.bob-code` が導入済みで、有効化できること。 |
| Node.js / npm | extension build / test が可能なバージョン。 |
| workflow-register | ローカル VSIX または Extension Development Host で導入する。 |
| workspace | `.bob/workflows` を持つテスト用 workspace。 |

## 4. 事前準備

### 4.1 拡張機能ビルド

```powershell
cd extensions\workflow-register
npm install
npm run compile
```

必要に応じて VSIX を作成する。

```powershell
npm run package
```

### 4.2 テスト workspace

テスト用 workspace に次の構成を作成する。

```text
<workspace>/
  .bob/
    workflows/
      smoke-command/
        WORKFLOW.md
      smoke-agent-result/
        WORKFLOW.md
      smoke-manual/
        WORKFLOW.md
      smoke-step-review/
        WORKFLOW.md
      smoke-pause/
        WORKFLOW.md
      smoke-invalid/
        WORKFLOW.md
  docs/
    sample.md
```

### 4.3 テスト用 workflow 例

#### command workflow

```markdown
---
schemaVersion: workflow-register/v1
name: smoke-command
title: Smoke Command
description: 実機テスト用 command workflow
stepExecution:
  mode: engineSteps
steps:
  - id: echo
    title: Echo
    type: command
    action: workflowRegister.test.echo
    args:
      message: hello
    resultKey: echoResult
---
Command smoke test.
```

この workflow では、テスト用 action provider が必要である。実機では `bob-code-consistency-review` など既存 provider を使うか、開発用 test provider を一時的に登録する。

#### manual workflow

```markdown
---
schemaVersion: workflow-register/v1
name: smoke-manual
title: Smoke Manual
description: 実機テスト用 manual workflow
stepExecution:
  mode: engineSteps
steps:
  - id: confirm
    title: Manual Confirm
    type: manual
    prompt: |
      Bob chat と VS Code command からこの step を完了してください。
---
Manual smoke test.
```

#### pause workflow

```markdown
---
schemaVersion: workflow-register/v1
name: smoke-pause
title: Smoke Pause
description: 実機テスト用 pause workflow
stepExecution:
  mode: engineSteps
steps:
  - id: first
    title: First
    type: manual
    prompt: first step
  - id: second
    title: Second
    type: manual
    prompt: second step
---
Pause smoke test.
```

## 5. テスト実行時の共通確認

各テストでは、可能な範囲で次を確認する。

- VS Code Developer Tools Console に想定外 error が出ていない。
- `.bob/workflows/runs/<runId>/run.json` が作成・更新される。
- `run.json.status`、`currentStep`、`steps[].status` が操作結果に一致する。
- task snapshot が有効な場合、`task-snapshots/latest.json` が作成される。
- Explorer view `Bob Workflow Runs` が表示・更新される。
- Status Bar の active run 件数が状態に応じて変わる。
- Bob chat / Workflow UI の step 完了状態が run state と大きく矛盾しない。

## 6. 実機テスト項目

### WR-RT-001 起動と Bob source 登録

| 項目 | 内容 |
| --- | --- |
| 目的 | 拡張起動時に `.bob/workflows` が読み込まれ、Bob に workflow source が登録されることを確認する。 |
| 手順 | 1. テスト workspace を開く。<br>2. workflow-register を有効化する。<br>3. `Bob Workflow: 登録状態を確認` を実行する。<br>4. Bob Workflow UI を開く。 |
| 期待結果 | inspect report に workflow 一覧が表示される。Bob UI に `workflowRegister.sourceName` の source と workflow が表示される。 |

### WR-RT-002 WORKFLOW.md 保存時 diagnostics

| 項目 | 内容 |
| --- | --- |
| 目的 | `WORKFLOW.md` 保存時に diagnostics が更新されることを確認する。 |
| 手順 | 1. valid workflow を開く。<br>2. `name` を空にして保存する。<br>3. Problems view と `Bob Workflow: 現在の定義を検証` を確認する。<br>4. `name` を戻して保存する。 |
| 期待結果 | 不正時は Problems と Markdown report に error が出る。修正後は error が消える。 |

### WR-RT-003 reload command

| 項目 | 内容 |
| --- | --- |
| 目的 | `.bob/workflows` 追加後に reload で Bob 登録が更新されることを確認する。 |
| 手順 | 1. 新しい workflow folder を追加する。<br>2. `workflowRegister.reload` を実行する。<br>3. inspect report と Bob UI を確認する。 |
| 期待結果 | 新規 workflow が登録状態に含まれ、Bob UI から選択できる。 |

### WR-RT-004 Bob UI full 実行

| 項目 | 内容 |
| --- | --- |
| 目的 | Bob UI から full 実行した workflow が `WorkflowEngine` 経由で完了することを確認する。 |
| 手順 | 1. full 実行用 workflow を Bob UI から選択する。<br>2. 実行する。<br>3. run.json、Bob chat、inspectRuns を確認する。 |
| 期待結果 | run status は `completed`。Bob chat に開始・step・完了 message が表示される。 |

### WR-RT-005 Bob UI engineSteps singleStep 実行

| 項目 | 内容 |
| --- | --- |
| 目的 | `stepExecution.mode: engineSteps` で Bob visible step と engine step が一致することを確認する。 |
| 手順 | 1. engineSteps workflow を Bob UI で開く。<br>2. 先頭 step を実行する。<br>3. run.json を確認する。<br>4. 次 step を実行する。 |
| 期待結果 | 1 step 実行後は run status が `running` または `reviewing` のまま残る。次 step 実行時に同じ recoverable run が使われる。 |

### WR-RT-006 Todo step 実行

| 項目 | 内容 |
| --- | --- |
| 目的 | Todo ベースの visible step が Bob UI から順に実行できることを確認する。 |
| 手順 | 1. Todo を持つ workflow を用意する。<br>2. Bob UI で Todo step を1つずつ実行する。<br>3. run.json の step 状態を確認する。 |
| 期待結果 | Todo と対応する engine step が順に完了し、out-of-order 制約が守られる。 |

### WR-RT-007 standalone runWorkflow command

| 項目 | 内容 |
| --- | --- |
| 目的 | Bob task なしの standalone 実行ができることを確認する。 |
| 手順 | 1. `Bob Workflow: 実行` を実行する。<br>2. workflow を選択する。<br>3. 必要 input を入力する。 |
| 期待結果 | run.json が作成される。Bob chat は更新されない。結果 report または通知が表示される。 |

### WR-RT-008 standalone runWorkflowStep / runNextStep

| 項目 | 内容 |
| --- | --- |
| 目的 | Command Palette から step 単位実行と次 step 実行ができることを確認する。 |
| 手順 | 1. `Bob Workflow: ステップを実行` を実行する。<br>2. 先頭 step を選択する。<br>3. `Bob Workflow: 次のステップを実行` を実行する。 |
| 期待結果 | run は同じ runId で継続し、step status が順に進む。 |

### WR-RT-009 manual step 完了

| 項目 | 内容 |
| --- | --- |
| 目的 | Bob UI 実行中の manual step が `completeCurrentStep` で完了できることを確認する。 |
| 手順 | 1. manual workflow を Bob UI から実行する。<br>2. run が `held` になることを確認する。<br>3. `Bob Workflow: 実行中ステップを確認` を実行する。<br>4. `Bob Workflow: 現在のステップを完了` を実行する。 |
| 期待結果 | active step が表示され、完了後に `task.setStepComplete()` 相当の挙動で Bob UI step が完了する。run は次 step へ進むか completed になる。 |

### WR-RT-010 held run の resume

| 項目 | 内容 |
| --- | --- |
| 目的 | held run を `resumeRun` で再開できることを確認する。 |
| 手順 | 1. standalone または Bob UI で manual step を held にする。<br>2. `Bob Workflow: 実行を再開` を実行する。<br>3. `completeHeldStep` の挙動を確認する。 |
| 期待結果 | held step が完了扱いになり、次 step から継続する。 |

### WR-RT-011 step review accept

| 項目 | 内容 |
| --- | --- |
| 目的 | step review で reviewing 停止し、承認できることを確認する。 |
| 手順 | 1. `stepReview.pauseAfter: everyStep` workflow を実行する。<br>2. run が `reviewing` になることを確認する。<br>3. `Bob Workflow: 現在のステップ結果を承認` を実行する。 |
| 期待結果 | current step が `completed` になり、run は次 step を実行できる状態になる。 |

### WR-RT-012 step review retry

| 項目 | 内容 |
| --- | --- |
| 目的 | reviewing step を retry でき、attempt が保存されることを確認する。 |
| 手順 | 1. reviewing run を作る。<br>2. `Bob Workflow: 現在のステップを再試行` を実行する。<br>3. run.json を確認する。 |
| 期待結果 | `steps[].attempts` に前回 attempt が保存され、current step が再実行される。 |

### WR-RT-013 acceptAndRunNextStep

| 項目 | 内容 |
| --- | --- |
| 目的 | 承認と次 step 実行を1操作で行えることを確認する。 |
| 手順 | 1. reviewing run を作る。<br>2. `Bob Workflow: 承認して次のステップを実行` を実行する。 |
| 期待結果 | current step が completed になり、次 pending step が実行される。 |

### WR-RT-014 pauseAfterCurrentStep

| 項目 | 内容 |
| --- | --- |
| 目的 | run に pause request を保存し、checkpoint で paused になることを確認する。 |
| 手順 | 1. 2 step 以上の workflow を実行する。<br>2. `Bob Workflow: 現在ステップ後に中断` を実行する。<br>3. current step を完了する。<br>4. run.json と control.json を確認する。 |
| 期待結果 | `control.json` に pause request が保存され、checkpoint 到達後 run status が `paused` になる。`workflow.pause` state に checkpoint が記録される。 |

### WR-RT-015 resumePausedRun

| 項目 | 内容 |
| --- | --- |
| 目的 | paused run の pause request を clear し、再開できることを確認する。 |
| 手順 | 1. paused run を作る。<br>2. `Bob Workflow: 中断 run を再開` を実行する。<br>3. control.json と run.json を確認する。 |
| 期待結果 | `control.json.clearedAt` が保存され、run は `running` へ戻り、次 step から継続する。 |

### WR-RT-016 pauseBeforeNextAiCall

| 項目 | 内容 |
| --- | --- |
| 目的 | `pauseBeforeNextAiCall` command が control state と inspect report に反映されることを確認する。 |
| 手順 | 1. 実行中 run を選択する。<br>2. `Bob Workflow: 次のAI呼び出し前に中断` を実行する。<br>3. `Bob Workflow: 中断・再開状態を確認` を実行する。 |
| 期待結果 | `control.json.mode` が `beforeNextAiCall` になり、inspect report に表示される。現行 engine では checkpoint 停止として扱われる。 |

### WR-RT-017 completed / failed run の pause 拒否

| 項目 | 内容 |
| --- | --- |
| 目的 | 完了済みまたは失敗済み run に pause request を設定できないことを確認する。 |
| 手順 | 1. completed run または failed run を用意する。<br>2. pause command を実行する。 |
| 期待結果 | warning が表示され、control.json は新規作成または更新されない。 |

### WR-RT-018 Run Control View 表示

| 項目 | 内容 |
| --- | --- |
| 目的 | Explorer view に run 状態が表示されることを確認する。 |
| 手順 | 1. running / paused / reviewing / held / completed / failed の run を用意する。<br>2. Explorer の `Bob Workflow Runs` を確認する。<br>3. refresh command を実行する。 |
| 期待結果 | 各 run が status / current step とともに表示される。status に応じて icon と context menu が変わる。 |

### WR-RT-019 Status Bar 表示

| 項目 | 内容 |
| --- | --- |
| 目的 | Status Bar が active run 件数を表示することを確認する。 |
| 手順 | 1. active run が無い状態を確認する。<br>2. running / paused / reviewing / held run を作る。 |
| 期待結果 | active run が無い場合は check 表示、ある場合は running / paused / reviewing / held の件数が表示される。 |

### WR-RT-020 task snapshot 保存

| 項目 | 内容 |
| --- | --- |
| 目的 | Bob UI 実行で task snapshot が保存されることを確認する。 |
| 手順 | 1. taskSnapshots enabled の状態で Bob UI workflow を実行する。<br>2. run directory を確認する。 |
| 期待結果 | `task-snapshots/latest.json` と reason 別 snapshot が作成され、runId、workflowId、stepId、reason、metadata が含まれる。 |

### WR-RT-021 task snapshot 設定 disabled

| 項目 | 内容 |
| --- | --- |
| 目的 | `workflowRegister.taskSnapshots.enabled=false` で snapshot が保存されないことを確認する。 |
| 手順 | 1. 設定を false にする。<br>2. Bob UI workflow を実行する。<br>3. run directory を確認する。 |
| 期待結果 | run.json は作成されるが、新規 snapshot は保存されない。 |

### WR-RT-022 result handoff 失敗時 snapshot

| 項目 | 内容 |
| --- | --- |
| 目的 | result handoff 失敗時に `handoff-failed` snapshot が保存されることを確認する。 |
| 手順 | 1. command sink が失敗する workflow を実行する。<br>2. Bob assistant output 後に失敗させる。<br>3. snapshot を確認する。 |
| 期待結果 | run status は `failed`。`handoff-failed` snapshot が保存され、latest assistant text または error 情報を確認できる。 |

### WR-RT-023 inspectRunDiagnostics

| 項目 | 内容 |
| --- | --- |
| 目的 | run diagnostics が run state と snapshot summary を表示することを確認する。 |
| 手順 | 1. completed / failed / paused などの run を用意する。<br>2. `Bob Workflow: 診断を確認` を実行する。 |
| 期待結果 | run ID、status、current step、step 状態、snapshot 件数、latest snapshot、warning が Markdown report に表示される。 |

### WR-RT-024 Workflow Builder 新規作成

| 項目 | 内容 |
| --- | --- |
| 目的 | GUI Builder で新規 workflow を作成し、保存・reload できることを確認する。 |
| 手順 | 1. `Bob Workflow: GUI で作成` を実行する。<br>2. name、description、steps、Markdown Body を入力する。<br>3. Preview / Diagnostics / Save を実行する。 |
| 期待結果 | `WORKFLOW.md` が作成され、保存後に reload され、Bob UI に表示される。 |

### WR-RT-025 Workflow Builder 既存編集と backup

| 項目 | 内容 |
| --- | --- |
| 目的 | 既存 v1 workflow を GUI Builder で編集し、backup 後に保存できることを確認する。 |
| 手順 | 1. 既存 `WORKFLOW.md` を開く。<br>2. `Bob Workflow: GUI で編集` を実行する。<br>3. step title または body を変更して保存する。 |
| 期待結果 | `WORKFLOW.backup-<timestamp>.md` が作成され、変更後 workflow が parse / reload される。 |

### WR-RT-026 GUI Builder reference warning

| 項目 | 内容 |
| --- | --- |
| 目的 | GUI Builder が state / artifact 参照不整合を warning 表示することを確認する。 |
| 手順 | 1. resultKey を参照する workflow を GUI Builder で開く。<br>2. producer step または resultKey を削除・変更する。 |
| 期待結果 | `includeState`、`stateKey`、`artifact.producedBy` の参照不整合 warning が表示される。 |

### WR-RT-027 validateWorkspaceWorkflows

| 項目 | 内容 |
| --- | --- |
| 目的 | workspace 内 workflow 一括検証が動作することを確認する。 |
| 手順 | 1. valid workflow と invalid workflow を混在させる。<br>2. `Bob Workflow: ワークスペース定義を検証` を実行する。 |
| 期待結果 | report に workflow ごとの error / warning が表示される。 |

### WR-RT-028 AI authoring command 未設定時

| 項目 | 内容 |
| --- | --- |
| 目的 | `workflowRegister.aiProviderCommand` 未設定時でも AI authoring command が安全に動作することを確認する。 |
| 手順 | 1. 設定を空にする。<br>2. `AI で新規設計`、`AI で改善`、`診断を AI で説明` を実行する。 |
| 期待結果 | mock provider または未設定時の安全な応答になり、想定外例外で extension host が落ちない。 |

### WR-RT-029 AI authoring command 設定時

| 項目 | 内容 |
| --- | --- |
| 目的 | `workflowRegister.aiProviderCommand` に任意 command を設定した場合に draft / improve / explain が呼べることを確認する。 |
| 手順 | 1. テスト用 VS Code command を登録した環境で `aiProviderCommand` を設定する。<br>2. AI authoring command を実行する。 |
| 期待結果 | provider command に `{ kind, payload }` が渡り、戻り値が preview / diff / report に反映される。 |

### WR-RT-030 multi-root workflow root 解決

| 項目 | 内容 |
| --- | --- |
| 目的 | multi-root workspace で `.bob` を持つ root が workflow root として扱われることを確認する。 |
| 手順 | 1. `.bob` root と作業 root が別の multi-root workspace を開く。<br>2. workflow を reload する。<br>3. run を実行する。 |
| 期待結果 | workflow は `.bob` root から読み込まれ、run state も `.bob` root 配下へ保存される。 |

### WR-RT-031 duplicate workflow ID 修飾

| 項目 | 内容 |
| --- | --- |
| 目的 | 複数 root に同じ logical workflow ID がある場合に登録 ID が一意化されることを確認する。 |
| 手順 | 1. multi-root の2 root に同名 workflow を配置する。<br>2. reload する。<br>3. inspect report を確認する。 |
| 期待結果 | `<logicalId>.<rootSlug>-<sha1-prefix>` 形式で修飾され、Bob UI 登録が衝突しない。 |

### WR-RT-032 sourceId / sourceName 設定

| 項目 | 内容 |
| --- | --- |
| 目的 | `workflowRegister.sourceId` / `sourceName` 設定が Bob 登録に反映されることを確認する。 |
| 手順 | 1. 設定値を変更する。<br>2. VS Code を reload する。<br>3. Bob UI と inspect report を確認する。 |
| 期待結果 | source ID / 表示名が設定値に変わる。 |

### WR-RT-033 task snapshot pruning

| 項目 | 内容 |
| --- | --- |
| 目的 | `maxPerRun` を超えた snapshot が pruning されることを確認する。 |
| 手順 | 1. `workflowRegister.taskSnapshots.maxPerRun` を小さくする。<br>2. 複数 step workflow を実行する。<br>3. snapshot directory を確認する。 |
| 期待結果 | `latest.json` を除き、保持数が maxPerRun 以下になる。 |

### WR-RT-034 task snapshot maxBytes / includeMessages

| 項目 | 内容 |
| --- | --- |
| 目的 | snapshot の size 制限と message 保存設定を確認する。 |
| 手順 | 1. `maxBytes` を小さくし、`includeMessages` を true / false で切り替える。<br>2. Bob UI workflow を実行する。<br>3. snapshot JSON を確認する。 |
| 期待結果 | size 超過時は truncation 情報が保存され、includeMessages=false の場合は messages が省略される。 |

### WR-RT-035 拡張機能再起動後の recoverable run

| 項目 | 内容 |
| --- | --- |
| 目的 | VS Code reload 後も同じ workflow / inputs の recoverable run が再利用されることを確認する。 |
| 手順 | 1. singleStep で途中 run を作る。<br>2. VS Code window を reload する。<br>3. 同じ workflow / inputs で次 step を実行する。 |
| 期待結果 | 同じ runId の run が再利用される。Bob task handle が必要な active step は復元対象外であることを確認する。 |

### WR-RT-036 Template Customization Studio

| 項目 | 内容 |
| --- | --- |
| 目的 | Template Customization Studio で標準テンプレートから workflow を生成し、安全な上書きと readiness を確認する。 |
| 手順 | 1. `Bob Workflow: テンプレートカスタマイズ Studio` を実行する。<br>2. 標準テンプレートを選択し、`targetLanguage`、`vcs.type`、phase artifact root、input default を編集する。<br>3. Preview / Diff / Readiness を確認する。<br>4. Generate を実行する。<br>5. 既存生成物がある状態で再度 Generate を実行する。 |
| 期待結果 | 候補は template metadata と一致し、number / boolean / null defaults が保持される。Bazaar profile だけ `bzr --no-aliases` prompt supplement を持ち、Git profile には混入しない。workspace 外または symlink escape の生成先は拒否される。既存 profile / customization / workflow は backup 後に上書きされる。 |

## 7. 実機テスト結果記録テンプレート

| 項目 | 記入欄 |
| --- | --- |
| テスト日 |  |
| テスト担当 |  |
| OS / バージョン |  |
| VS Code / Bob IDE バージョン |  |
| IBM Bob 拡張バージョン |  |
| workflow-register commit / VSIX |  |
| workspace path |  |
| 実施した testcase ID |  |
| 合格 |  |
| 不合格 |  |
| 保留 |  |
| 主な不具合 / 備考 |  |

## 8. 合格基準

- WR-RT-001 から WR-RT-010 までの smoke / basic flow が合格する。
- run state、run control、task snapshot が設計どおりの保存先に作成される。
- Bob UI 実行と standalone 実行で run state の矛盾がない。
- Explorer view / Status Bar / Diagnostics / GUI Builder / Template Customization Studio が実機上で操作可能である。
- failed / held / reviewing / paused の復旧導線が Command Palette から利用できる。
- Developer Tools Console に未処理例外が残らない。

## 9. 回帰確認の優先度

| 優先度 | 対象 |
| --- | --- |
| P0 | 起動、workflow 登録、Bob UI full、singleStep、manual completion、run.json 保存。 |
| P1 | step review、pause / resume、Run Control View、task snapshot、result handoff。 |
| P2 | GUI Builder、Template Customization Studio、AI authoring、multi-root、snapshot pruning / maxBytes。 |
| P3 | sourceId / sourceName 設定、duplicate ID、OS 差分確認。 |

<!-- REMEDIATION-2026-07-11 -->
## 2026-07-11 追加リリースゲート

1. Windows と Ubuntu の CI が成功していること。
2. timeout / cancel 後に Git / Bazaar 子プロセスが残留しないこと。
3. companion extension を無効化した状態で通常 command が起動し、再有効化後に provider が回復すること。
4. multi-root workspace で Bob root と VCS root が混同されないこと。
5. IBM Bob 実環境で workflow source、step review、result handoff、MCP、Webview の代表 smoke を実施し、結果を release evidence に保存すること。
6. workflow-contracts CI が repository 内の全対象 WORKFLOW.md を検証し成功していること。
