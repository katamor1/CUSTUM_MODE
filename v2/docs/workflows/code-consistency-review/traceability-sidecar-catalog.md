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
QA-<元文書ID>-<領域>-0001
RV-<元文書ID>-<領域>-0001
```

例:

```text
REQ-RS001-PAY-0001
BD-BD001-PAY-0001
DD-DD001-PAY-0001
TC-TS001-PAY-0001
QA-QA001-PAY-0001
RV-RV001-PAY-0001
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
    },
    {
      "proposed_id": "QA-QA001-PAY-0001",
      "id": "QA-QA001-PAY-0001",
      "type": "qa_item",
      "source_document_id": "QA001",
      "domain": "PAY",
      "sequence": 1,
      "source_path": "docs/qa-payment.xlsx",
      "status": "accepted",
      "qa": {
        "question": "決済ステータスは要求に定義されているか",
        "answer": "REQ-RS001-PAY-0001 で定義済み",
        "status": "closed"
      }
    },
    {
      "proposed_id": "RV-RV001-PAY-0001",
      "id": "RV-RV001-PAY-0001",
      "type": "review_finding",
      "source_document_id": "RV001",
      "domain": "PAY",
      "sequence": 1,
      "source_path": "docs/review-findings.xlsx",
      "status": "accepted",
      "review": {
        "severity": "major",
        "action_plan": "要求IDとの対応を確認する",
        "status": "closed"
      }
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
| `clarifies` | `QA -> REQ/BD/DD/TC/RV` |
| `reviewed_by` | `REQ/BD/DD/TC/QA -> RV` |
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
- accepted QA item に accepted `clarifies` link がない。
- accepted review finding に accepted `reviewed_by` link がない、または未対応状態のまま。

warning:

- proposed item / proposed link / proposed decision が残っている。
- AI 候補はあるが未承認。
- source anchor hash が変わって stale の疑いがある。
- 既存文書IDを抽出できず `DOC0001` 形式を使っている。
- QA が回答済みだが close されていない。

## 8. review-input.yaml 生成との統合

sidecar catalog がある場合、`review-input.yaml` は catalog の accepted item から `ReviewInputDraft` を生成してから、既存 `ReviewInputBuilder` と schema validator に通す。

対応関係:

| item type | review-input artifact |
|---|---|
| `requirement` | `artifacts.requirements[].sections` |
| `basic_design` | `artifacts.basic_design[].sections` |
| `detailed_design` | `artifacts.detailed_design[].sections` |
| `test_spec` | `artifacts.test_spec[].cases` |
| `qa_item` | `artifacts.ledgers[].rows` |
| `review_finding` | `artifacts.tickets[].rows` |

この設計により、人間は `review-input.yaml` を手で組み立てる代わりに、traceability catalog の承認状態を整える。`bob-code-consistency-review` は catalog を下流のレビュー対象へ変換する。

## 9. 実装済み command

VS Code 拡張 `local.bob-code-consistency-review` では、次の command を提供する。

| command | 用途 |
|---|---|
| `bobCodeConsistency.prepareAiTraceabilityDraft` | 仕様書候補、既存catalog、diff summaryからAI draft用promptを作る |
| `bobCodeConsistency.applyAiTraceabilityDraft` | AI JSONを proposed-only として検証し、sidecar catalogへmergeする |
| `bobCodeConsistency.openTraceabilityPrep` | Webviewで domain/item/link/decision を承認、棄却、廃止する |
| `bobCodeConsistency.validateTraceabilityCatalog` | gate report Markdownを生成する |
| `bobCodeConsistency.createReviewInputFromTraceability` | accepted catalog itemから `review-input.yaml` を生成する |

既存の `createReviewInput`、`prepareAiReviewInputDraft`、`applyAiReviewInputDraft` は catalog 未整備案件の fallback として残す。

## 10. Webview 承認

`openTraceabilityPrep` は `.bob-trace/traceability-catalog.json` を読み込み、次のタブで候補を確認する。

- Domains
- Items
- Links
- Decisions
- Gate Report
- Review Input Preview

承認操作はまず Webview の作業状態へ反映される。`Save` を押すと既存 catalog の backup を作成してから保存し、`.bob-trace/gate-report.md` を再生成する。
