# review-input.yaml スキーマ案

## 1. 目的

`review-input.yaml` は、コード変更と要求・設計・テスト文書の整合プレレビューを実行するための入口ファイルである。

拡張機能はこのファイルを読み取り、対象コミット、関連チケット、関連文書、重点確認観点を確定し、bob 投入用の `review-package` を生成する。

## 2. 設計方針

- 人間が手で書ける程度に単純にする。
- 自動補完できる項目は任意にする。
- 後工程で根拠追跡できるよう、文書パス、版数、セクション ID を保持する。
- bob に直接解釈させるのではなく、拡張機能が正規化してから渡す。
- 未確定情報は空欄ではなく `unknown` または `todo` として明示する。

## 3. 最小構成

```yaml
schema_version: 1

review:
  id: REVIEW-0001
  title: "timeout 異常系処理の修正"
  change_type: bugfix
  purpose: "timeout 時に正しいエラーを返すようにする"
  base: main
  head: feature/fix-timeout
  ticket_ids:
    - ISSUE-123

artifacts:
  requirements:
    - path: docs/requirements/REQ-001.docx
      version: "1.2"
      sections:
        - REQ-123
  basic_design:
    - path: docs/design/basic/BD-010.docx
      version: "2.0"
      sections:
        - BD-45
  detailed_design:
    - path: docs/design/detail/DD-020.xlsx
      version: "1.7"
      sheets:
        - timeout
      sections:
        - DD-88
  test_spec:
    - path: docs/test/FT-030.xlsx
      version: "1.1"
      cases:
        - TC-789

review_focus:
  - requirement-code-consistency
  - design-code-consistency
  - test-gap
```

## 4. フィールド定義

### 4.1 schema_version

| 項目 | 内容 |
|---|---|
| 必須 | yes |
| 型 | integer |
| 例 | `1` |
| 用途 | スキーマ変更時の互換性判断 |

### 4.2 review

| フィールド | 必須 | 型 | 内容 |
|---|---:|---|---|
| id | yes | string | プレレビュー実行単位の ID |
| title | yes | string | レビュー名 |
| change_type | yes | enum | `bugfix` / `feature` / `spec_change` / `refactor` / `performance` / `maintenance` |
| purpose | yes | string | 変更目的 |
| base | yes | string | 比較元ブランチまたはコミット |
| head | yes | string | 比較先ブランチまたはコミット |
| ticket_ids | no | string[] | 関連チケット ID |
| author_note | no | string | 作成者からの補足 |
| out_of_scope | no | string[] | 今回対象外にする内容 |

### 4.3 artifacts

文書種別ごとに、レビュー対象の文書を列挙する。

| 種別 | 内容 |
|---|---|
| requirements | 要求書 |
| basic_design | 基本設計書 |
| detailed_design | 詳細設計書 |
| test_spec | 機能テスト仕様書 |
| ledgers | I/F 台帳、エラー台帳、メッセージ台帳など |
| tickets | チケット本文や補足資料 |

各文書の共通フィールドは以下とする。

| フィールド | 必須 | 型 | 内容 |
|---|---:|---|---|
| path | yes | string | リポジトリ内またはローカルの文書パス |
| version | no | string | 文書版数。未確認なら `unknown` |
| updated_at | no | string | 更新日 |
| sections | no | string[] | 章、節、要求 ID、設計 ID |
| sheets | no | string[] | Excel の対象シート |
| rows | no | string[] | Excel 台帳の対象行 ID |
| cases | no | string[] | テストケース ID |
| note | no | string | 補足 |

### 4.4 review_focus

bob に重点的に見せる観点を指定する。

| 値 | 内容 |
|---|---|
| requirement-code-consistency | 要求とコードの整合 |
| design-code-consistency | 設計とコードの整合 |
| test-gap | テスト不足 |
| document-update-gap | 文書更新漏れ |
| unintended-change | 要求外変更 |
| interface-impact | 外部 I/F 影響 |
| rt-ts-rule | RT / TS ルール違反 |
| shared-memory-impact | 共有メモリ影響 |

## 5. 任意の詳細設定

```yaml
analysis_options:
  include_callers: true
  include_callees: true
  include_global_access: true
  include_struct_impact: true
  include_ledgers: true
  max_call_depth: 2
  max_code_context_lines: 80
  language:
    - c
    - cpp

bob_options:
  prompt_template: consistency-review-v1
  output_format: yaml
  require_evidence: true
  allow_questions: true
  forbid_final_approval: true
```

## 6. バリデーションルール

### 6.1 エラーにする条件

- `schema_version` が未指定。
- `review.base` または `review.head` が未指定。
- `review.change_type` が定義外。
- `artifacts` が空。
- 指定された文書パスが存在しない。
- `review_focus` が定義外。

### 6.2 警告にする条件

- 文書版数が `unknown`。
- 要求書はあるが詳細設計書がない。
- コード変更があるがテスト仕様書がない。
- 外部 I/F 変更候補があるが台帳が指定されていない。
- 共有メモリ変更候補があるが関連設計書が指定されていない。

## 7. 正規化後の内部表現

拡張機能は `review-input.yaml` を読み込み、以下のような正規化済み JSON を作る。

```json
{
  "schema_version": 1,
  "review": {
    "id": "REVIEW-0001",
    "base": "main",
    "head": "feature/fix-timeout",
    "change_type": "bugfix"
  },
  "documents": [
    {
      "artifact_type": "requirements",
      "path": "docs/requirements/REQ-001.docx",
      "version": "1.2",
      "selectors": {
        "sections": ["REQ-123"]
      }
    }
  ]
}
```

## 8. MVP で対応する範囲

MVP では以下までを必須とする。

- `schema_version`
- `review.id`
- `review.title`
- `review.change_type`
- `review.purpose`
- `review.base`
- `review.head`
- `artifacts.requirements`
- `artifacts.basic_design`
- `artifacts.detailed_design`
- `artifacts.test_spec`
- `review_focus`

`analysis_options` と `bob_options` は MVP では既定値でもよい。
