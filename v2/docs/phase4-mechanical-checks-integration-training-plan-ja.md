# Phase 4 既存機械チェックのワークフロー組み込み実現性・育成企画書

- 対象リポジトリ: `katamor1/bob_builtin_analyze`
- 対象ディレクトリ: `extensions/`, `.bob/`, `docs/`
- 主対象拡張機能: `workflow-register`
- 関連拡張機能: `bob-bazaar-review`, `bob-code-consistency-review`, `IBM.bob-code`
- 関連計画: Phase 4: 7プロジェクト展開、GUIファースト操作設計、テンプレートカスタマイズ育成計画
- 作成日: 2026-07-04
- 想定読者: プロジェクトリーダ、SE、レビュー担当、UAT 担当、Workflow Customizer、既存チェックツール管理者、CODEX 実装エージェント

## 1. 背景

Phase 4 の 7プロジェクト展開に向けたヒアリングで、各プロジェクトには既に独自の機械的チェック項目、既存ツール、bat / PowerShell / Python / 静的解析ツールが存在することが分かった。

収集された代表例は次の通りである。

1. 人間がコードレビューを行う前に、VCS の対象リビジョンとその前のリビジョンでビルドを行い、指定外の warning / error が増えていないことを、所定の bat ファイルとビルドログエビデンスで検査する。
2. 人間がコードレビューを行う前に、プロジェクト固有の PowerShell スクリプトを実行し、JavaDoc 形式のコメントルールが守られていることを確認する。
3. 人間がコードレビューを行う前に、指定の静的解析ツールを対象リビジョンの変更ファイルへ実行し、出力エビデンスファイルに所定の指摘事項が増加していないことを確認する。
4. 人間がコードレビューを行う前に、新規関数の step 数やネストの深さがプロジェクト規約を守っているか、所定の Python スクリプトを実行して検査する。
5. 人間がコードレビューを行う前に、新規クラスや新規グローバル変数の命名がプロジェクト規約を守っているか検査する。
6. 人間がコードレビューを行ったファイル一覧票と、コミットしたリビジョンのファイルが一致することを、プロジェクト固有のチェックツールで、テスト開始前に確認する。

これらは、AI に判断させるよりも既存ツールで決定論的に確認した方が安価で速く、説明性も高い。毎回 Bob にトークンコストを払って実行させる対象ではなく、ワークフローの `command` step として機械的に実行し、その結果と evidence だけを Bob / 人間レビューへ渡すのが望ましい。

## 2. 結論

本件の実現性は高い。ただし、現状の `workflow-register` だけで、すべてのプロジェクト固有スクリプトを安全・GUI操作・証跡付きで取り込むには不足がある。

推奨方針は、**新規のプロジェクト別 VS Code 拡張を作らず、`workflow-register` に汎用の Mechanical Check Runner を追加し、`.bob/checks/*.yaml` の設定で既存 bat / PowerShell / Python / 静的解析ツールを workflow step から実行できるようにする**ことである。

この方式なら、次を満たせる。

1. プロジェクト固有ツールを VS Code 拡張として作り直さない。
2. 既存 bat / PowerShell / Python / exe を再利用できる。
3. AI トークンを使わず、ローカルで決定論的に実行できる。
4. 実行結果、ログ、差分、エビデンスファイルを workflow artifact として保存できる。
5. 人間レビュー前、テスト開始前などの gate として組み込める。
6. GUI からボタンで実行し、失敗理由と修正導線を表示できる。
7. 7プロジェクトでは、標準テンプレート + プロジェクト固有 check profile の形で横展開できる。

## 3. 実現方式の比較

| 方式 | 概要 | 新規 VS Code 拡張 | AI トークン | 実現性 | 推奨度 |
|---|---|---:|---:|---:|---:|
| A. manual step | workflow に「手で bat を実行してください」と書く。 | 不要 | 不要 | 高 | 低 |
| B. VS Code task 利用 | `tasks.json` を作り、workflow から既存 task を起動する。 | 不要 | 不要 | 中 | 中 |
| C. 汎用 Mechanical Check Runner | `workflow-register` が `.bob/checks/*.yaml` を読んで外部ツールを安全実行する。 | 不要 | 不要 | 高 | 高 |
| D. プロジェクト別 VS Code 拡張 | 各プロジェクトのチェックを個別拡張にする。 | 必要 | 不要 | 中 | 低 |
| E. AI に実行・判断させる | Bob にコマンド実行やログ判断を依頼する。 | 不要 | 必要 | 中 | 低 |

Phase 4 では方式 C を推奨する。方式 A は導入初期の暫定策としては使えるが、証跡保存や実行漏れ防止が弱い。方式 B は VS Code task に慣れているチームでは使えるが、非コマンドユーザーにはまだ難しく、出力 evidence の構造化が弱い。方式 D は保守コストが高い。方式 E は今回の要望と逆であり、決定論的チェックには向かない。

## 4. Mechanical Check Runner の基本設計

### 4.1 目的

Mechanical Check Runner は、プロジェクトごとの既存ツールやスクリプトを、workflow の `command` step から安全に実行し、結果を構造化して保存する汎用実行基盤である。

### 4.2 対象にするチェック

| チェック種別 | 例 | Runner の役割 |
|---|---|---|
| build delta check | 前リビジョンと対象リビジョンの build warning / error 増加確認 | 2回実行または既存 bat 実行結果の比較、ログ収集、差分判定。 |
| comment rule check | JavaDoc 形式コメント、ヘッダコメント、社内コメント規約 | PowerShell / Python 実行、出力 parse、違反件数判定。 |
| static analysis check | 変更ファイルに静的解析ツールを実行 | 変更ファイル list を渡し、SARIF / XML / CSV / text を evidence 化。 |
| complexity check | step 数、ネスト深さ、循環的複雑度 | Python / exe の結果を threshold と比較。 |
| naming check | 新規クラス、新規 global、関数名、ファイル名 | regex / script / tool 出力を判定。 |
| review file list check | 人間レビュー済みファイル一覧と revision 変更ファイルの一致 | review list と VCS changed files を比較。 |

### 4.3 実行タイミング

Mechanical check は、工程の gate として扱う。

| gate | 用途 |
|---|---|
| `pre_code_review` | 人間コードレビュー前。build delta、静的解析、コメント、命名、complexity。 |
| `pre_bob_review` | Bob レビュー前。対象差分や evidence の前提確認。 |
| `post_bob_review` | Bob review-result の保存後。機械チェックと AI 指摘の関係確認。 |
| `pre_test_start` | テスト開始前。レビュー済みファイル一覧と revision ファイル一致確認。 |
| `release_readiness` | リリース前。複数機械チェックの集約確認。 |

## 5. 設定ファイル設計

### 5.1 配置

```text
.bob/
  checks/
    mechanical-checks.yaml
    profiles/
      product-a-pre-code-review.yaml
    parsers/
      build-warning-parser.yaml
      static-analysis-parser.yaml
```

### 5.2 mechanical-checks.yaml

```yaml
schema_version: bob-mechanical-checks/v1
project_id: product-a
profiles:
  - id: pre-code-review
    title: コードレビュー前チェック
    gate: pre_code_review
    checks:
      - build-warning-delta
      - javadoc-comment-rule
      - static-analysis-delta
      - complexity-rule
      - naming-rule
  - id: pre-test-start
    title: テスト開始前チェック
    gate: pre_test_start
    checks:
      - reviewed-file-list-match
checks:
  - id: build-warning-delta
    title: ビルド warning/error 増加チェック
    runner: bat
    command: tools/build/check-build-delta.bat
    cwd: .
    args:
      - "${BASE_REVISION}"
      - "${TARGET_REVISION}"
    timeout_seconds: 3600
    evidence:
      collect:
        - build/logs/**/*.log
        - build/evidence/**/*.txt
    parser:
      type: regex
      warning_pattern: "warning"
      error_pattern: "error"
    pass_condition:
      max_new_warnings: 0
      max_new_errors: 0
      allow_known_ids_file: .bob/checks/known-build-warnings.txt
```

### 5.3 check 定義の主な項目

| 項目 | 内容 |
|---|---|
| `id` | 安定 ID。summary と record に残る。 |
| `title` | GUI 表示名。 |
| `runner` | `bat`, `powershell`, `python`, `executable`, `node`, `task`, `manual`。 |
| `command` | workspace 相対 path。absolute path は原則禁止。 |
| `args` | 変数展開可能な引数。 |
| `cwd` | workspace 内の実行ディレクトリ。 |
| `env` | 明示 env。secret は保存しない。 |
| `timeout_seconds` | タイムアウト。 |
| `changed_files_only` | 対象リビジョンの変更ファイルだけ渡すか。 |
| `evidence.collect` | 収集するログ・出力ファイル。 |
| `parser` | exit code / regex / junit / sarif / csv / custom text。 |
| `pass_condition` | warning 増加数、error 増加数、違反件数、閾値。 |
| `severity_on_fail` | `error`, `warning`, `info`。 |
| `allow_failure` | true の場合は gate で止めず warning 扱い。 |

## 6. workflow への組み込み設計

### 6.1 command step 例

```yaml
steps:
  - id: run-mechanical-checks
    title: コードレビュー前の機械チェックを実行
    type: command
    action:
      provider: workflowRegister.runMechanicalChecks
      args:
        profile: pre-code-review
        baseRevision: "${inputs.baseRevision}"
        targetRevision: "${inputs.targetRevision}"
    resultKey: mechanicalCheckResult
    sendResult: true
    required: true
    completeOnSuccess: true
```

### 6.2 Bob に渡す情報

AI に実行させるのではなく、Runner が結果を作り、Bob には要約だけを渡す。

```json
{
  "profile": "pre-code-review",
  "status": "failed",
  "checks_total": 5,
  "passed": 4,
  "failed": 1,
  "evidence_summary": [
    {
      "check_id": "static-analysis-delta",
      "status": "failed",
      "new_findings": 2,
      "evidence_path": ".bob/mechanical-checks/runs/.../static-analysis/result.json"
    }
  ]
}
```

Bob はこの結果を使って、レビュー観点や人間への注意点を補足できる。ただし、pass / fail の判定は Runner の構造化結果を source of truth とする。

### 6.3 gate 判定

| 結果 | workflow の扱い |
|---|---|
| all passed | 次 step へ進む。 |
| warning only | `reviewing` で人間確認に止める。 |
| failed | workflow を止め、Run Monitor に修正導線を出す。 |
| blocked | tool 未配置、入力不足、timeout。再実行または手動確認へ進む。 |

## 7. 実行結果・エビデンス設計

### 7.1 保存先

```text
.bob/
  mechanical-checks/
    runs/
      <runId>/
        profile-result.json
        profile-summary.md
        checks/
          <checkId>/
            stdout.log
            stderr.log
            result.json
            evidence/
              <collected files>
```

### 7.2 result.json

```json
{
  "schema_version": "bob-mechanical-check-result/v1",
  "check_id": "complexity-rule",
  "title": "step数・ネスト深さチェック",
  "status": "failed",
  "started_at": "2026-07-04T10:00:00+09:00",
  "finished_at": "2026-07-04T10:00:12+09:00",
  "exit_code": 1,
  "metrics": {
    "new_functions": 3,
    "violations": 1,
    "max_steps": 82,
    "max_nesting_depth": 5
  },
  "findings": [
    {
      "id": "MC-CPLX-001",
      "file": "src/foo.c",
      "line": 120,
      "message": "新規関数 foo_bar の step 数が規約上限 50 を超過しています。",
      "severity": "warning"
    }
  ],
  "evidence": [
    {
      "path": ".bob/mechanical-checks/runs/xxx/checks/complexity-rule/evidence/complexity.csv",
      "type": "csv"
    }
  ]
}
```

### 7.3 profile-summary.md

人間レビュー前に確認しやすい Markdown を生成する。

```md
# コードレビュー前 機械チェック結果

- 対象: r125
- 基準: r124
- 結果: failed

| Check | Result | New findings | Evidence |
|---|---|---:|---|
| build-warning-delta | pass | 0 | build.log |
| static-analysis-delta | failed | 2 | result.xml |
| complexity-rule | pass | 0 | complexity.csv |
```

## 8. GUI 設計

### 8.1 Mechanical Checks 画面

Bob Operation Hub に `機械チェック` タブを追加する。

表示項目:

- 登録済み check profile
- gate 種別
- 最終実行結果
- 必要ツールの配置状況
- 実行ボタン
- evidence folder へのリンク
- 失敗 check の修正ガイド

操作:

- `チェックを実行`
- `対象 revision を選択`
- `変更ファイルだけで実行`
- `結果を開く`
- `人間レビューへ進む`
- `再実行`

### 8.2 Check Profile Editor

プロジェクト固有の check profile を GUI で作る。

入力 UI:

| 項目 | UI |
|---|---|
| profile id | text input |
| gate | select: pre_code_review / pre_test_start / release_readiness |
| check list | checkbox / reorder |
| runner type | select |
| script path | file picker |
| args | form builder |
| evidence collect | glob input |
| parser type | select |
| pass condition | form |
| timeout | number input |

### 8.3 Readiness Check との統合

Phase 4 の Template Customization Studio / Readiness Check に、機械チェックの状態を加える。

| readiness 項目 | OK 条件 |
|---|---|
| check profile exists | gate に必要な profile が定義されている。 |
| scripts exist | script path が workspace 内に存在する。 |
| runner allowed | runner type が許可されている。 |
| evidence path safe | evidence collect が workspace 内。 |
| dry run | sandbox または dry run が成功済み。 |
| no AI required | deterministic check として AI step へ依存していない。 |

## 9. 既存チェック例への適用

### 9.1 build warning / error 増加チェック

| 項目 | 設計 |
|---|---|
| runner | `bat` |
| timing | `pre_code_review` |
| input | baseRevision, targetRevision |
| output | build logs, warning/error count, delta result |
| pass | 指定外 warning/error の増加 0 |
| evidence | baseline log, target log, diff summary |

注意:

- checkout を直接現在 workspace に行うと危険なので、可能なら script 側または Runner 側で temporary worktree / export directory を使う。
- build 時間が長い場合は timeout と cancellation を GUI に表示する。

### 9.2 JavaDoc コメントルール

| 項目 | 設計 |
|---|---|
| runner | `powershell` |
| timing | `pre_code_review` |
| input | changed Java files |
| output | violations.csv / summary.md |
| pass | 違反 0 または既知除外のみ |
| evidence | PowerShell stdout, violations.csv |

### 9.3 静的解析ツール

| 項目 | 設計 |
|---|---|
| runner | `executable` |
| timing | `pre_code_review` |
| input | changed files list |
| output | SARIF / XML / CSV / text |
| pass | new findings 0 または threshold 以下 |
| evidence | analyzer output, finding delta |

### 9.4 step 数・ネスト深さチェック

| 項目 | 設計 |
|---|---|
| runner | `python` |
| timing | `pre_code_review` |
| input | changed C/C++ / C# / Java files |
| output | complexity metrics |
| pass | project threshold 以下 |
| evidence | complexity.csv, result.json |

### 9.5 命名規約チェック

| 項目 | 設計 |
|---|---|
| runner | `python` または `executable` |
| timing | `pre_code_review` |
| input | new class / new global / changed symbols |
| output | naming violations |
| pass | violation 0 |
| evidence | naming-result.json |

### 9.6 レビュー済みファイル一覧と revision ファイル一致チェック

| 項目 | 設計 |
|---|---|
| runner | `executable` または `python` |
| timing | `pre_test_start` |
| input | reviewed file list, VCS changed files |
| output | missing / extra files |
| pass | mismatch 0 |
| evidence | reviewed-list.csv, changed-files.json, compare-result.md |

## 10. セキュリティ・安全設計

Mechanical Check Runner は、ローカルコマンド実行を扱うため、Phase 0 の guardrail 方針よりさらに厳しく設計する。

### 10.1 実行許可

- `.bob/checks/mechanical-checks.yaml` に定義された script のみ実行する。
- script path は workspace 内に限定する。
- absolute path は原則禁止。ただし中央管理ツールなどで必要な場合は、project profile の explicit allowlist に限る。
- `shell: true` は使わない。bat の場合のみ `cmd.exe /c <bat>` を固定的に使う。
- PowerShell は `-NoProfile` を既定にし、実行 policy はプロジェクト合意に従う。

### 10.2 入出力境界

- cwd は workspace 内に限定する。
- evidence collect は workspace 内または Runner が作る temp / evidence folder のみに限定する。
- stdout / stderr は max bytes で切り詰める。
- secret pattern は redaction する。
- ネットワークアクセスや外部サーバー送信は Runner では保証できないため、ツール選定時の project policy に明記する。

### 10.3 破壊的操作の抑制

Runner は script の内部までは完全には制御できない。したがって、次の運用を必須にする。

1. script owner を明記する。
2. script の read-only / build-only / analysis-only 方針をレビューする。
3. UAT 前に sandbox で dry run する。
4. destructive な script は登録不可とする。
5. VCS commit / push / revert / merge は Mechanical Check Runner から実行しない。

## 11. workflow テンプレートへの組み込み案

### 11.1 コードレビュー前 gate

```text
process-code-precheck
  -> collect-review-target
  -> run-mechanical-checks(pre-code-review)
  -> create-review-package
  -> Bob consistency review
  -> human triage
  -> code review handoff
```

### 11.2 Bazaar review gate

```text
bazaar-project-rule-review
  -> open review GUI
  -> collect context
  -> run-mechanical-checks(pre-code-review)
  -> load rules
  -> Bob review
  -> capture result
  -> human triage
```

### 11.3 テスト開始前 gate

```text
process-test-start-readiness
  -> collect committed files
  -> load reviewed file list
  -> run-mechanical-checks(pre-test-start)
  -> human confirmation
  -> test start approval record
```

## 12. 育成企画

### 12.1 育成の目的

各プロジェクトが既存の機械チェックを捨てずに Bob workflow へ組み込み、自走して運用できる状態を作る。

育成のゴール:

1. 各プロジェクトが既存チェックを棚卸しできる。
2. どのチェックを workflow gate に入れるべきか判断できる。
3. `.bob/checks/mechanical-checks.yaml` を GUI で登録・編集できる。
4. 失敗結果を人間レビューへ正しく引き継げる。
5. Runner の安全制約を理解し、危険な script を登録しない。

### 12.2 役割別トラック

| トラック | 対象 | 到達目標 | 所要目安 |
|---|---|---|---|
| MC-Operator | プログラマ、テスタ、レビュー担当 | GUI で機械チェックを実行し、結果を確認できる。 | 1.5時間 |
| MC-Reviewer | SE、レビュー担当 | 失敗 check の evidence を読み、人間レビューの判断材料にできる。 | 2時間 |
| MC-Check Owner | 既存スクリプト管理者、代表 SE | check profile を登録し、pass condition と evidence を設定できる。 | 半日 |
| MC-Workflow Customizer | Workflow Customizer | workflow gate に mechanical check profile を組み込める。 | 半日 |
| MC-Maintainer | 中央推進チーム | schema、Runner、GUI、security policy を保守できる。 | 1日 |

### 12.3 カリキュラム

#### Module 1: 機械チェックと AI レビューの役割分担

内容:

- 決定論的チェックは Runner に任せる。
- Bob は機械チェック結果を踏まえて観点整理する。
- pass / fail の source of truth は Runner result。
- AI トークンを使わない対象を見極める。

演習:

- build log check の result.json を読み、Bob に渡す summary を確認する。

#### Module 2: 既存チェック棚卸し

内容:

- script 名
- owner
- 実行タイミング
- 入力
- 出力
- pass / fail 条件
- evidence
- 実行時間
- known issues

演習:

- 自プロジェクトの既存 bat / ps1 / py / exe を棚卸しシートに記入する。

#### Module 3: check profile 登録

内容:

- runner type
- command path
- args
- evidence collect
- parser
- pass condition
- timeout

演習:

- JavaDoc コメントチェックを GUI で登録し、dry run する。

#### Module 4: workflow gate 組み込み

内容:

- pre_code_review gate
- pre_test_start gate
- required / allow_failure
- human gate
- evidence handoff

演習:

- `process-code-precheck` に mechanical check step を追加する。

#### Module 5: 失敗時の運用

内容:

- failed / warning / blocked の違い
- 再実行
- 既知除外
- 人間レビューへの申し送り
- UAT 記録

演習:

- static analysis failure を triage し、レビュー申し送りを作る。

### 12.4 認定条件

| 認定 | 条件 |
|---|---|
| MC-Operator Ready | GUI で check profile を実行し、summary と evidence を開ける。 |
| MC-Reviewer Ready | failed check の evidence を見て、レビュー継続 / 差戻し / 例外承認を判断できる。 |
| MC-Check Owner Ready | 既存 script を check profile として登録し、dry run と readiness check を通せる。 |
| MC-Customizer Ready | workflow に mechanical check gate を追加し、UAT で実行できる。 |

Phase 4 UAT 前に、各プロジェクトで最低限次を満たす。

- MC-Check Owner Ready: 1 名
- MC-Reviewer Ready: 1 名
- MC-Operator Ready: 2 名

## 13. 導入ロードマップ

### 13.1 Step 1: 棚卸し

各プロジェクトから、既存機械チェックを収集する。

棚卸し項目:

- チェック名
- 実行タイミング
- script path
- owner
- 入力
- 出力
- pass / fail 条件
- evidence
- 平均実行時間
- 既知除外
- 実行環境

### 13.2 Step 2: 標準 check profile schema 確定

中央チームが `.bob/checks/mechanical-checks.yaml` の schema と GUI 項目を確定する。

### 13.3 Step 3: 代表 3 チェックを pilot 実装

最初に次を pilot とする。

1. build warning / error delta
2. static analysis delta
3. reviewed file list match

この 3 つは複数プロジェクトへ横展開しやすく、導入効果が見えやすい。

### 13.4 Step 4: GUI 化

Mechanical Checks 画面、Check Profile Editor、Result Viewer を実装する。

### 13.5 Step 5: workflow gate へ組み込み

`process-code-precheck`、`bazaar-project-rule-review`、`process-test-start-readiness` へ組み込む。

### 13.6 Step 6: 7プロジェクト UAT

各プロジェクト 1〜2 check から開始し、readiness pass 後に運用対象を広げる。

## 14. 追加 work package

| ID | 対象 | 名称 | 優先度 | 主な成果物 |
|---|---|---|---:|---|
| P4-MC-01 | workflow-register | mechanical-checks schema / validator | 1 | schema、validator、fixture tests |
| P4-MC-02 | workflow-register | Mechanical Check Runner | 1 | bat / PowerShell / Python / executable runner、timeout、evidence collect |
| P4-MC-03 | workflow-register | parser / pass condition engine | 1 | exit code、regex、SARIF、CSV、delta parser |
| P4-MC-04 | GUI | Mechanical Checks UI | 1 | profile list、run button、result viewer |
| P4-MC-05 | GUI | Check Profile Editor | 2 | GUI 登録、dry run、readiness integration |
| P4-MC-06 | workflow templates | mechanical check gate templates | 1 | pre_code_review, pre_test_start workflow step templates |
| P4-MC-07 | docs/training | 育成教材・棚卸しシート | 1 | training modules、inventory template、FAQ |
| P4-MC-08 | UAT | 代表チェック pilot / sandbox | 1 | sample bat / ps1 / py / analyzer output fixtures |
| P4-MC-09 | dashboard | mechanical check summary | 3 | project / campaign summary、failure trends |

## 15. CODEX 実装指示テンプレート

```text
対象: <P4-MC work package ID>
目的: <1文で目的>
変更対象:
- <path>

制約:
- 新規プロジェクト別 VS Code 拡張は作らない。
- 既存 script / tool を `.bob/checks/*.yaml` から呼び出す。
- shell 文字列連結を避け、execFile / argument array を使う。
- script path / cwd / evidence path は workspace 内に限定する。
- VCS 書き込み、commit、push、revert、merge は実行しない。
- AI step に実行判定を依存させない。Runner result を source of truth にする。
- stdout / stderr / evidence は max bytes と redaction を通す。
- GUI と UAT 手順を同時に更新する。

実装内容:
1. <実装ステップ>
2. <実装ステップ>
3. <実装ステップ>

テスト:
- npm run compile
- npm run test
- 追加 unit test: <list>
- 追加 runner fixture: <list>
- 追加 GUI / UAT testcase: <list>

完了条件:
- <受け入れ条件>
```

## 16. テスト計画

### 16.1 unit test

| テスト | 内容 | 期待結果 |
|---|---|---|
| valid config | 正常 mechanical-checks.yaml。 | validation success。 |
| invalid runner | 未許可 runner。 | validation error。 |
| path escape | `../tools/check.bat`。 | rejection。 |
| missing script | script が存在しない。 | readiness error。 |
| timeout | 長時間 script。 | timeout status。 |
| parser regex | warning / error count parse。 | count が一致。 |
| pass condition | new warnings あり。 | failed。 |

### 16.2 integration test

| テスト | 内容 | 期待結果 |
|---|---|---|
| bat runner | sample bat を実行。 | stdout / result 保存。 |
| powershell runner | sample ps1 を実行。 | evidence 保存。 |
| python runner | complexity sample。 | metrics parse。 |
| static analyzer fixture | SARIF / CSV を parse。 | new findings count。 |
| workflow step | workflow command step から profile 実行。 | resultKey に summary。 |

### 16.3 UAT

| ID | ケース | 合格条件 |
|---|---|---|
| MC-UAT-001 | build warning delta | baseline / target の warning 増加を検出。 |
| MC-UAT-002 | JavaDoc PowerShell | コメント違反を検出し evidence を保存。 |
| MC-UAT-003 | static analysis | 変更ファイルに対する新規指摘を検出。 |
| MC-UAT-004 | complexity Python | step 数 / nest 違反を検出。 |
| MC-UAT-005 | naming | 新規 class / global naming 違反を検出。 |
| MC-UAT-006 | reviewed file list match | 一致 / 不一致を検出。 |
| MC-UAT-007 | GUI only | Command Palette なしで check 実行・結果確認。 |
| MC-UAT-008 | blocked case | tool 未配置時に修正導線を表示。 |

## 17. 成功指標

| 指標 | 目標 |
|---|---|
| 代表チェック pilot 成功数 | 3 種以上。 |
| 7プロジェクト check 棚卸し完了 | 100%。 |
| workflow gate 組み込み済み project | 7プロジェクト中 5 以上を初期目標。 |
| AI トークン不要の機械チェック率 | 対象チェックの 90% 以上。 |
| GUI からの実行率 | 80% 以上。 |
| evidence 保存成功率 | UAT run の 95% 以上。 |
| unsafe config 検出率 | negative test で 100%。 |
| MC-Check Owner Ready | 各プロジェクト 1名以上。 |

## 18. リスクと対策

| リスク | 内容 | 対策 |
|---|---|---|
| script が破壊的操作をする | Runner からは script 内部を完全制御できない。 | script owner 明記、sandbox dry run、登録レビュー、禁止操作ポリシー。 |
| 実行環境依存 | bat / PowerShell / tool path が PC ごとに違う。 | tool readiness check、project profile、環境診断、エラー導線。 |
| ログが巨大 | build log / analyzer output が大きい。 | max bytes、evidence file 保存、summary 抽出。 |
| parser が project ごとに違う | ログ形式が多様。 | regex / CSV / SARIF / exit code parser を設定化。 |
| check 失敗時の扱いが曖昧 | レビューを止めるか例外承認か迷う。 | gate policy、allow_failure、human gate、exception record。 |
| GUI なしで YAML 編集される | 安全でない設定が混入する。 | readiness check、central review、GUI 標準導線。 |

## 19. 参照資料

- `extensions/workflow-register/README.md`
- `docs/gui-first-operation-design-plan-ja.md`
- `docs/phase4-template-customization-readiness-and-training-plan-ja.md`
- `docs/phase3-process-bob-workflows-codex-plan-ja.md`
- `docs/phase2-git-multilanguage-consistency-prereview-codex-plan-ja.md`
- `docs/phase1-bazaar-review-record-codex-plan-ja.md`
- `docs/phase0-foundation-stabilization-codex-plan-ja.md`

## 20. 推奨コミット

```text
docs: add phase 4 mechanical checks integration and training plan
```
