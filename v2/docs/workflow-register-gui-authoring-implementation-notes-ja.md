# workflow-register GUI ワークフロー作成 MVP 実装メモ

## 実装範囲

`docs/workflow-register-gui-authoring-plan-ja.md` の Phase 1 を中心に、GUI で新規 `WORKFLOW.md` を作成する MVP を実装した。

追加した主な機能は次のとおり。

- Command Palette から `Bob ワークフロー: GUI で作成` を起動する。
- VS Code Webview に `Bob Workflow Builder` を表示する。
- テンプレートを選び、基本情報、steps、inputs、artifacts、guardrails を編集する。
- step を `agent` / `command` / `manual` / `result` として追加・削除・複製・上下移動する。
- `includeState` は前段 step の `resultKey` から候補選択する。
- `artifacts.producedBy` は既存 step id から候補選択する。
- GUI 内部モデルから `WORKFLOW.md` を生成する。
- 保存前に既存 `validateWorkflowText` を実行し、error がある場合は保存しない。
- 既存ファイルを上書きする場合は `WORKFLOW.backup-<timestamp>.md` を作成する。
- 保存後に `workflowRegister.reload` を実行する。

## Phase 2: 参照関係 UX 強化

Phase 2 では、`resultKey` / `includeState` / `artifacts.producedBy` の関係を GUI 上で把握しやすくした。

追加した内容は次のとおり。

- step カードに参照エラーの警告バッジを表示する。
- step 詳細に「参照チェック OK / 参照チェック」を表示する。
- 削除対象 step の `resultKey` を後続 step が `includeState` している場合、削除前に影響を確認する。
- 削除対象 step を `artifacts.producedBy` が参照している場合、削除前に影響を確認する。
- step 上下移動で `includeState` が前段参照でなくなる場合、移動前に確認する。
- Preview / Diagnostics に参照チェック結果を表示する。
- validator diagnostics のうち `Step '<id>' ...` 形式のものはクリックで該当 step へ移動できるようにする。
- core 側に `workflowAuthoringReferenceAnalysis.ts` を追加し、参照分析をテスト可能にする。

## Phase 3: 既存 `WORKFLOW.md` の GUI 編集

Phase 3 では、既存の `schemaVersion: workflow-register/v1` workflow を GUI に読み込んで編集できるようにした。

追加した内容は次のとおり。

- Command Palette から `Bob ワークフロー: GUI で編集` を起動する。
- active editor の `WORKFLOW.md`、または file picker で選択した Markdown を読み込む。
- `parseWorkflowMarkdown` の結果を `WorkflowAuthoringModel` に変換する `workflowAuthoringLoader.ts` を追加する。
- GUI 管理対象外の front matter、例: `category` / `permissions` などを `unknownFrontMatter` として保持し、保存時に再出力する。
- Markdown body を保持し、GUI 保存時に維持する。
- 既存編集モードでは Preview / Diagnostics に `Show Diff` を表示し、現在のファイルと生成後プレビューを VS Code diff で確認できるようにする。
- 保存時は既存ファイルに対して `WORKFLOW.backup-<timestamp>.md` を作成してから上書きする。
- `workflowRegister.reload` を保存後に実行する。
- legacy workflow は初期実装では GUI 編集対象外とし、明示的にエラーにする。

## Phase 4: `requires` / `preflight` / `completion` 詳細 GUI 編集

Phase 4 では、既存の Builder に詳細 section 編集タブを追加した。

追加した内容は次のとおり。

- `Requires` タブを追加し、`requires.workspace`、`requires.bob.minVersion`、`requires.files` を編集できるようにする。
- `Preflight` タブを追加し、preflight item の追加・削除、`id`、`title`、`required`、`checks`、`files`、`failurePolicy` を編集できるようにする。
- `Completion` タブを追加し、`summary`、`includeArtifacts`、`validateResult`、`visualization.type`、`visualization.enabled` を編集できるようにする。
- 既存 serializer / loader の round-trip に乗せて、詳細 section も GUI 保存・既存編集の対象にする。
- `workflowAuthoringAdvancedSections.test.js` を追加し、詳細 section の serialize / validate / load round-trip を確認する。

## Phase 5: `guardrails.requireApproval` GUI 編集と Webview 分割

Phase 5 では、承認ルールの GUI 編集と `workflowBuilderPanel.ts` の保守性改善を実施した。

追加した内容は次のとおり。

- `Guardrails` タブに `requireApproval` の追加・削除 UI を追加する。
- approval rule の `id`、`when`、`message` を GUI で編集できるようにする。
- `allowedCommands` / `deniedCommands` と同じ保存経路で `requireApproval` を serializer / validator / loader に流す。
- `workflowAuthoringAdvancedSections.test.js` に approval rule の serialize / validate / load round-trip を追加する。
- 肥大化していた `workflowBuilderPanel.ts` を VS Code panel 制御に絞る。
- Webview shell を `workflowBuilderHtml.ts`、CSS を `workflowBuilderStyles.ts`、client-side script を `workflowBuilderClientScript.ts` へ分割する。

## Phase 6: 手動操作 Step の User Action GUI

Phase 6 では、`type: manual` step と workflow-level manual completion の完了導線として、利用者向けの手動操作ページと Builder 編集項目を追加した。

追加した内容は次のとおり。

- `steps[].userAction` を schema / parser / authoring model / serializer / loader の round-trip 対象にする。
- `manual-checklist` template と scaffold に `userAction.message` と `completeLabel` の例を追加する。
- Bob UI 実行中に manual step が held になったとき、`ManualStepPanelController` で手動操作 Webview を開く。
- `workflowRegister.openManualStepPanel` を追加し、Bob chat の control block、Command Palette、Run Control View の held item から手動操作ページへ到達できるようにする。
- `StepRuntime.completeStepByKey(activeKey)` を追加し、Webview の完了ボタンから既存の `captureHeldStepResult` と `task.setStepComplete()` 経路を通して対象 step だけを完了する。
- Step detail に `User action` section を追加し、message、完了ボタン文言、完了前確認、確認メッセージを編集できるようにする。
- Builder help / help ID / step draft validation / 実行時プレビューに `userAction` を追加する。

## 追加コマンド

| command | title | 用途 |
| --- | --- | --- |
| `workflowRegister.openWorkflowBuilder` | `Bob ワークフロー: GUI で作成` | Webview ベースのワークフロー作成画面を開く。 |
| `workflowRegister.editWorkflowInBuilder` | `Bob ワークフロー: GUI で編集` | 既存 `WORKFLOW.md` を Webview Builder に読み込んで編集する。 |
| `workflowRegister.openManualStepPanel` | `Bob ワークフロー: 手動操作ステップを開く` | held run または active manual step の手動操作ページを開く。 |

## 追加・変更ファイル

```text
extensions/workflow-register/package.json
extensions/workflow-register/src/extensionWithAuthoring.ts
extensions/workflow-register/src/commands/openWorkflowBuilder.ts
extensions/workflow-register/src/commands/editWorkflowInBuilder.ts
extensions/workflow-register/src/core/workflowAuthoringModel.ts
extensions/workflow-register/src/core/workflowAuthoringDefaults.ts
extensions/workflow-register/src/core/workflowAuthoringSerializer.ts
extensions/workflow-register/src/core/workflowAuthoringReferenceAnalysis.ts
extensions/workflow-register/src/core/workflowAuthoringLoader.ts
extensions/workflow-register/src/webview/workflowBuilderPanel.ts
extensions/workflow-register/src/webview/workflowBuilderHtml.ts
extensions/workflow-register/src/webview/workflowBuilderStyles.ts
extensions/workflow-register/src/webview/workflowBuilderClientScript.ts
extensions/workflow-register/test/workflowAuthoringSerializer.test.js
extensions/workflow-register/test/workflowAuthoringReferenceAnalysis.test.js
extensions/workflow-register/test/workflowAuthoringLoader.test.js
extensions/workflow-register/test/workflowAuthoringAdvancedSections.test.js
docs/workflow-register-gui-authoring-plan-ja.md
docs/workflow-register-gui-authoring-implementation-notes-ja.md
```

## 内部構成

### `WorkflowAuthoringModel`

GUI 用の中間モデル。`WorkflowDesignDraft` より詳細に、GUI で編集する `inputs`、`steps`、`artifacts`、`guardrails`、`requires`、`preflight`、`completion` を保持する。

```text
Webview form state
  -> WorkflowAuthoringModel
  -> serializeAuthoringModelToMarkdown
  -> validateWorkflowText
  -> .bob/workflows/<name>/WORKFLOW.md
```

既存編集時は次の経路を使う。

```text
WORKFLOW.md
  -> parseWorkflowMarkdown
  -> workflowToAuthoringModel
  -> Webview form state
  -> serializeAuthoringModelToMarkdown
  -> validateWorkflowText
  -> Show Diff / backup / overwrite
```

### `workflowBuilderPanel.ts`

VS Code WebviewPanel の作成、preview / diff / save、ファイル保存、backup、reload など VS Code extension 側の処理だけを担当する。

### `workflowBuilderHtml.ts`

Webview の HTML shell を生成する。CSP nonce、初期モデル、テンプレート候補、編集モード表示を受け取る。

### `workflowBuilderStyles.ts`

Webview の CSS を生成する。

### `workflowBuilderClientScript.ts`

Webview 内で動く client-side script を生成する。フォーム状態、タブ切替、step 操作、参照チェック、詳細 section 編集、`guardrails.requireApproval` 編集を担当する。

### `workflowAuthoringDefaults.ts`

既存テンプレート種別から GUI 初期モデルを作る。

対象テンプレート:

- `simple-agent`
- `command-then-agent`
- `manual-checklist`
- `input-driven-agent`
- `preflight-files`
- `artifact-output`
- `guarded-command`
- `review-workflow`

### `workflowAuthoringSerializer.ts`

`WorkflowAuthoringModel` を `schemaVersion: workflow-register/v1` の YAML front matter と Markdown body に変換する。

保存前にはこの Markdown を `validateWorkflowText` に渡す。

### `workflowAuthoringReferenceAnalysis.ts`

GUI で扱う参照関係を分析する。

主な検出対象:

- 重複 step id
- 存在しない `includeState`
- 並べ替えによる前方 `includeState`
- 存在しない `artifacts.producedBy`
- step 削除時の影響
- step 移動時の影響

### `workflowAuthoringLoader.ts`

既存 `WORKFLOW.md` を GUI 用モデルへ変換する。

主な方針:

- `schemaVersion: workflow-register/v1` のみを対象にする。
- `inputs` は配列形式の `WorkflowAuthoringInput[]` に変換する。
- `engineSteps` は `WorkflowAuthoringStep[]` に変換する。
- GUI 管理外の front matter は `unknownFrontMatter` に退避する。
- body は `model.body` として保持する。

## MVP で対応した UI

### 基本情報

- template
- workflow name
- title
- description
- workspaceRequired

### steps

- `agent` / `command` / `manual` / `result` の追加
- 削除
- 複製
- 上下移動
- `id`
- `title`
- `type`
- `required`
- `stateRequired`
- `resultKey`
- `maxResultBytes`
- `includeState`
- prompt
- command provider / command ID / extra args
- result source / stateKey / literal text / file sink path
- 参照チェック表示
- 削除・移動時の参照影響確認

### inputs

- id
- type
- title
- required
- select options

### requires

- workspace
- bob.minVersion
- files

### preflight

- item の追加・削除
- id
- title
- required
- checks
- files
- failurePolicy

### artifacts

- id
- producedBy
- path
- producedBy の参照チェック

### guardrails

- allowedCommands
- deniedCommands
- requireApproval item の追加・削除
- requireApproval.id
- requireApproval.when
- requireApproval.message

### completion

- summary
- includeArtifacts
- validateResult
- visualization.type
- visualization.enabled

### preview / diagnostics

- 生成される `WORKFLOW.md` preview
- `validateWorkflowText` の diagnostics
- validation OK / NG 表示
- 参照チェック結果
- diagnostics から該当 step への移動
- 既存編集時の diff preview
- 保存ボタン

## 現時点の制約

この実装は MVP + Phase 2 + Phase 3 + Phase 4 + Phase 5 であり、次はまだ未対応である。

- legacy workflow の GUI 編集。
- raw YAML との完全な双方向編集。
- GUI 管理対象フィールドの YAML 表現やコメントの完全保持。
- AI 提案の GUI 内部分適用。
- provider 別 args schema。
- step 削除時の参照自動修復。

## 次の実装候補

1. `Design Workflow with AI` の出力を Webview に取り込み、GUI で修正して保存できるようにする。
2. 選択中 step の prompt に対して AI 改善ボタンを追加する。
3. `registerActionProvider` の一覧取得 API を追加し、command provider の候補表示を強化する。
4. step 削除時に参照を外す / producedBy を再選択する補助 UI を追加する。
5. Webview client script をさらに機能別モジュールへ分割する。
