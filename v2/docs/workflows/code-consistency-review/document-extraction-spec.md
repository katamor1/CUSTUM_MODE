# 文書抽出仕様案

## 1. 目的

この文書は、要求書・基本設計書・詳細設計書・機能テスト仕様書・各種台帳を、bob 投入前に拡張機能で抽出・正規化するための仕様を定義する。

bob に文書全体を丸投げせず、関連箇所、版数、セクション ID、表構造、根拠 ID を付与したうえで `review-package` に格納する。

## 2. 対象文書

| 種別 | 例 | MVP |
|---|---|---:|
| Word 要求書 | `.docx` | yes |
| Word 基本設計書 | `.docx` | yes |
| Word 詳細設計書 | `.docx` | yes |
| Excel 詳細設計書 | `.xlsx` | yes |
| Excel 機能テスト仕様書 | `.xlsx` | yes |
| Excel 台帳 | I/F、API、ファイル、エラー、メッセージ | yes |
| Markdown 文書 | `.md` | yes |
| PDF | `.pdf` | later |
| 古い Word / Excel | `.doc` / `.xls` | later |

## 3. 抽出方針

- 文書全体を単なるプレーンテキストにしない。
- 章、節、表、行、列、セル位置を保持する。
- 要求 ID、設計 ID、テスト ID、台帳 ID を抽出する。
- 抽出元の文書パス、版数、更新日を保持する。
- bob が参照できる evidence_id を付与する。
- 表は Markdown 表と JSON の両方で保持する。

## 4. 共通メタデータ

各文書から以下を抽出する。

```json
{
  "document_id": "DOC-REQ-001",
  "path": "docs/requirements/REQ-001.docx",
  "type": "requirements",
  "version": "1.2",
  "updated_at": "2026-06-01",
  "title": "timeout 制御要求書",
  "source_hash": "sha256:...",
  "extraction_status": "success"
}
```

## 5. Word 抽出

### 5.1 抽出対象

- 見出し
- 段落
- 箇条書き
- 表
- 図表キャプション
- ヘッダ・フッタの版数情報
- 文書プロパティ

### 5.2 Word の出力単位

```json
{
  "chunks": [
    {
      "evidence_id": "REQ-0001",
      "document_id": "DOC-REQ-001",
      "type": "paragraph",
      "section_id": "REQ-123",
      "heading_path": ["4. 異常系", "4.2 timeout"],
      "text": "timeout が発生した場合、ERR_TIMEOUT を返す。"
    }
  ]
}
```

### 5.3 Word 表

```json
{
  "tables": [
    {
      "evidence_id": "REQ-TABLE-0001",
      "document_id": "DOC-REQ-001",
      "caption": "エラーコード一覧",
      "section_id": "REQ-ERR",
      "headers": ["エラー", "条件", "戻り値"],
      "rows": [
        ["timeout", "応答なし", "ERR_TIMEOUT"]
      ]
    }
  ]
}
```

## 6. Excel 抽出

### 6.1 抽出対象

- シート名
- 使用範囲
- ヘッダ行
- 表データ
- セル結合情報
- フィルタ状態
- 非表示行・列
- コメント
- セルの値と表示文字列

### 6.2 Excel の出力単位

```json
{
  "sheets": [
    {
      "sheet_id": "SHEET-0001",
      "name": "timeout",
      "used_range": "A1:H120",
      "tables": [
        {
          "evidence_id": "DD-TABLE-0001",
          "header_row": 3,
          "rows": [
            {
              "row_id": "DD-88",
              "excel_row": 24,
              "values": {
                "条件": "timeout 発生",
                "処理": "ERR_TIMEOUT を返す",
                "備考": "上位へ異常通知"
              }
            }
          ]
        }
      ]
    }
  ]
}
```

### 6.3 セル結合の扱い

- 結合セルは代表セルの値を展開して保持する。
- 元の結合範囲も保持する。
- bob には展開後の表を渡す。
- 監査用には元セル位置を残す。

## 7. Markdown 抽出

### 7.1 抽出対象

- 見出し
- 段落
- 箇条書き
- 表
- コードブロック
- HTML コメント内の ID

### 7.2 方針

Markdown は章構造を保持し、見出しパスごとに chunk 化する。

## 8. ID 抽出ルール

### 8.1 抽出対象 ID

| ID 種別 | 例 |
|---|---|
| 要求 ID | `REQ-123` |
| 基本設計 ID | `BD-45` |
| 詳細設計 ID | `DD-88` |
| テストケース ID | `TC-789` |
| エラー ID | `ERR_TIMEOUT` |
| メッセージ ID | `MSG-001` |
| I/F ID | `IF-ABC-001` |
| チケット ID | `ISSUE-123` |

### 8.2 ID 抽出結果

```json
{
  "ids": [
    {
      "id": "REQ-123",
      "id_type": "requirement",
      "evidence_id": "REQ-0001",
      "document_id": "DOC-REQ-001",
      "location": "section 4.2"
    }
  ]
}
```

## 9. 関連文書候補の抽出

`review-input.yaml` で明示された文書を優先する。

追加候補として以下を検索する。

- 変更関数名
- 構造体名
- define 名
- エラーコード
- メッセージ ID
- I/F 名
- 要求 ID / 設計 ID / テスト ID
- チケット ID

候補は `candidate` として扱い、bob に確定根拠として渡さない。

## 10. evidence_id の採番

| 種別 | prefix |
|---|---|
| 要求 | REQ |
| 基本設計 | BD |
| 詳細設計 | DD |
| テスト | TC |
| 台帳 | LEDGER |
| チケット | TICKET |
| コード | SRC |

例:

```text
REQ-0001
BD-0001
DD-0001
TC-0001
LEDGER-0001
```

## 11. bob に渡す Markdown 形式

```markdown
## REQ-0001

- document: docs/requirements/REQ-001.docx
- version: 1.2
- section: REQ-123
- type: requirement

要求本文...

## DD-0001

- document: docs/design/detail/DD-020.xlsx
- version: 1.7
- sheet: timeout
- row: 24
- type: detailed_design

| 条件 | 処理 | 備考 |
|---|---|---|
| timeout 発生 | ERR_TIMEOUT を返す | 上位へ異常通知 |
```

## 12. 失敗時の扱い

### 12.1 エラー

- 文書ファイルが存在しない。
- 対応形式だが読み込みに失敗した。
- 必須文書の抽出結果が空。
- evidence_id が重複した。

### 12.2 警告

- 版数が抽出できない。
- 非表示シートに関連候補がある。
- 結合セルが多く、表構造の推定が不安定。
- ID が抽出できない。
- 古い文書形式で自動抽出できない。

## 13. MVP 完了条件

- `.docx` から見出し、段落、表を抽出できる。
- `.xlsx` からシート、表、行、セルを抽出できる。
- `.md` から見出し、本文、表を抽出できる。
- 要求 ID、設計 ID、テスト ID を抽出できる。
- 抽出結果に evidence_id を付与できる。
- `document-index.json` と `document-excerpts.md` を生成できる。
