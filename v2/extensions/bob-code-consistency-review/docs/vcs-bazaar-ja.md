# Bazaar 差分を使う code-consistency-review

`bob-code-consistency-review` は既定では Git 差分を使いますが、`review-input.yaml` の `review.vcs` に `bazaar` または `bzr` を指定すると Bazaar 差分を使います。

## 指定例

```yaml
schema_version: 1
review:
  id: timeout-bugfix-r1
  title: タイムアウト処理修正の整合プレレビュー
  change_type: bugfix
  purpose: タイムアウト時の戻り値を要求仕様どおりに修正する
  vcs: bazaar
  base: 10
  head: 12

artifacts:
  requirements:
    - path: docs/requirements-timeout.md
      sections:
        - REQ-TIMEOUT-001

review_focus:
  - requirement-code-consistency
  - design-code-consistency
  - test-gap
```

この場合、前処理では次の Bazaar command を使います。

```text
bzr --no-aliases diff -r 10..12
```

`--no-aliases` は拡張機能側で必ず付与します。ユーザー環境の Bazaar alias により `diff` が GUI ツールへ置き換わることを避けるためです。

## Bazaar root が Bob workspace と異なる場合

`.bob` を置く workspace と Bazaar branch が異なる場合は、`review.vcs_root` を指定できます。

```yaml
review:
  id: branch2-review-r12
  title: branch2 r10..r12 整合プレレビュー
  change_type: feature
  purpose: branch2 の変更を要求・設計・テスト仕様と照合する
  vcs: bazaar
  vcs_root: ../bazaar_test/branch2
  base: 10
  head: 12
```

`vcs_root` は Bob workspace root からの相対パス、または絶対パスで指定します。

## Bazaar 実行ファイルの指定

Bazaar 実行ファイルが PATH に無い場合は、VS Code 設定または workflow option の `bzrPath` で指定します。

```json
{
  "bobCodeConsistency.bzrPath": "C:/Program Files/Bazaar/bzr.exe"
}
```

## 生成物への反映

前処理結果の `manifest.yaml` と `changed-files.json` には VCS 情報が含まれます。

```yaml
repository:
  vcs: bazaar
  root: ../bazaar_test/branch2
  base: 10
  head: 12
```

## 注意点

- Bazaar 対応は読み取り専用の差分取得だけです。
- commit / push / pull / update / revert などの Bazaar 操作は実行しません。
- Bazaar の未コミット差分を直接扱う workflow ではなく、`base..head` の revision range 差分を使います。
- C / C++ 解析は Bazaar unified diff の `=== modified file '...'` 形式と `+++ file` 形式を解釈します。
