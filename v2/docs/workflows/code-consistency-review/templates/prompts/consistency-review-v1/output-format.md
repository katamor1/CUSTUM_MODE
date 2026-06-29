出力は YAML のみとしてください。
説明文、前置き、まとめ文、Markdown コードフェンスを YAML の外に書かないでください。

必ず次のトップレベルキーだけを出力してください。

- schema_version
- review_summary
- findings
- questions
- coverage_notes
- rejected_or_uncertain

schema_version は文字列ではなく整数 `1` にしてください。`"1.0"` や `1.0` は使用しないでください。

review_summary は次のキーだけを使用してください。

- review_id
- package_id
- target_range
- result_type
- final_approval
- scope_statement
- generated_at
- prompt_template_id

review_summary.result_type は必ず `pre_review`、review_summary.final_approval は必ず `not_performed` にしてください。
review_summary に title、finding_count、question_count、note などの追加キーを入れないでください。
あなたは最終承認、マージ可否、リリース可否、品質保証上の合否を判断してはいけません。

findings がない場合も、空配列 `findings: []` を出力してください。
questions がない場合も、空配列 `questions: []` を出力してください。
coverage_notes と rejected_or_uncertain も、該当がない場合は空配列にしてください。

各 finding の id は `PRE-001`, `PRE-002` の形式にしてください。`FIND-001` は使用しないでください。
各 question の id は `Q-001`, `Q-002` の形式にしてください。
各 coverage_note の id は `COV-001`, `COV-002` の形式にしてください。
各 rejected_or_uncertain の id は `UNC-001`, `UNC-002` の形式にしてください。

evidence は文字列配列ではありません。必ず object 配列にしてください。
各 evidence object には `type` と `ref` を必ず含め、review-package の evidence_id がある場合は `evidence_id` も含めてください。

evidence.type に使用できる値:

- requirement
- basic_design
- detailed_design
- test_spec
- ledger
- ticket
- code
- check_result

finding.category に使用できる値:

- requirement-code-consistency
- design-code-consistency
- test-gap
- document-update-gap
- unintended-change
- interface-impact
- rt-ts-rule
- shared-memory-impact
- risk

question.category に使用できる値:

- specification-clarification
- scope-clarification
- document-version
- missing-evidence
- test-policy
- owner-decision

severity に使用できる値:

- critical
- high
- medium
- low
- info

confidence に使用できる値:

- high
- medium
- low

coverage_notes.type に使用できる値:

- checked
- partially_checked
- not_checked
- out_of_scope

次の YAML skeleton と同じキー構造、型、ID prefix を使ってください。
値は review-package の内容に合わせて置き換えてください。

```yaml
schema_version: 1
review_summary:
  review_id: REVIEW-0001
  package_id: PACKAGE-0001
  target_range: main..feature/example
  result_type: pre_review
  final_approval: not_performed
  scope_statement: 入力された review-package の範囲で確認したプレレビュー結果。
  generated_at: "2026-06-30T00:00:00Z"
  prompt_template_id: consistency-review-v1
findings:
  - id: PRE-001
    category: requirement-code-consistency
    severity: high
    confidence: high
    summary: 指摘の要約を書く。
    evidence:
      - evidence_id: REQ-0001
        type: requirement
        ref: REQ-123
      - evidence_id: SRC-0001
        type: code
        ref: src/example.c:10-20
    reason: 根拠に基づく理由を書く。
    impact: 影響を書く。
    recommended_action: 推奨アクションを書く。
    human_check: 人間が確認すべき事項を書く。
questions:
  - id: Q-001
    category: document-version
    summary: 確認質問の要約を書く。
    reason: 判断に不足している情報を書く。
    evidence:
      - evidence_id: REQ-0001
        type: requirement
        ref: REQ-123
    suggested_owner: design_owner
    suggested_action: 確認すべきアクションを書く。
coverage_notes:
  - id: COV-001
    type: checked
    summary: 入力範囲で確認した項目を書く。
  - id: COV-002
    type: out_of_scope
    summary: review-input で対象外とされた項目を書く。
rejected_or_uncertain:
  - id: UNC-001
    summary: finding として採用しなかった項目を書く。
    reason: 採用しなかった理由、または判断不能な理由を書く。
    next_action: 必要な次アクションを書く。
```

上記 skeleton のキー以外を追加しないでください。
finding、question、coverage_note、rejected_or_uncertain の各 item にも、上記で示したキー以外を追加しないでください。
