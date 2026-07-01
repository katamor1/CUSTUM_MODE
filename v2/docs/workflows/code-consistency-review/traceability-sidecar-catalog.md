# Traceability Sidecar Catalog 方式

## 1. 目的

`bob-code-consistency-review` の `review-input.yaml` 作成支援は、単独の入力補助ではなく、上流工程の自然言語仕様書を追跡可能な単位へ正規化する仕組みの下流アダプタとして扱う。

初期実装では元文書を変更しない。AI が仕様単位、ID、領域、工程間リンクを候補生成し、人間が承認した内容だけを `.bob-trace` 配下の sidecar catalog に保存する。`review-input.yaml` は、その catalog からレビュー対象に必要な artifact 参照を生成する。

## 2. 全体フロー

```text
自然言語仕様書
  -> AI が仕様単位、ID候補、領域候補、リンク候補を生成
  -> 人間が候補を承認 / 修正 / 棄却
  -> .bob-trace の catalog / links / decisions を更新
  -> traceability gate が欠落、未承認、stale を検出
  -> accepted item から ReviewInputDraft を生成
  -> ReviewInputBuilder / schema validator で review-input.yaml を生成
  -> bob-code-consistency-review がコード差分と仕様根拠を照合
```

既存の `createReviewInput`、`prepareAiReviewInputDraft`、`applyAiReviewInputDraft` は廃止せず、catalog が未整備の案件向け補助として残す。catalog がある案件では、sidecar catalog を正式な入力源にする。

## 3. ID 形式

ID は工程別 prefix を固定する。

```text
REQ-<元文書ID>-<領域>-0001
BD-<元文書ID>-<領域>-0001
DD-<元文書ID>-<領域>-0001
TC-<元文書ID>-<領域>-0001
```

例:

```text
REQ-RS001-PAY-0001
BD-BD001-PAY-0001
DD-DD001-PAY-0001
TC-TS001-PAY-0001
```

`<元文書ID>` は文書内の管理番号を優先する。抽出できない場合は sidecar 側で `DOC0001` のように採番し、document registry に `id_source: sidecar-generated` として残す。

`<領域>` は AI が候補生成し、人間が承認する。`accepted` でない domain を使った accepted item は gate error にする。

## 4. proposed / accepted 境界

AI は正式 ID を直接確定しない。AI 段階では `proposed_id` を持ち、人間承認後に `id` へ昇格する。

```json
{
  "proposed_id": "REQ-RS001-PAY-0001",
  "id": null,
  "status": "proposed"
}
```

承認後:

```json
{
  "proposed_id": "REQ-RS001-PAY-0001",
  "id": "REQ-RS001-PAY-0001",
  "status": "accepted"
}
```

一度 `accepted` になった ID は再採番しない。削除、棄却、廃止による欠番は許容し、監査性を優先する。

## 5. sidecar catalog の形

初期実装では、1つの catalog object に document、domain、item、link、decision を保持できる形を標準とする。ファイル分割は運用上必要になった時点で行う。

```json
{
  "schema_version": 1,
  "documents": [
    {
      "document_id": "RS001",
      "source_path": "docs/requirements-payment.md",
      "id_source": "extracted"
    }
  ],
  "domains": [
    {
      "code": "PAY",
      "label": "決済",
      "status": "accepted"
    }
  ],
  "items": [
    {
      "proposed_id": "REQ-RS001-PAY-0001",
      "id": "REQ-RS001-PAY-0001",
      "type": "requirement",
      "source_document_id": "RS001",
      "domain": "PAY",
      "sequence": 1,
      "source_path": "docs/requirements-payment.md",
      "status": "accepted"
    }
  ],
  "links": [],
  "decisions": []
}
```

## 6. リンクと n/a decision

リンクも AI 候補から人間承認へ昇格する。

```yaml
links:
  - proposed_from: REQ-RS001-PAY-0001
    proposed_to: BD-BD001-PAY-0001
    link_type: satisfies
    status: proposed
```

承認後:

```yaml
links:
  - from: REQ-RS001-PAY-0001
    to: BD-BD001-PAY-0001
    link_type: satisfies
    status: accepted
```

初期リンク種別:

| link_type | 用途 |
|---|---|
| `satisfies` | `REQ -> BD` |
| `elaborates` | `BD -> DD` |
| `verified_by` | `REQ/DD -> TC` |
| `references` | 補助参照 |

対応不要な場合は missing を消すのではなく、理由付きの accepted decision として残す。

```yaml
decisions:
  - subject: REQ-RS001-PAY-0008
    gate: basic_design
    decision: n/a
    reason: 文言修正のみで設計変更を伴わない
    status: accepted
```

## 7. Gate 判定

Gate は `accepted item` と `accepted link` または `accepted n/a decision` だけで判定する。

error:

- accepted item に必要な accepted link / accepted n/a がない。
- accepted item が未承認 domain を使っている。
- ID が重複している。
- source document が document registry に存在しない。
- accepted link の `from` / `to` が accepted item ではない。

warning:

- proposed item / proposed link / proposed decision が残っている。
- AI 候補はあるが未承認。
- source anchor hash が変わって stale の疑いがある。
- 既存文書IDを抽出できず `DOC0001` 形式を使っている。

## 8. review-input.yaml 生成との統合

sidecar catalog がある場合、`review-input.yaml` は catalog の accepted item から `ReviewInputDraft` を生成してから、既存 `ReviewInputBuilder` と schema validator に通す。

対応関係:

| item type | review-input artifact |
|---|---|
| `requirement` | `artifacts.requirements[].sections` |
| `basic_design` | `artifacts.basic_design[].sections` |
| `detailed_design` | `artifacts.detailed_design[].sections` |
| `test_spec` | `artifacts.test_spec[].cases` |

この設計により、人間は `review-input.yaml` を手で組み立てる代わりに、traceability catalog の承認状態を整える。`bob-code-consistency-review` は catalog を下流のレビュー対象へ変換する。

## 9. 初期実装範囲

初期実装では次を行う。

- sidecar catalog の TypeScript 型を定義する。
- ID、domain、document、link、decision、gate 欠落を検証する。
- gate report Markdown を生成する。
- accepted catalog item から `ReviewInputDraft` を生成する。
- 既存の `ReviewInputBuilder` / validator に接続できる API を提供する。

次段では次を追加する。

- catalog をファイルから読み書きする command。
- AI catalog draft prompt。
- 人間承認 UI。
- `review-input.yaml` 生成 command の catalog 入力対応。
