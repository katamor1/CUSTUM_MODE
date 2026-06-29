# extensions ディレクトリ

このディレクトリには、IBM Bob を拡張するためのローカル VS Code 拡張機能を配置します。

## 拡張機能 README 一覧

| 拡張機能 | 役割 | README |
| --- | --- | --- |
| `workflow-register` | `.bob/workflows/*/WORKFLOW.md` を読み込み、IBM Bob のワークフローソースとして登録する。作成、検証、実行、診断、AI 補助のコマンドも提供する。 | `extensions/workflow-register/README.md` |
| `bob-bazaar-review` | Bazaar 差分レビュー、プロジェクト規約読み込み、review-result JSON 検証、読み取り専用 Bazaar MCP サーバーを提供する。 | `extensions/bob-bazaar-review/README.md` |
| `bob-code-consistency-review` | コード変更と要求書・設計書・テスト仕様書の整合プレレビュー用。現時点では `docs/workflows/code-consistency-review/scaffold/` の MVP スケルトンを後続フェーズで拡張機能化する想定。 | `extensions/bob-code-consistency-review/README.md` |

## 推奨する読み順

1. `docs/workflow-authoring-guide-ja.md`
2. `extensions/workflow-register/README.md`
3. `extensions/bob-bazaar-review/README.md`
4. `docs/workflows/code-consistency-review/README.md`
5. `extensions/bob-code-consistency-review/README.md`

まずワークフロー定義の作り方を確認し、その後で各拡張機能の README を読んでください。`bob-code-consistency-review` は、詳細仕様と scaffold の現在地を確認してから読むと意図を把握しやすくなります。

## 拡張機能の関係

```text
IBM.bob-code
  └─ workflow-register
       ├─ bob-bazaar-review
       └─ bob-code-consistency-review（予定）
```

`workflow-register` は、Bob にワークフローを登録する基盤拡張です。

`bob-bazaar-review` は、`workflow-register` から呼び出せる Bazaar レビュー用コマンドや結果取り込み機能を提供する連携拡張です。

`bob-code-consistency-review` は、コード差分と要求・設計・テスト仕様の整合プレレビューを支援する連携拡張として整備予定です。現在の MVP 実装スケルトンは `docs/workflows/code-consistency-review/scaffold/` にあります。

## `.bob` ワークスペース構成

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

`bob-code-consistency-review` は、将来的に `.bob-review/review-package` や `.bob-review/human-triage` などの整合プレレビュー成果物を生成する想定です。

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

`bob-code-consistency-review` は、現時点では scaffold を検証します。

```powershell
cd docs\workflows\code-consistency-review\scaffold
npm install
npm run typecheck
npm run unit
npm run smoke
```

## 関連ドキュメント

- `docs/workflow-authoring-guide-ja.md`
- `docs/workflows/code-consistency-review/README.md`
- `extensions/workflow-register/README.md`
- `extensions/bob-bazaar-review/README.md`
- `extensions/bob-code-consistency-review/README.md`
