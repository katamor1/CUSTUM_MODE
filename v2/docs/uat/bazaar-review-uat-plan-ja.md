# Bazaar Review UAT Plan

- 対象: `workflow-register`, `bob-bazaar-review`, `bob-code-consistency-review`
- 対象フェーズ: Phase 0 基盤安定化・運用設計、Phase 1 Bazaar レビュー実績作成
- 実施単位: 1 workspace、1 Bazaar repository、1 Bob 実行セッション
- 判定語: `ok`, `ng`, `n/a`

## 1. 目的

Bazaar review workflow を実運用へ渡す前に、GUI、workflow、MCP、Bob 出力取り込み、成果物保存の一連の流れが再現できることを確認する。

UAT では機能の網羅よりも、運用者が迷わず再実行できること、失敗時に原因を切り分けられること、生成物が許可領域にだけ保存されることを重視する。

## 2. 前提条件

| 項目 | 必須条件 | 記録 |
|---|---|---|
| VS Code / Bob IDE | 拡張機能をインストールできる。 | version: |
| IBM Bob | `IBM.bob-code` が有効。未導入時は Bob 連携項目を `n/a` にする。 | version: |
| Bazaar | `bzr --no-aliases status` が対象 repo で成功する。 | version: |
| Workspace | `.bob` を作成できる信頼済み workspace。 | path: |
| 拡張 VSIX | Phase 0 の release checklist を通過した VSIX。 | file: |

## 3. 事前セットアップ

1. 対象 workspace を VS Code / Bob IDE で開く。
2. `bob-bazaar-review`、`workflow-register`、必要に応じて `bob-code-consistency-review` をインストールする。
3. Command Palette から `Bazaar レビュー: GUI を開く` を実行する。
4. `.bob` が未初期化なら GUI の `.bobを初期化` を実行する。
5. `.bob/mcp.json` に Bazaar MCP が登録されていることを確認する。
6. `.gitignore` または同等の ignore に次を含める。

```gitignore
.bob/review/results/
.bob/workflows/runs/
.bob-review-records/
.bob-review/
.bob-trace/ai-traceability-draft/
```

## 4. UAT シナリオ

| ID | シナリオ | 手順 | 期待結果 | 判定 |
|---|---|---|---|---|
| UAT-BZR-01 | GUI 初期化 | GUI を開き、不足ファイルを初期化する。 | `.bob/mcp.json`, `.bob/review/checklist.json`, `.bob/review/review-result.schema.json`, workflow が作成される。 | |
| UAT-BZR-02 | 単一 revision packet | `1リビジョン` で revision を指定し `取得`、`レビューしてBobにADD` を実行する。 | packet に revision、変更ファイル、`bzr --no-aliases` 由来の diff/log が含まれる。 | |
| UAT-BZR-03 | revision range packet | `リビジョン範囲` で base/target を指定する。 | range diff が取得され、対象 revision が packet に記録される。 | |
| UAT-BZR-04 | 未コミット差分 packet | `TOPリビジョンと未コミット差分` を実行する。 | working tree diff と status が packet に含まれる。 | |
| UAT-BZR-05 | workflow 実行 | Bob workflow `bazaar-project-rule-review` を実行する。 | context 収集、規約読み込み、AI review、結果取り込みの step が順番に進む。 | |
| UAT-BZR-06 | Bob 出力取り込み | Bob の review-result JSON fenced block を取り込む。 | schema validation 後、`.bob/review/results/` に JSON/Markdown が保存される。 | |
| UAT-BZR-07 | 不正 JSON | 必須 field を欠いた review-result JSON を取り込む。 | 保存されず、validation error が表示される。 | |
| UAT-BZR-08 | MCP cwd 境界 | workspace 外 path を MCP 操作対象に指定する。 | allowed root validation で拒否される。 | |
| UAT-BZR-09 | alias 影響確認 | Bazaar alias がある環境で packet を生成する。 | 拡張機能の Bazaar 呼び出しは `--no-aliases` で成功する。 | |
| UAT-BZR-10 | 再実行性 | 同じ条件でもう一度 packet 生成と取り込みを行う。 | 新しい artifact が作成され、既存結果の上書きや混線がない。 | |
| UAT-BZR-11 | Phase 1 campaign 初期化 | `Bob Bazaar Review: 実績 campaign を初期化` を実行する。 | `.bob-review-records/campaigns/phase1-bazaar-review-uat-001` が作成される。 | |
| UAT-BZR-12 | packet artifact | review packet を `review-packet.md` として campaign record 配下へ保存する。 | Bob に渡した packet が後から確認できる。 | |
| UAT-BZR-13 | review record | capture 済み review-result から `record.yaml` を作成・検証する。 | review-result JSON/Markdown、packet、triage path が追跡できる。 | |
| UAT-BZR-14 | human triage | `triage.yaml` を生成し、人間が採否を記入して検証する。 | `accepted` / `rejected` / `needs_investigation` / `deferred` が集計できる。 | |
| UAT-BZR-15 | campaign summary | 複数 record から `summary.json` / `summary.md` を生成する。 | 件数、採否、所要時間、warning が表示される。 | |

## 5. Code Consistency 連携スモーク

| ID | シナリオ | 手順 | 期待結果 | 判定 |
|---|---|---|---|---|
| UAT-CCR-01 | preprocess | `bobCodeConsistency.preprocess` を `.bob-review/review-package` に出力する。 | review package が生成される。 | |
| UAT-CCR-02 | capture | `bobCodeConsistency.captureBobOutput` を `.bob-review/bob-output/bob-output.yaml` に出力する。 | raw/canonical/primary YAML が bob-output 領域に保存される。 | |
| UAT-CCR-03 | triage | `bobCodeConsistency.triage` を `.bob-review/human-triage` に出力する。 | triage files が human-triage 領域に保存される。 | |
| UAT-CCR-04 | path guard | 出力先に absolute path、`..`、誤った `.bob-review` サブ領域を指定する。 | すべて拒否される。 | |

## 6. 記録テンプレート

| 実施日 | 実施者 | workspace | Bazaar revision/range | Bob session | VSIX set |
|---|---|---|---|---|---|
| | | | | | |

| ID | 判定 | 証跡 path / screenshot | 事象 | follow-up |
|---|---|---|---|---|
| UAT-BZR-01 | | | | |
| UAT-BZR-02 | | | | |
| UAT-BZR-03 | | | | |
| UAT-BZR-04 | | | | |
| UAT-BZR-05 | | | | |
| UAT-BZR-06 | | | | |
| UAT-BZR-07 | | | | |
| UAT-BZR-08 | | | | |
| UAT-BZR-09 | | | | |
| UAT-BZR-10 | | | | |
| UAT-BZR-11 | | | | |
| UAT-BZR-12 | | | | |
| UAT-BZR-13 | | | | |
| UAT-BZR-14 | | | | |
| UAT-BZR-15 | | | | |
| UAT-CCR-01 | | | | |
| UAT-CCR-02 | | | | |
| UAT-CCR-03 | | | | |
| UAT-CCR-04 | | | | |

## 7. 完了条件

- `ng` が 0 件である。
- `n/a` は理由が記録されている。
- 生成物が許可領域外へ保存されていない。
- Bob 出力、review-result、triage、traceability のうち、実施対象にした成果物 path が記録されている。
- Phase 1 実績作成を対象にした場合は、`summary.md` に `records_total`、triage decision、warning が記録されている。
- follow-up がある場合は owner と対応方針が決まっている。
