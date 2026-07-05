# review-package 仕様案

## 1. 目的

`review-package` は、bob に投入する前に拡張機能が作成する根拠パッケージである。

bob にリポジトリ全体や文書全体をそのまま渡すのではなく、レビュー対象に必要な情報を、根拠 ID 付きで整理して渡す。
C / C++ は変更関数や周辺候補を深掘りし、TypeScript / JavaScript / Python / C# / Java / Go / Rust / Shell / SQL / JSON / YAML / Markdown / text / unknown は diff hunk 単位の汎用コード根拠として整理する。

## 2. 設計方針

- bob が読む情報と、人間が後から監査する情報を分ける。
- すべてのレビュー結果が、対象コミット・文書版数・根拠 ID に戻れるようにする。
- 機械的に確定した事実と、bob に判断させる材料を分ける。
- 大きな差分でも分割投入できるようにする。
- 再実行時に同じ入力を再現できるようにする。

## 3. ディレクトリ構成

```text
.bob-review/
  review-package/
    manifest.yaml
    input-normalized.json
    change-summary.md
    changed-files.json
    changed-symbols.json
    diff-context.md
    document-index.json
    document-excerpts.md
    traceability-map.md
    deterministic-checks.md
    evidence-index.json
    bob-input.md
    prompts/
      system.md
      task.md
      output-format.md
    code-slices/
      SRC-0001.md
      SRC-0002.md
    tables/
      LEDGER-0001.md
      LEDGER-0002.md
```

## 4. manifest.yaml

レビュー実行単位のメタデータを保持する。

```yaml
package_version: 1
created_at: "2026-06-29T10:00:00+09:00"
created_by: bob-review-preprocess
preprocess_version: 0.1.0

repository:
  name: katamor1/bob_builtin_analyze
  base: main
  base_sha: add8fca075266c7a0af3ce972ce88576c9049628
  head: docs/code-consistency-review-flow
  head_sha: 90aefa2361b68d8941f384c3361594461831f6fe

review:
  id: REVIEW-0001
  title: "timeout 異常系処理の修正"
  change_type: bugfix
  ticket_ids:
    - ISSUE-123

inputs:
  review_input: review-input.yaml
  documents:
    - id: DOC-REQ-001
      path: docs/requirements/REQ-001.docx
      type: requirements
      version: "1.2"

prompts:
  template_id: consistency-review-v1
  files:
    - prompts/system.md
    - prompts/task.md
    - prompts/output-format.md
```

## 5. input-normalized.json

`review-input.yaml` を正規化した結果を保存する。

用途:

- 人間が入力した設定の保存
- 後続処理の入力
- bob 実行時の再現性確保

## 6. change-summary.md

コード変更の概要を人間と bob の両方が読める形にする。

含める内容:

- 変更目的
- 変更種別
- 対象コミット
- 変更ファイル数
- 変更関数数
- 追加・変更・削除の概要
- 影響が大きそうな領域
- 拡張機能が検出した注意点

## 7. changed-files.json

変更ファイルの機械的な一覧。

```json
{
  "files": [
    {
      "path": "src/control/foo.c",
      "status": "modified",
      "additions": 12,
      "deletions": 4,
      "language": "c",
      "is_test": false,
      "is_interface_candidate": false
    }
  ]
}
```

`language` は `c`、`cpp`、`h`、`hpp`、`typescript`、`javascript`、`python`、`csharp`、`java`、`go`、`rust`、`shell`、`sql`、`json`、`yaml`、`markdown`、`text`、`unknown` のいずれかである。Git rename は `status: "renamed"` として扱い、binary numstat で行数が得られない場合は `additions` / `deletions` を未確定にして warning に残す。

## 8. changed-symbols.json

変更された関数、構造体、定数、グローバル変数などを保存する。C / C++ 以外、または C / C++ header / define-only 変更で関数範囲を確定できない場合は、file scope の汎用 symbol を保存する。

```json
{
  "functions": [
    {
      "id": "FUNC-0001",
      "name": "Foo_HandleTimeout",
      "file": "src/control/foo.c",
      "change_type": "modified",
      "line_before": "110-160",
      "line_after": "112-172"
    }
  ],
  "types": [],
  "defines": [],
  "globals": []
}
```

## 9. diff-context.md

bob が読む差分本文。

方針:

- 生 diff だけではなく、可能な場合は関数単位の説明を付ける。
- 詳細解析できない言語でも hunk 単位の `SRC-*` evidence と `code-slices/*.md` を生成する。
- 変更行の前後コンテキストを含める。
- 長すぎるファイルは code-slices に分割する。
- 削除されたロジックも省略しすぎない。

推奨形式:

```markdown
## SRC-0001 src/control/foo.c

### 対象関数: Foo_HandleTimeout

- 変更種別: modified
- 関連要求候補: REQ-123
- 関連設計候補: DD-88

### 変更前後の要約

変更前は timeout 時に ERR_TIMEOUT を返していた。
変更後は timeout 分岐が Foo_NormalEnd に合流する可能性がある。

### 差分

```diff
...
```
```

## 10. document-index.json

抽出した文書の索引。

```json
{
  "documents": [
    {
      "id": "DOC-REQ-001",
      "type": "requirements",
      "path": "docs/requirements/REQ-001.docx",
      "version": "1.2",
      "sections": [
        {
          "id": "REQ-123",
          "title": "timeout 時の異常終了",
          "evidence_id": "REQ-0001"
        }
      ]
    }
  ]
}
```

## 11. document-excerpts.md

bob に渡す文書抜粋。

方針:

- 文書全体ではなく関連箇所を抜粋する。
- 抜粋ごとに evidence_id を付ける。
- 表は Markdown テーブルまたは CSV 風に整形する。
- 抽出元の文書名、版数、セクション ID を必ず残す。

```markdown
## REQ-0001

- type: requirement
- source: docs/requirements/REQ-001.docx
- version: 1.2
- section: REQ-123

timeout が発生した場合、処理は異常終了し、ERR_TIMEOUT を返す。
```

## 12. traceability-map.md

要求、設計、コード、テストの対応候補をまとめる。

```markdown
| requirement | basic_design | detailed_design | code | test | link_type | confidence |
|---|---|---|---|---|---|---|
| REQ-123 | BD-45 | DD-88 | SRC-0001 | TC-789 | explicit-id | high |
| REQ-124 | unknown | DD-90 | SRC-0002 | unknown | keyword | low |
```

## 13. deterministic-checks.md

AI に推測させないチェック結果をまとめる。

```markdown
## Build

- status: passed
- command: build.bat
- log: logs/build.log

## Unit Test

- status: failed
- failed_cases:
  - UT_TIMEOUT_001

## Rule Checks

| rule | status | evidence |
|---|---|---|
| RT_NO_FILE_IO | passed | rule-checks.json |
| SHM_SIZE_CHANGED | warning | shared-memory-report.json |
```

## 14. evidence-index.json

bob 出力の根拠参照に使う ID 一覧。

```json
{
  "evidence": [
    {
      "id": "SRC-0001",
      "type": "code",
      "path": "src/control/foo.c",
      "range": "112-172"
    },
    {
      "id": "REQ-0001",
      "type": "requirement",
      "path": "docs/requirements/REQ-001.docx",
      "section": "REQ-123"
    }
  ]
}
```

## 15. bob-input.md

bob に最終的に投入する統合入力。

構成:

1. レビュー目的
2. bob の役割と禁止事項
3. 変更サマリ
4. 決定論的チェック結果
5. 要求・設計・テスト抜粋
6. コード差分
7. トレーサビリティ候補
8. 出力形式

## 16. 現行 runtime で必須のファイル

現行 runtime では以下を必須とする。

- `manifest.yaml`
- `input-normalized.json`
- `change-summary.md`
- `changed-files.json`
- `changed-symbols.json`
- `diff-context.md`
- `document-excerpts.md`
- `traceability-map.md`
- `deterministic-checks.md`
- `bob-input.md`

## 17. 生成失敗時の扱い

以下の場合は、bob 実行前に停止する。

- base/head が解決できない。
- 差分が取得できない。
- 必須文書が存在しない。
- 文書抽出に失敗した。
- evidence_id が重複している。
- bob-input.md が空になる。

以下の場合は警告として bob に渡してよい。

- 文書版数が不明。
- 関連テストが見つからない。
- 対応候補の confidence が low のみ。
- 静的解析が未実行。
