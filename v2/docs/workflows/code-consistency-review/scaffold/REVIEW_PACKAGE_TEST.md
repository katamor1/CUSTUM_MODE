# review-package 生成物テスト

## 1. 目的

この文書は、scaffold の `review-package-builder.test.ts` が確認する内容を定義する。

`preprocess` がコマンドとして終了するだけでは、必要な成果物が揃っているか分からない。
そのため、fixture を使って review-package を生成し、必須ファイルが出力されることを自動テストで確認する。

## 2. 対象テスト

```text
scaffold/tests/review-package-builder.test.ts
```

## 3. 入力 fixture

```text
scaffold/tests/fixtures/review-input.valid.yaml
scaffold/tests/fixtures/diff-summary.valid.json
```

## 4. 確認する必須ファイル

```text
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

## 5. 確認する内容

- 必須ファイルがすべて生成されること。
- `bob-input.md` に整合プレレビュー入力の本文が含まれること。
- `changed-files.json` に fixture の変更ファイルが含まれること。

## 6. 実行方法

```bash
npm run unit
```

`unit` script では以下のテストも同時に実行する。

- `review-input-validator.test.ts`
- `bob-output-validator.test.ts`
- `git-diff-collector.test.ts`
- `review-package-builder.test.ts`

## 7. 後続改善

- 生成物の内容を snapshot test 化する。
- `evidence-index.json` と bob-output の evidence 照合を追加する。
- 実 Git 差分を使う E2E テストを追加する。
