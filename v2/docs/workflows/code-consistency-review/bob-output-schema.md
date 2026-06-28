# bob 出力 YAML スキーマ案

## 1. 目的

この文書は、コード変更と要求・設計整合プレレビューにおける bob の出力形式を定義する。

出力を YAML に固定し、後処理、PR 添付、人間 triage、監査ログ保存に使えるようにする。

## 2. 基本方針

- YAML の外に説明文を出さない。
- 指摘は根拠付きに限定する。
- 根拠が弱いものは `questions` に分ける。
- `severity` と `confidence` を分ける。
- bob が最終承認や合否判定をしないことをスキーマ上も明示する。

## 3. トップレベル構造

```yaml
schema_version: 1
review_summary:
  review_id: REVIEW-0001
  package_id: PACKAGE-0001
  target_range: "main..feature/fix-timeout"
  result_type: pre_review
  final_approval: not_performed
  scope_statement: "入力された review-package の範囲で確認したプレレビュー結果"

findings: []
questions: []
coverage_notes: []
rejected_or_uncertain: []
```

## 4. review_summary

| フィールド | 必須 | 内容 |
|---|---:|---|
| review_id | yes | review-input.yaml のレビュー ID |
| package_id | no | review-package の ID |
| target_range | yes | base..head |
| result_type | yes | 固定値 `pre_review` |
| final_approval | yes | 固定値 `not_performed` |
| scope_statement | yes | 確認範囲の説明 |
| generated_at | no | bob 出力日時 |
| prompt_template_id | no | 使用したプロンプト ID |

## 5. findings

根拠付きの指摘候補を列挙する。

```yaml
findings:
  - id: PRE-001
    category: requirement-code-consistency
    severity: high
    confidence: medium
    summary: "REQ-123 の timeout 異常系に対する実装が不足している可能性がある"
    evidence:
      - evidence_id: REQ-0001
        type: requirement
        ref: "REQ-123"
      - evidence_id: SRC-0001
        type: code
        ref: "src/control/foo.c:112-172"
    reason: "要求では timeout 時に ERR_TIMEOUT を返すと記載されているが、変更後コードでは正常終了に合流しているように見える。"
    impact: "timeout 時の上位通知が正常扱いとなり、要求された異常処理が行われない可能性がある。"
    recommended_action: "timeout 分岐の期待動作を確認し、実装または詳細設計を修正する。"
    human_check: "REQ-123 の timeout 条件が今回変更対象か、設計担当者が確認する。"
```

### 5.1 category

| 値 | 内容 |
|---|---|
| requirement-code-consistency | 要求とコードの不整合候補 |
| design-code-consistency | 設計とコードの不整合候補 |
| test-gap | テスト観点不足候補 |
| document-update-gap | 文書・台帳更新漏れ候補 |
| unintended-change | 要求外変更候補 |
| interface-impact | 外部 I/F 影響候補 |
| rt-ts-rule | RT / TS ルール違反候補 |
| shared-memory-impact | 共有メモリ影響候補 |
| risk | その他の影響リスク |

### 5.2 severity

| 値 | 意味 |
|---|---|
| critical | 安全性、外部 I/F 破壊、本番障害、要求未達につながる可能性が高い |
| high | 要求・設計との明確な不整合、異常系欠落、テスト不足が強く疑われる |
| medium | 仕様解釈、設計追随、影響範囲の確認が必要 |
| low | 軽微な文書追随、表記ゆれ、改善提案 |
| info | 補助情報、確認メモ |

### 5.3 confidence

| 値 | 意味 |
|---|---|
| high | 複数の根拠が一致している、または明示 ID による対応がある |
| medium | 根拠はあるが、解釈や追加確認が必要 |
| low | 関連候補はあるが、根拠が弱い |

## 6. questions

根拠不足または仕様判断が必要なものを列挙する。

```yaml
questions:
  - id: Q-001
    category: specification-clarification
    summary: "timeout 条件が今回の変更対象に含まれるか確認が必要"
    reason: "REQ-123 と SRC-0001 は関連しているように見えるが、チケット本文では timeout 条件が明示されていない。"
    evidence:
      - evidence_id: REQ-0001
        type: requirement
        ref: "REQ-123"
      - evidence_id: TICKET-0001
        type: ticket
        ref: "ISSUE-123"
    suggested_owner: design_owner
    suggested_action: "要求担当または設計担当に確認する。"
```

### 6.1 question category

| 値 | 内容 |
|---|---|
| specification-clarification | 仕様確認 |
| scope-clarification | 今回対象範囲の確認 |
| document-version | 文書版数確認 |
| missing-evidence | 根拠不足 |
| test-policy | テスト方針確認 |
| owner-decision | 担当者判断が必要 |

## 7. coverage_notes

確認できた範囲、確認できなかった範囲を明示する。

```yaml
coverage_notes:
  - id: COV-001
    type: checked
    summary: "REQ-123、DD-88、SRC-0001、TC-789 の対応関係を確認対象に含めた。"
  - id: COV-002
    type: not_checked
    summary: "性能影響は入力に測定結果がないため確認していない。"
```

### 7.1 type

| 値 | 内容 |
|---|---|
| checked | 入力範囲で確認した |
| partially_checked | 一部のみ確認した |
| not_checked | 入力不足または対象外のため確認していない |
| out_of_scope | 明示的に対象外 |

## 8. rejected_or_uncertain

bob が finding として出さなかったもの、判断を保留したものを記録する。

```yaml
rejected_or_uncertain:
  - id: UNC-001
    summary: "性能劣化の可能性"
    reason: "コード差分から懸念はあるが、性能測定結果が入力されていないため判断不能。"
    next_action: "性能観点が必要な場合は測定結果を追加する。"
```

## 9. バリデーションルール

### 9.1 エラーにする条件

- YAML として解析できない。
- `review_summary.final_approval` が `not_performed` 以外。
- `findings` が配列ではない。
- finding に `evidence` がない。
- finding に `human_check` がない。
- `severity` が定義外。
- `confidence` が定義外。
- YAML 外に本文がある。

### 9.2 警告にする条件

- `findings` が 30 件を超える。
- `questions` が 30 件を超える。
- `confidence: low` の finding が多い。
- evidence_id が evidence-index.json に存在しない。
- 同じ evidence_id に同種カテゴリの指摘が重複している。

## 10. 後処理方針

拡張機能は bob 出力を受け取った後、以下を行う。

- YAML 構文チェック
- スキーマチェック
- evidence_id の存在チェック
- ファイルパスと行範囲の存在チェック
- 重複指摘の統合候補作成
- severity / confidence の一覧化
- 人間 triage 用 Markdown 生成

## 11. 人間向け表示形式

YAML は保存用とし、人間には次のような Markdown に変換して見せる。

```markdown
## PRE-001 high / confidence: medium

REQ-123 の timeout 異常系に対する実装が不足している可能性がある。

- category: requirement-code-consistency
- evidence:
  - REQ-0001 REQ-123
  - SRC-0001 src/control/foo.c:112-172
- impact: timeout 時の上位通知が正常扱いとなる可能性
- recommended_action: 実装または詳細設計を確認する
- human_check: 設計担当者が timeout 条件を確認する
```

## 12. MVP 対応範囲

MVP では以下を必須とする。

- `review_summary`
- `findings`
- `questions`
- `coverage_notes`
- `rejected_or_uncertain`
- finding の evidence 必須化
- `final_approval: not_performed` の固定
