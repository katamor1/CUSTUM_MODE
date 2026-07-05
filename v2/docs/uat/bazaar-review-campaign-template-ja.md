# Phase 1 Bazaar レビュー実績 campaign テンプレート

このテンプレートは、Phase 1 Bazaar レビュー実績作成を CODEX または UAT 担当者が再実行できるようにするための運用手順である。実案件名、担当者名、revision は campaign 開始前に置き換える。

## 1. 作成する成果物

```text
.bob-review-records/
  campaigns/
    <campaign_id>/
      campaign.yaml
      targets.yaml
      records/
        <review_id>/
          record.yaml
          triage.yaml
          triage.md
          metrics.json
          notes.md
          review-packet.md
      summary.json
      summary.md
```

`.bob/review/results/<review_id>.json` と `.bob/review/results/<review_id>.md` は既存の review-result 保存先として維持する。`.bob-review-records` 側の `record.yaml` は、それらを参照する evidence record として扱う。

## 2. 事前準備

1. Bazaar CLI が `bzr --no-aliases status` で動作することを確認する。
2. `.bob/review/checklist.json` と `.bob/review/review-result.schema.json` が存在することを確認する。
3. `campaign.yaml` を作り、project、owner、share_level、baseline review minutes の要否を記録する。
4. `targets.yaml` に singleRevision、revisionRange、workingTreeSinceRevision の対象候補を記録する。
5. 実績成果物用に `.bob-review-records/` を ignore するか、実案件で共有可能な範囲だけを commit 対象にする。

## 3. 実行手順

1. `Bob Bazaar Review: GUI を開く` を実行する。
2. 対象 target を選び、review packet を作成する。
3. packet を `.bob-review-records/campaigns/<campaign_id>/records/<review_id>/review-packet.md` に保存する。
4. `bazaar-project-rule-review` workflow または project rules 付き direct command を実行する。
5. Bob が出力した review-result JSON を `Bob Bazaar Review: レビュー結果を取り込む` で保存する。
6. `Bob Bazaar Review: レビュー結果 JSON を検証` で schema validation を再実行する。
7. `triage.yaml` を生成し、人間が `accepted` / `rejected` / `needs_investigation` / `deferred` のいずれかへ分類する。
8. `record.yaml` を作成し、packet、review-result、triage、metrics を紐付ける。
9. campaign summary を生成し、`summary.json` と `summary.md` を確認する。
10. `notes.md` に再実行時の注意点、失敗、改善 backlog を残す。

## 4. Phase 1 UAT ケース

| ID | 目的 | 必須証跡 | 判定 |
|---|---|---|---|
| BZR-RT-036 | campaign 初期化で `.bob-review-records` が作られる。 | campaign.yaml, targets.yaml | ok / ng / n/a |
| BZR-RT-037 | GUI で packet artifact を campaign record 配下に保存できる。 | review-packet.md | ok / ng / n/a |
| BZR-RT-038 | capture 済み review-result から record.yaml を生成できる。 | record.yaml, review-result JSON | ok / ng / n/a |
| BZR-RT-039 | review-result から triage.yaml を生成し、人間が編集できる。 | triage.yaml | ok / ng / n/a |
| BZR-RT-040 | triage validation error を検出できる。 | validation log | ok / ng / n/a |
| BZR-RT-041 | 複数 record から campaign summary を生成できる。 | summary.json, summary.md | ok / ng / n/a |
| BZR-RT-042 | workflow run metadata と record が紐付く。 | workflow.run_id または unavailable flag | ok / ng / n/a |
| BZR-RT-043 | campaign summary から実績報告 Markdown を作成できる。 | report markdown | ok / ng / n/a |

## 5. Human triage 基準

| decision | 意味 | action の例 |
|---|---|---|
| accepted | 人間が妥当な指摘として採用した。 | fix_required, backlog, document |
| rejected | 対象外、誤検出、既知の許容事項として棄却した。 | no_action |
| needs_investigation | 追加調査が必要。 | investigate |
| deferred | Phase 1 では判断せず後続 phase に送る。 | defer |

## 6. 完了条件

- `record.yaml` が target、review packet、review-result JSON/Markdown、triage を追跡している。
- review-result JSON は schema validation 済みである。
- human triage が全 finding に存在する。
- `summary.json` と `summary.md` に records_total、findings、triage decision、estimated_minutes_saved が出ている。
- workspace 外 path、Bazaar 書き込み、MCP write tool を使っていない。
