# 工程契約

## bob-process-catalog/v1

`.bob/process/process-catalog.yaml` が工程 workflow の一覧です。workflow path、run root、record root は workspace 相対 path のみを許可します。絶対 path、`..`、workspace 外への既存 symlink は拒否します。

## bob-process-input/v1

`process-input.yaml` は campaign、workflow、phase、対象言語、VCS、入力証跡を定義します。Bazaar/Bzr を使う場合は `vcs.noAliases: true` を必須にし、AI 指示でも `bzr --no-aliases <command>` を維持します。

## process-review-result/v1

AI が返す工程レビュー結果です。`summary` の pass/fail/warning/not_applicable 件数は `checklist[].status` と一致させ、`evidenceRefs` は evidence-index に存在する id だけを使います。fail の checklist item は finding または findingId を必須にします。

## bob-process-record/v1

human gate 後に `.bob-process-records/campaigns/<campaign>/records/<runId>/record.yaml` へ保存する工程記録です。`process-code-precheck` は Phase 2 の review-package、Bob 出力検証、human triage を `phase2Handoff` として保持します。
