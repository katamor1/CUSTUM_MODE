# scaffold テスト fixture

## 1. 目的

このディレクトリは、整合プレレビュー scaffold の最小検証に使う fixture と自動テストを置く。

MVP の初期段階では、以下を確認できることを優先する。

- 正常な `review-input.yaml` を読み込めること
- 不正な `review-input.yaml` を検出できること
- 正常な `bob-output.yaml` を valid と判定できること
- evidence が空の finding を含む `bob-output.yaml` を invalid と判定できること
- diff summary fixture を読み込めること
- review-package の必須ファイルを生成できること
- triage 用 Markdown / YAML を生成できること

## 2. fixture 一覧

```text
tests/fixtures/
  review-input.valid.yaml
  review-input.invalid-missing-target.yaml
  diff-summary.valid.json
  bob-output.valid.yaml
  bob-output.invalid-final-approval.yaml
  bob-output.invalid-missing-evidence.yaml
```

`bob-output.invalid-final-approval.yaml` は、手動確認用の fixture として残す。
自動テストでは、安全に扱いやすい `bob-output.invalid-missing-evidence.yaml` を使用する。

## 3. 自動テスト

```bash
npm run unit
```

対象:

- `review-input-validator.test.ts`
- `bob-output-validator.test.ts`
- `git-diff-collector.test.ts`
- `review-package-builder.test.ts`

確認内容:

- valid review-input を受け付ける。
- target ref が未指定の review-input を拒否する。
- valid bob-output を受け付ける。
- evidence が空の finding を含む bob-output を拒否する。
- diff summary fixture を読み込む。
- review-package の必須ファイルを生成する。
- `bob-input.md` に必要な入力セクションが入る。

## 4. 手動確認例

### 4.1 review-input valid

```bash
node dist/src/cli/main.js preprocess \
  --input tests/fixtures/review-input.valid.yaml \
  --out .tmp/review-package \
  --diff-fixture tests/fixtures/diff-summary.valid.json
```

期待:

- `.tmp/review-package/` に必須ファイルが生成される。

### 4.2 bob-output valid

```bash
node dist/src/cli/main.js validate-output \
  --package .tmp/review-package \
  --bob-output tests/fixtures/bob-output.valid.yaml
```

期待:

- invalid error が出ない。

### 4.3 bob-output invalid

```bash
node dist/src/cli/main.js validate-output \
  --package .tmp/review-package \
  --bob-output tests/fixtures/bob-output.invalid-missing-evidence.yaml
```

期待:

- evidence が空の finding を error として検出する。

## 5. smoke test

```bash
npm run smoke
```

対象:

- help 表示
- diff fixture を使った preprocess
- valid bob-output 検証
- human triage 生成

## 6. 後続で自動化すること

- evidence-index 照合の unit test を追加する。
- 生成物の内容を snapshot test 化する。
- 実 Git 差分を使う E2E fixture を追加する。
