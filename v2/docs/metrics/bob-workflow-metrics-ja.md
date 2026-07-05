# Bob Workflow Metrics

- 対象: Phase 0 以降の Bob workflow 運用
- 目的: workflow が安全に、再現性を持って、レビュー品質を上げているかを継続確認する。
- 集計単位: workspace、workflow、run、extension release

## 1. Metric 方針

Phase 0 の metrics は、個人評価ではなく運用改善に使う。Bob 出力や task snapshot の本文を集計対象にせず、必要最小限の metadata と outcome のみを扱う。

## 2. Run Metrics

| metric | 定義 | source | 頻度 |
|---|---|---|---|
| workflow_run_count | workflow run 数 | `.bob/workflows/runs/<runId>/run.json` | daily / weekly |
| workflow_success_rate | `completed / total` | run state | weekly |
| workflow_review_hold_rate | review / manual hold が発生した run 比率 | run state | weekly |
| workflow_retry_count | step retry 数 | run state | weekly |
| workflow_resume_count | paused / recoverable run の resume 数 | run state | weekly |
| workflow_failure_top_reason | 失敗 reason の上位 | run diagnostics | weekly |

記録テンプレート:

| period | workflow | runs | completed | failed | held | retries | resumes | top_failure |
|---|---|---:|---:|---:|---:|---:|---:|---|
| | | | | | | | | |

## 3. Review Quality Metrics

| metric | 定義 | source | 頻度 |
|---|---|---|---|
| bazaar_packet_count | Bazaar review packet 作成数 | `.bob/review/` metadata | weekly |
| bazaar_result_capture_count | review-result capture 成功数 | `.bob/review/results/` | weekly |
| bazaar_result_validation_failure | review-result validation 失敗数 | command result / logs | weekly |
| code_review_package_count | code consistency review package 生成数 | `.bob-review/review-package` | weekly |
| bob_output_capture_count | Bob output capture 成功数 | `.bob-review/bob-output` | weekly |
| triage_item_count | triage item 数 | `.bob-review/human-triage/triage-result.yaml` | weekly |
| traceability_gate_error_count | traceability gate error 数 | `.bob-trace/gate-report.md` | weekly |

記録テンプレート:

| period | workspace | bazaar_packets | result_captures | validation_failures | review_packages | bob_outputs | triage_items | gate_errors |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| | | | | | | | | |

## 4. Safety Metrics

| metric | 定義 | source | 目標 |
|---|---|---|---|
| blocked_command_count | command guardrail による拒否件数 | workflow error | unexpected 0, expected tests only |
| path_guard_rejection_count | absolute / `..` / wrong area / symlink escape 拒否件数 | command error | unexpected 0 |
| mcp_root_rejection_count | allowed root 外 MCP 操作拒否件数 | MCP log | unexpected 0 |
| revision_validation_failure | unsafe revision 拒否件数 | VCS command error | unexpected 0 |
| privacy_override_count | task snapshot messages 有効化回数 | settings / run metadata | approved only |

記録テンプレート:

| period | workspace | blocked_commands | path_rejections | mcp_rejections | revision_rejections | privacy_overrides | notes |
|---|---|---:|---:|---:|---:|---:|---|
| | | | | | | | |

## 5. Package Metrics

| metric | 定義 | source | 頻度 |
|---|---|---|---|
| test_count | `npm.cmd test` の test 数 | test output | release |
| package_size_bytes | VSIX size | package output | release |
| package_policy_status | `package:policy` 結果 | command output | release |
| dependency_audit_status | production audit 結果 | CI / local command | release |
| release_rebuild_time | clean install から package 完了まで | operator record | release |

記録テンプレート:

| release | extension | tests | package_size_bytes | package_policy | audit | rebuild_minutes | notes |
|---|---|---:|---:|---|---|---:|---|
| | workflow-register | | | | | | |
| | bob-bazaar-review | | | | | | |
| | bob-code-consistency-review | | | | | | |

## 6. Outcome Semantics

| outcome | 意味 |
|---|---|
| `ok` | 想定どおり成功した。 |
| `ng` | 不具合、運用ミス、または期待と異なる結果。follow-up 必須。 |
| `n/a` | 実施対象外。理由を記録する。 |
| `question` | 判断保留。owner と期限を記録する。 |

## 7. Privacy Rules for Metrics

記録してよいもの:

- workflow ID
- run status
- artifact relative path
- test count
- package size
- validation error category
- triage item count

記録しないもの:

- Bob chat message body
- source code excerpt
- customer specification body
- raw diff body
- clipboard content
- personal access token, API key, password

## 8. Weekly Review Template

| week | owner | summary |
|---|---|---|
| | | |

| metric group | status | observation | action |
|---|---|---|---|
| run | | | |
| review quality | | | |
| safety | | | |
| package | | | |

Open actions:

| id | owner | due | action | status |
|---|---|---|---|---|
| | | | | |
