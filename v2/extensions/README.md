# extensions ディレクトリ

このディレクトリには、IBM Bob / Bob IDE と連携するローカル VS Code 拡張機能を配置します。

現在の主要モジュールは次の 3 つです。

| 拡張機能 | 役割 | README |
| --- | --- | --- |
| `workflow-register` | `.bob/workflows/*/WORKFLOW.md` を読み込み、IBM Bob のワークフローソースとして登録する基盤拡張。作成、検証、実行、再開、診断、AI 補助、GUI Builder も提供する。 | `extensions/workflow-register/README.md` |
| `bob-bazaar-review` | Bazaar 差分レビュー、プロジェクト規約読み込み、review-result JSON 検証、読み取り専用 Bazaar MCP サーバーを提供する連携拡張。 | `extensions/bob-bazaar-review/README.md` |
| `bob-code-consistency-review` | コード変更と要求書・設計書・テスト仕様書の整合プレレビュー用パッケージ、traceability sidecar、Bob 出力検証、人間 triage を提供する連携拡張。 | `extensions/bob-code-consistency-review/README.md` |

## 推奨する読み順

1. `docs/workflow-authoring-guide-ja.md`
2. `extensions/workflow-register/README.md`
3. `extensions/bob-bazaar-review/README.md`
4. `docs/workflows/code-consistency-review/README.md`
5. `extensions/bob-code-consistency-review/README.md`

まず `workflow-register` でワークフロー定義と実行モデルを確認し、その後に個別連携拡張を読むと全体像を追いやすくなります。

## 拡張機能の関係

```text
IBM.bob-code
  └─ workflow-register
       ├─ bob-bazaar-review
       └─ bob-code-consistency-review
```

`workflow-register` は、Bob にワークフローを登録し、`command` / `agent` / `manual` / `result` step を実行する基盤拡張です。

`bob-bazaar-review` は、Bazaar 差分レビュー用の GUI、コマンド、MCP、project rules、review-result 保存を提供します。`workflow-register` が導入されている場合は action provider として同梱ワークフローから呼び出せます。

`bob-code-consistency-review` は、コード差分と要求・設計・テスト仕様の整合プレレビューを支援する実行可能な VS Code 拡張です。`review-input.yaml` を直接フル手書きする運用だけでなく、対話式 wizard、AI draft JSON、traceability sidecar catalog から生成する運用を提供します。

3拡張機能をさらに分割するか、単一拡張へ統合するかの判断は `docs/bob-three-extension-architecture-decision-ja.md` を参照してください。現時点の方針は、ユーザー可視の拡張は3つのまま維持し、統合は workflow action contract、成果物 schema、security / privacy policy、CI / package policy で行うことです。

## 現在のリファクタリング状態

3 拡張機能では、AI と人間が安全に保守しやすい単位へ責務分割を進めています。

| 拡張機能 | 現在の分割状態 | まだ残っている主な責務 |
| --- | --- | --- |
| `workflow-register` | `bobWorkflowFactory.ts`、`bobWorkflowMessages.ts`、`bobTaskInputs.ts`、`taskSnapshotRecovery.ts`、`bobApi.ts`、`reports.ts` に低リスク helper を分離済み。 | `bobWorkflowRunner.ts` には `BobWorkflowEngineRunner` と `StepRuntime` が残る。次の候補は `StepRuntime` の単独分離。 |
| `bob-bazaar-review` | `workflowRegisterBridge.ts` に workflow-register API 接続と workflow action input helper、`bazaarReviewCommands.ts` に revision / range review packet command、`reviewResultValidationCommand.ts` に active editor の review-result JSON 検証を分離済み。 | `extension.ts` には command 登録、workflow provider 登録、project rules 読み込み、review packet 検索、MCP 設定、GUI 起動が残る。 |
| `bob-code-consistency-review` | `extensionCommandOptions.ts`、`reviewInputWizard.ts`、`workflowProviderRegistration.ts`、`workspaceInitializer.ts`、`traceabilityCommands.ts`、`reviewExecutionCommands.ts` に command helper / UI / workflow provider / 初期化 / traceability / 実行系 command を分離済み。 | `extension.ts` には command 登録、handler mapping、review-input 作成・AI draft・診断系 command handler が残る。次の候補は `reviewInputCommands.ts`。 |

詳細な分割方針は `docs/extension-refactor-review-54e1fe58.md` を参照してください。

## `.bob` / `.bob-review` / `.bob-trace` ワークスペース構成

ワークフローとレビュー規約は、利用側ワークスペースの `.bob` に配置します。

```text
.bob/
  workflows/
    <workflow-name>/
      WORKFLOW.md
  review/
    checklist.json
    review-result.schema.json
  skills/
    <skill-name>/
      SKILL.md
  custom_modes.yaml
  mcp.json
```

`workflow-register` が直接読み込むのは次のファイルです。

```text
.bob/workflows/*/WORKFLOW.md
```

`bob-bazaar-review` は Bazaar レビュー向けに `.bob/review`、`.bob/mcp.json`、同梱ワークフロー、Skill、Mode の初期化を支援します。

`bob-code-consistency-review` は、整合プレレビューの実行時に次のような成果物を生成します。

```text
review-input.yaml
.bob-review/
  review-package/
  bob-output/
  human-triage/
.bob-trace/
  traceability-catalog.json
  gate-report.md
```

## 新しい拡張機能を追加するときの README 方針

各拡張機能の README には、最低限次の項目を日本語で書いてください。

- 拡張機能の目的
- 依存拡張
- 利用手順
- Command Palette のコマンド一覧
- 設定項目
- 生成・更新するファイル
- `workflow-register` との連携方法
- ビルド方法
- セキュリティ上の注意点
- 関連ドキュメント

コマンド名、設定キー、JSON / YAML のフィールド名、ファイル名、識別子は実装上の名称として原文を維持します。

## Command Palette 表示名ポリシー

VS Code の Command Palette では、コマンド表示名を `category: title` として扱います。IBM Bob 連携コマンドであることを入力途中でも見つけやすくしつつ、日本語ユーザーが操作内容を読めるよう、表示名は `Bob <English area>: <日本語の操作名>` に統一してください。

- `category`（`contributes.commands[].category`）は ASCII 英語で `Bob` から始めます。例: `Bob Workflow`、`Bob Bazaar Review`、`Bob Code Consistency Review`。
- `title`（`contributes.commands[].title`）にはコロンを含めず、日本語の操作名を書きます。`review-input.yaml`、`AI draft`、`MCP` などの実装上の名称は必要に応じて原文のまま残します。
- README や実機手順で Command Palette 上の表示名を書くときは `category: title` の完成形を記載します。コロンの手前には日本語を入れません。

## ビルド方針

各拡張機能は、原則として拡張機能ディレクトリごとにビルドします。

```powershell
cd extensions\workflow-register
npm install
npm run compile
npm run test
npm run package
```

```powershell
cd extensions\bob-bazaar-review
npm install
npm run compile
npm run test
npm run package
```

```powershell
cd extensions\bob-code-consistency-review
npm install
npm run compile
npm run test
npm run package
```

## 関連ドキュメント

- `docs/bob-three-extension-architecture-decision-ja.md`
- `docs/workflow-authoring-guide-ja.md`
- `docs/extension-refactor-review-54e1fe58.md`
- `docs/workflows/code-consistency-review/README.md`
- `extensions/workflow-register/README.md`
- `extensions/bob-bazaar-review/README.md`
- `extensions/bob-code-consistency-review/README.md`
