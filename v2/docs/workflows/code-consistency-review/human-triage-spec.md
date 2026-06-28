# 人間 triage 仕様案

## 1. 目的

人間 triage は、bob が出したプレレビュー結果を、人間が正式レビューに回すか、棄却するか、追加調査するかを判断する工程である。

bob の出力はそのまま正式指摘にしない。人間が根拠を確認し、必要に応じて修正してから正式レビューへ引き継ぐ。

## 2. triage の位置付け

```text
review-package 生成
  ↓
bob プレレビュー
  ↓
bob 出力のスキーマ検証
  ↓
人間 triage
  ↓
正式レビューへ引き継ぎ
```

## 3. triage の判断区分

| 区分 | 内容 | 次アクション |
|---|---|---|
| accept | 正式レビュー指摘として採用 | 指摘文を整えて正式レビューへ出す |
| ask_author | 作成者に事前確認 | 作成者へ質問する |
| investigate | 追加調査 | 関連コード・文書・ログを追加確認する |
| reject_false_positive | 誤検知として棄却 | 理由を記録する |
| out_of_scope | 今回対象外 | 対象外理由を記録する |
| defer | 後続対応へ回す | チケット化または別レビューへ引き継ぐ |

## 4. triage 入力

- bob-output.yaml
- bob-output.md
- review-package/manifest.yaml
- evidence-index.json
- deterministic-checks.md
- traceability-map.md
- 人間が追加で確認した資料

## 5. triage 出力

```text
.bob-review/
  human-triage/
    triage-result.yaml
    accepted-findings.md
    rejected-findings.md
    questions-to-author.md
    follow-up-actions.md
```

## 6. triage-result.yaml

```yaml
schema_version: 1
review_id: REVIEW-0001
triaged_by: user01
triaged_at: "2026-06-29T11:00:00+09:00"

items:
  - source_id: PRE-001
    decision: accept
    final_severity: high
    owner: reviewer
    reason: "REQ-123 と SRC-0001 の根拠があり、異常系処理の確認が必要なため。"
    review_comment: "REQ-123 の timeout 異常系に対して、実装が正常終了に合流しているように見えます。仕様どおり ERR_TIMEOUT を返す必要があるか確認してください。"
    follow_up:
      required: true
      action: "実装または詳細設計の修正"

  - source_id: Q-001
    decision: ask_author
    owner: author
    reason: "今回の修正範囲に timeout 条件が含まれるか判断できないため。"
    question: "timeout 条件は今回修正対象に含まれますか。含まれない場合、設計書上の扱いを確認してください。"

  - source_id: PRE-002
    decision: reject_false_positive
    owner: reviewer
    reason: "該当処理は今回変更前から存在し、今回差分による不整合ではないため。"
```

## 7. accept 時の確認ルール

bob 指摘を `accept` する前に、以下を確認する。

- evidence_id が実在する。
- ファイルパス、行番号、文書 ID が実在する。
- 指摘が今回の変更範囲に関係している。
- 指摘文が断定しすぎていない。
- 人間の正式レビュー指摘として伝わる文面になっている。
- 修正すべき対象がコードか文書かテストか明確になっている。

## 8. reject_false_positive 時の理由分類

| 理由分類 | 内容 |
|---|---|
| not_changed_area | 今回変更範囲ではない |
| evidence_mismatch | 根拠が指摘内容を支えていない |
| existing_behavior | 既存仕様どおり |
| document_old | 入力文書が古い |
| test_exists | 既にテストが存在する |
| duplicate | 他の指摘と重複 |
| ai_misread | bob の読み違い |

## 9. out_of_scope 時の理由分類

| 理由分類 | 内容 |
|---|---|
| customer_decision_pending | 顧客判断待ち |
| separate_ticket | 別チケットで対応 |
| future_phase | 後続フェーズ対応 |
| no_design_change_required | 設計更新不要と判断済み |
| no_test_change_required | テスト更新不要と判断済み |

## 10. accepted-findings.md

正式レビューに渡す指摘一覧。

```markdown
# 採用するプレレビュー指摘

## PRE-001 high

REQ-123 の timeout 異常系に対して、実装が正常終了に合流しているように見えます。
仕様どおり ERR_TIMEOUT を返す必要があるか確認してください。

- 根拠:
  - REQ-0001 REQ-123
  - SRC-0001 src/control/foo.c:112-172
- 対応候補:
  - 実装修正
  - 詳細設計修正
  - テストケース追加
```

## 11. questions-to-author.md

作成者への事前確認事項。

```markdown
# 作成者への確認事項

## Q-001

timeout 条件は今回修正対象に含まれますか。
含まれない場合、設計書上の扱いを確認してください。

- 根拠: REQ-123, ISSUE-123
- 回答希望: 正式レビュー前
```

## 12. follow-up-actions.md

後続対応に回す項目。

```markdown
# 後続対応

| source_id | action | owner | due | note |
|---|---|---|---|---|
| PRE-003 | テストケース追加検討 | test_owner | TBD | 境界値テストが不足している可能性 |
```

## 13. triage の完了条件

- bob の findings がすべて triage 済み。
- bob の questions がすべて triage 済み。
- accept した指摘に正式レビュー用文面がある。
- reject した指摘に理由がある。
- investigate / defer に owner または次アクションがある。
- triage-result.yaml が保存されている。

## 14. MVP 対応範囲

MVP では以下を実装対象とする。

- bob-output.yaml の読み込み
- finding / question の一覧表示
- decision の記録
- reason の記録
- accepted-findings.md の生成
- questions-to-author.md の生成
- triage-result.yaml の保存

GUI は必須ではない。まずは Markdown / YAML ベースで運用できればよい。
