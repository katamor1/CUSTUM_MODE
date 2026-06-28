# 整合プレレビュー scaffold 開発手順

## 1. 目的

この文書は、`scaffold/` 配下の MVP 実装スケルトンを、開発者がローカルで確認するための手順を定義する。

この scaffold はまだ正式な拡張機能配置ではない。既存構成に移す前に、CLI の入出力、review-package 生成、bob-output 検証、human triage 生成の流れを確認するための足場である。

## 2. 前提

- Node.js が利用できること。
- Git コマンドが利用できること。
- scaffold の作業ディレクトリは `docs/workflows/code-consistency-review/scaffold/` とする。
- 実行時はリポジトリルートからの相対パスを扱う。

## 3. 初期セットアップ

```bash
cd docs/workflows/code-consistency-review/scaffold
npm install
npm run build
```

## 4. help 表示確認

```bash
node dist/src/cli/main.js
```

または:

```bash
npm run smoke:help
```

期待:

- `preprocess`
- `validate-output`
- `triage`

の 3 サブコマンドが表示される。

## 5. 自動テスト

```bash
npm run unit
```

確認対象:

- 正常な `review-input.yaml` を受け付ける。
- 比較先未指定の `review-input.yaml` を拒否する。
- 正常な `bob-output.yaml` を受け付ける。
- evidence が空の finding を含む `bob-output.yaml` を拒否する。
- diff summary fixture を読み込める。

## 6. preprocess の確認

リポジトリルートで以下を実行する。

```bash
node docs/workflows/code-consistency-review/scaffold/dist/src/cli/main.js preprocess \
  --input docs/workflows/code-consistency-review/examples/simple-timeout-bugfix/review-input.yaml \
  --out .bob-review/review-package
```

期待する生成物:

```text
.bob-review/review-package/
  manifest.yaml
  input-normalized.json
  changed-files.json
  changed-symbols.json
  change-summary.md
  diff-context.md
  document-index.json
  document-excerpts.md
  traceability-map.md
  deterministic-checks.md
  evidence-index.json
  bob-input.md
```

注意:

- 現時点の scaffold では、文書抽出と C/C++ 解析は TODO を含む簡易実装である。
- `review-input.yaml` の `base` / `head` がローカルで存在しない場合、Git diff 収集で失敗する。
- その場合は `--diff-fixture` を使う。

## 7. diff fixture を使った preprocess 確認

```bash
npm run smoke:preprocess
```

上記は、以下と同等である。

```bash
node dist/src/cli/main.js preprocess \
  --input tests/fixtures/review-input.valid.yaml \
  --out .tmp/review-package \
  --diff-fixture tests/fixtures/diff-summary.valid.json
```

期待:

- Git の比較対象ブランチを用意しなくても review-package を生成できる。
- `.tmp/review-package/bob-input.md` が生成される。
- `.tmp/review-package/changed-files.json` に fixture の変更ファイルが出力される。

## 8. bob-output 検証

```bash
node docs/workflows/code-consistency-review/scaffold/dist/src/cli/main.js validate-output \
  --package .bob-review/review-package \
  --bob-output docs/workflows/code-consistency-review/examples/simple-timeout-bugfix/bob-output.sample.yaml
```

または:

```bash
npm run smoke:validate-output
```

期待:

- `review_summary.final_approval` が `not_performed` であることを確認する。
- finding に evidence と human_check があることを確認する。
- MVP scaffold では evidence-index との完全照合は TODO warning とする。

## 9. human triage 生成

```bash
node docs/workflows/code-consistency-review/scaffold/dist/src/cli/main.js triage \
  --package .bob-review/review-package \
  --bob-output docs/workflows/code-consistency-review/examples/simple-timeout-bugfix/bob-output.sample.yaml \
  --out .bob-review/human-triage
```

または:

```bash
npm run smoke:triage
```

期待する生成物:

```text
.bob-review/human-triage/
  triage-result.yaml
  accepted-findings.md
  questions-to-author.md
  rejected-findings.md
  follow-up-actions.md
```

## 10. smoke test 一括実行

```bash
npm run smoke
```

確認対象:

- help 表示
- diff fixture を使った preprocess
- bob-output valid fixture の検証
- human triage 生成

## 11. CI 検証

GitHub Actions workflow は以下に定義する。

```text
.github/workflows/code-consistency-review-scaffold.yml
```

CI では scaffold 関連パスが変更されたときに、以下を実行する。

```bash
npm install
npm run typecheck
npm run unit
npm run smoke
```

詳細は `CI.md` を参照する。

## 12. 最初に改善すべき TODO

1. `document-extractor.ts` で Markdown 文書の実テキストを抽出する。
2. `c-cpp-change-analyzer.ts` で変更行の関数所属を推定する。
3. `bob-output-validator.ts` で evidence-index との照合を実装する。
4. `human-triage-helper.ts` で triage-result.yaml の decision に応じた Markdown 分割を行う。
5. preprocess の生成物を snapshot test で確認する。

## 13. 終了コード方針

| 状態 | 終了コード |
|---|---:|
| 正常終了 | 0 |
| 入力不正 | 1 |
| Git diff 取得失敗 | 1 |
| bob-output invalid | 1 |
| warning のみ | 0 |

## 14. このフェーズの完了条件

- `npm run build` が通る構成になっている。
- `npm run unit` で validator と diff fixture の自動テストを実行できる。
- `npm run smoke` で help / preprocess / validate-output / triage を確認できる。
- GitHub Actions で typecheck / unit / smoke を実行できる。
- fixture を使って review-package と triage の入出力を確認できる。
- TODO が明示され、次の実装対象が分かる。
