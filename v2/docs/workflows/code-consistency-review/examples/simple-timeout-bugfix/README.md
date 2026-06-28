# simple-timeout-bugfix E2E サンプル

## 1. 目的

このサンプルは、コード変更と要求・設計・テスト文書の整合プレレビュー MVP を検証するための最小シナリオである。

timeout 発生時に `ERR_TIMEOUT` を返すべきところ、変更後コードが `ERR_OK` を返してしまうケースを扱う。

## 2. サンプル構成

```text
simple-timeout-bugfix/
  README.md
  review-input.yaml
  bob-output.sample.yaml
  code/
    foo_timeout_before.c
    foo_timeout_after_buggy.c
  docs/
    requirements-timeout.md
    basic-design-timeout.md
    detailed-design-timeout.md
    test-spec-timeout.md
    error-ledger.md
```

## 3. 期待する検出結果

bob プレレビューでは、少なくとも以下の候補が出ることを期待する。

- `REQ-123` と変更後コードの不整合候補
- `DD-88` と変更後コードの不整合候補
- `TC-789` が失敗する可能性、またはテスト仕様更新要否
- timeout を正常扱いにする仕様変更が存在するかの確認質問

## 4. 実行イメージ

### 4.1 preprocess

```bash
bob-review preprocess \
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

### 4.2 bob 実行

MVP では bob 実行自体は手動でもよい。

1. `bob-input.md` を bob に投入する。
2. YAML 形式で出力させる。
3. 出力を `.bob-review/bob-output/bob-output.yaml` に保存する。

このサンプルでは、代わりに `bob-output.sample.yaml` を利用できる。

### 4.3 validate-output

```bash
bob-review validate-output \
  --package .bob-review/review-package \
  --bob-output docs/workflows/code-consistency-review/examples/simple-timeout-bugfix/bob-output.sample.yaml
```

期待する結果:

- YAML として valid
- `final_approval: not_performed`
- findings に evidence が存在する
- questions が保存される

### 4.4 triage

```bash
bob-review triage \
  --package .bob-review/review-package \
  --bob-output docs/workflows/code-consistency-review/examples/simple-timeout-bugfix/bob-output.sample.yaml \
  --out .bob-review/human-triage
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

## 5. 人間 triage の期待例

```yaml
items:
  - source_id: PRE-001
    decision: accept
    reason: "要求・詳細設計・コードの根拠が揃っており、正式レビューで確認すべきため。"

  - source_id: PRE-002
    decision: accept
    reason: "TC-789 の期待値とコード差分が矛盾している可能性があるため。"

  - source_id: Q-001
    decision: ask_author
    reason: "timeout 正常扱いが仕様変更かどうかを確認する必要があるため。"
```

## 6. MVP 実装でこのサンプルを使う観点

| 観点 | 確認内容 |
|---|---|
| review-input | YAML を読み込めるか |
| document-extractor | Markdown 文書から REQ / BD / DD / TC / ERR を抽出できるか |
| c-cpp-change-analyzer | `Foo_HandleTimeout` の変更を抽出できるか |
| traceability-builder | `REQ-123 -> DD-88 -> TC-789 -> Foo_HandleTimeout` の候補を作れるか |
| bob-output-validator | bob-output.sample.yaml を検証できるか |
| human-triage-helper | accepted-findings.md と questions-to-author.md を生成できるか |

## 7. 注意

このサンプルは実装検証用の最小事例であり、実プロジェクトの完全なコード構成を表すものではない。

実プロジェクトに適用する際は、共有メモリ、外部 I/F、RT / TS、台帳、複数文書版数を含む追加サンプルを増やす。
