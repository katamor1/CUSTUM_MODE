# bob-code-consistency-review 実機テスト仕様書

## 1. 目的

本書は `extensions/bob-code-consistency-review` の実機テスト仕様を定義する。単体テストでは mock 化する VS Code Extension Host、IBM Bob、workflow-register、Bob Workflow UI、Webview、実ファイル、Git / Bazaar 差分、Markdown / docx / xlsx 文書、C / C++ ソース、TypeScript / Python / Java などの複数言語ソースを含めて結合動作を確認する。

## 2. テスト対象

| 区分 | 対象 |
| --- | --- |
| VS Code 拡張 | `bob-code-consistency-review` |
| 依存拡張 | `IBM.bob-code`, `local.workflow-register` |
| Workflow | `.bob/workflows/code-consistency-review/WORKFLOW.md` |
| 入力 | `review-input.yaml`, traceability catalog, AI draft JSON |
| 出力 | `.bob-review/review-package`, `.bob-review/bob-output`, `.bob-review/human-triage`, `.bob-trace` |
| VCS | Git 差分、Git rename / binary numstat、Bazaar / bzr 差分、diff fixture |
| 文書形式 | Markdown、Word `.docx`、Excel `.xlsx` |
| UI | Command Palette、QuickPick、Webview Traceability Prep、Bob Workflow UI |

## 3. 前提環境

| 項目 | 条件 |
| --- | --- |
| OS | Windows 11 を主対象。可能であれば macOS / Linux でも代表ケースを確認する。 |
| VS Code / Bob IDE | `package.json` の `engines.vscode` を満たすバージョン。 |
| IBM Bob 拡張 | `IBM.bob-code` が導入済みで、有効化できること。 |
| workflow-register | `local.workflow-register` が導入済みで、有効化できること。 |
| Node.js / npm | extension build / package が可能なバージョン。 |
| Git | Git review input を実行する場合に利用可能であること。 |
| Bazaar CLI | Bazaar review input を実行する場合に利用可能であること。無い場合は diff fixture で代替する。 |
| テスト workspace | ソース、docs、`.bob` を含む検証用 workspace。 |

## 4. 事前準備

### 4.1 拡張機能ビルド

```powershell
cd extensions\bob-code-consistency-review
npm install
npm run compile
```

必要に応じて VSIX を作成する。

```powershell
npm run package
```

### 4.2 推奨 workspace 構成

```text
<workspace>/
  .git/
  .bob/
  docs/
    requirements.md
    basic-design.md
    detailed-design.md
    test-spec.md
    qa-ledger.xlsx
  src/
    sample.c
    sample.h
    payment review.ts
  tools/
    reconcile.py
  app/
    PaymentReview.java
  tests/
    sample_test.c
```

### 4.3 Markdown 文書例

```markdown
# Requirements

## REQ-001

入力値を検証し、不正値の場合はエラーを返す。

# Basic Design

## BD-001

入力検証処理は `validate_input` が担当する。

# Detailed Design

## DD-001

`validate_input` は null、範囲外、形式不正を検出する。

# Test Spec

## TC-001

null 入力時にエラーになること。
```

### 4.4 C ソース例

```c
int validate_input(const char *value) {
  if (value == 0) return -1;
  printf("debug\n");
  return 0;
}
```

### 4.5 Git 複数言語 sample

同梱 sample `docs/workflows/code-consistency-review/examples/multi-language-git-review/` は、TypeScript、Python、Java の変更を baseline / head fixture として持つ。実機 smoke では次を使い、sandbox workspace 内に実 Git repo が作られることを確認する。

```powershell
powershell -File docs\workflows\code-consistency-review\integration\launch-bob-code-consistency-sandbox.ps1 -NoLaunch -Sample multi-language-git-review
```

## 5. 共通確認項目

各テストでは可能な範囲で次を確認する。

- VS Code Developer Tools Console に未処理例外が出ていない。
- コマンド実行後の通知が成功 / warning / error を正しく表す。
- 生成ファイルが UTF-8 で保存される。
- workspace root 外への意図しない書き込みがない。
- `.bob-review`、`.bob-trace`、`.bob` 配下の成果物が設計どおりの path に出力される。
- Bob Workflow UI から実行した場合、workflow-register の run state と本拡張成果物が対応する。

## 6. 実機テスト項目

### CCR-RT-001 拡張起動と command 登録

| 項目 | 内容 |
| --- | --- |
| 目的 | 拡張が起動し、Command Palette に主要 command が表示されることを確認する。 |
| 手順 | 1. テスト workspace を開く。<br>2. `Developer: Show Running Extensions` で拡張状態を確認する。<br>3. Command Palette で `Bob Code Consistency Review:` を検索する。 |
| 期待結果 | `initializeWorkspace`、`createReviewInput`、`preprocess`、`captureBobOutput`、`validateOutput`、`triage`、traceability 系 command が表示される。 |

### CCR-RT-002 workflow-register provider 登録

| 項目 | 内容 |
| --- | --- |
| 目的 | `workflow-register` に action provider が登録されることを確認する。 |
| 手順 | 1. workflow-register と本拡張を有効化する。<br>2. `workflowRegister.inspect` を実行する。<br>3. 同梱 workflow を実行可能か確認する。 |
| 期待結果 | `bobCodeConsistency.*` provider を参照する workflow が provider missing にならない。 |

### CCR-RT-003 workspace 初期化

| 項目 | 内容 |
| --- | --- |
| 目的 | workflow template、review-input 雛形、placeholder document が作成されることを確認する。 |
| 手順 | 1. `.bob/workflows/code-consistency-review/WORKFLOW.md` と `review-input.yaml` が無い workspace を開く。<br>2. `Bob Code Consistency Review: .bob ワークフロー定義と review-input 雛形を初期化` を実行する。 |
| 期待結果 | `.bob/workflows/code-consistency-review/WORKFLOW.md`、`review-input.yaml`、`docs/review-input-placeholder.md` が作成される。 |

### CCR-RT-004 workspace 初期化時の既存 review-input 保護

| 項目 | 内容 |
| --- | --- |
| 目的 | 既存 `review-input.yaml` が上書きされないことを確認する。 |
| 手順 | 1. 独自内容の `review-input.yaml` を配置する。<br>2. 初期化 command を実行する。 |
| 期待結果 | 既存内容は保持され、backup path が通知または result に含まれる。 |

### CCR-RT-005 対話式 review-input 作成

| 項目 | 内容 |
| --- | --- |
| 目的 | Wizard で文書候補を選択し、`review-input.yaml` を生成できることを確認する。 |
| 手順 | 1. `docs` 配下に requirements / design / test 文書を配置する。<br>2. `Bob Code Consistency Review: 対話式に review-input.yaml を作成` を実行する。<br>3. QuickPick / input box に従って入力する。 |
| 期待結果 | `review-input.yaml` が生成され、artifact path、sections / cases、review_focus が反映される。 |

### CCR-RT-006 AI review-input draft prompt 生成

| 項目 | 内容 |
| --- | --- |
| 目的 | AI draft 用 prompt が生成され、clipboard にコピーされることを確認する。 |
| 手順 | 1. Git repository または diff fixture を用意する。<br>2. `Bob Code Consistency Review: AI draft 用プロンプトを作成` を実行する。<br>3. base / head / vcs を入力する。 |
| 期待結果 | `.bob-review/review-input-draft/ai-draft-prompt.md` が作成され、document candidates、diff summary、allowed enum が含まれる。 |

### CCR-RT-007 AI review-input draft JSON 適用

| 項目 | 内容 |
| --- | --- |
| 目的 | AI draft JSON から `review-input.yaml` を生成できることを確認する。 |
| 手順 | 1. valid `ReviewInputDraft` JSON を clipboard にコピーする。<br>2. `Bob Code Consistency Review: AI draft JSON から review-input.yaml を生成` を実行する。 |
| 期待結果 | `review-input.yaml` が生成または更新され、既存 file がある場合は backup される。 |

### CCR-RT-008 review-input 診断説明

| 項目 | 内容 |
| --- | --- |
| 目的 | 不正な `review-input.yaml` の診断を表示できることを確認する。 |
| 手順 | 1. required field 不足または missing artifact を含む `review-input.yaml` を配置する。<br>2. `Bob Code Consistency Review: review-input.yaml 診断を説明` を実行する。 |
| 期待結果 | error / diagnostics が通知または report として表示される。 |

### CCR-RT-009 review-input 自動修復

| 項目 | 内容 |
| --- | --- |
| 目的 | legacy / 不完全な `review-input.yaml` の修復導線を確認する。 |
| 手順 | 1. 修復対象の `review-input.yaml` を配置する。<br>2. `Bob Code Consistency Review: review-input.yaml を自動修復` を実行する。 |
| 期待結果 | 修復可能な場合は backup 後に更新される。不可の場合は error が表示される。 |

### CCR-RT-010 traceability prep Webview 起動

| 項目 | 内容 |
| --- | --- |
| 目的 | traceability prep Webview が開き、catalog を表示できることを確認する。 |
| 手順 | 1. `Bob Code Consistency Review: traceability prep を開く` を実行する。<br>2. Domains / Items / Links / Decisions / Gate Report / Preview タブを確認する。 |
| 期待結果 | Webview が表示され、空 catalog または既存 catalog が読み込まれる。 |

### CCR-RT-011 traceability prep 保存と gate report

| 項目 | 内容 |
| --- | --- |
| 目的 | Webview から catalog を編集・保存し、gate report を生成できることを確認する。 |
| 手順 | 1. Webview で domain、document、item、link、decision を追加する。<br>2. Save を押す。<br>3. `.bob-trace` 配下を確認する。 |
| 期待結果 | `traceability-catalog.json` と `gate-report.md` が作成・更新される。既存 catalog は backup される。 |

### CCR-RT-011A traceability prep Webview 承認 UI と escaping

| 項目 | 内容 |
| --- | --- |
| 目的 | Webview が proposed item / link / decision を人間承認用に表示し、HTML / script 風の文字列を UI text として扱うことを確認する。 |
| 手順 | 1. `proposed` item、link、decision と、`</script><script>alert(1)</script>` を含む label / reason を catalog に入れる。<br>2. Webview を開き、accepted / rejected / deprecated へ分類する。<br>3. Gate Report と Review Input Preview を確認して Save する。 |
| 期待結果 | 文字列は実行されず表示 text として escape される。分類結果、gate report、preview が更新され、catalog 保存後も status と reason が保持される。 |

### CCR-RT-012 traceability catalog 検証

| 項目 | 内容 |
| --- | --- |
| 目的 | catalog validation と gate report 生成を command から確認する。 |
| 手順 | 1. valid / invalid catalog を用意する。<br>2. `Bob Code Consistency Review: traceability catalog を検証` を実行する。 |
| 期待結果 | `.bob-trace/gate-report.md` が更新され、error / warning 件数が通知される。 |

### CCR-RT-013 traceability AI draft prompt 生成

| 項目 | 内容 |
| --- | --- |
| 目的 | traceability AI draft 用 prompt が生成されることを確認する。 |
| 手順 | 1. catalog と docs を用意する。<br>2. `Bob Code Consistency Review: traceability AI draft 用プロンプトを作成` を実行する。 |
| 期待結果 | `.bob-trace/ai-traceability-draft/ai-draft-prompt.md` が作成され、clipboard にコピーされる。 |

### CCR-RT-014 traceability AI draft JSON 適用

| 項目 | 内容 |
| --- | --- |
| 目的 | traceability AI draft JSON を catalog に反映できることを確認する。 |
| 手順 | 1. valid traceability draft JSON を clipboard にコピーする。<br>2. `Bob Code Consistency Review: traceability AI draft JSON を catalog に反映` を実行する。 |
| 期待結果 | catalog が更新され、gate report が再生成される。 |

### CCR-RT-015 traceability catalog から review-input 生成

| 項目 | 内容 |
| --- | --- |
| 目的 | accepted item から `review-input.yaml` を生成できることを確認する。 |
| 手順 | 1. accepted requirement / design / test item を含む catalog を用意する。<br>2. `Bob Code Consistency Review: traceability catalog から review-input.yaml を生成` を実行する。<br>3. review metadata を入力する。 |
| 期待結果 | accepted item の source path / id が artifacts に反映された `review-input.yaml` が生成される。 |

### CCR-RT-016 Git preprocess

| 項目 | 内容 |
| --- | --- |
| 目的 | Git diff から review-package を生成できることを確認する。 |
| 手順 | 1. Git repository で変更を作成する。<br>2. valid `review-input.yaml` に `review.vcs: git`、base / head を設定する。<br>3. `Bob Code Consistency Review: 入力を前処理して Bob 用パッケージを作成` を実行する。 |
| 期待結果 | `.bob-review/review-package` に manifest、changed files、evidence index、bob-input.md などが生成される。 |

### CCR-RT-016A Git 複数言語 preprocess

| 項目 | 内容 |
| --- | --- |
| 目的 | C / C++ 以外の変更でも Git 差分からコード根拠を生成できることを確認する。 |
| 手順 | 1. `multi-language-git-review` sample sandbox を作成する。<br>2. `feature/multi-language-git-review` と `main` を比較する `review-input.yaml` を使う。<br>3. preprocess を実行する。 |
| 期待結果 | `changed-files.json` に `typescript`、`python`、`java` が入り、`evidence-index.json` と `code-slices/*.md` に `SRC-*` の汎用コード根拠が生成される。 |

### CCR-RT-017 Bazaar preprocess

| 項目 | 内容 |
| --- | --- |
| 目的 | Bazaar / bzr 指定時に Bazaar 差分で review-package を生成できることを確認する。 |
| 手順 | 1. Bazaar workspace または fixture を用意する。<br>2. `review.vcs: bazaar` または `bzr` を設定する。<br>3. preprocess を実行する。 |
| 期待結果 | Bazaar 差分が取り込まれ、`--no-aliases` 経路で review-package が生成される。Bazaar CLI が無い環境では fixture による代替結果を確認する。 |

### CCR-RT-018 Markdown 文書抽出

| 項目 | 内容 |
| --- | --- |
| 目的 | Markdown の見出し / section selector から evidence が生成されることを確認する。 |
| 手順 | 1. ID 付き Markdown 文書を artifacts に指定する。<br>2. preprocess を実行する。<br>3. `document-index.json` と `document-excerpts.md` を確認する。 |
| 期待結果 | 指定 section が evidence として抽出される。 |

### CCR-RT-019 docx 文書抽出

| 項目 | 内容 |
| --- | --- |
| 目的 | Word `.docx` の heading / paragraph / table 抽出を確認する。 |
| 手順 | 1. `.docx` 文書を artifacts に指定する。<br>2. preprocess を実行する。 |
| 期待結果 | heading、paragraph、table が document evidence として抽出される。 |

### CCR-RT-020 xlsx 文書抽出

| 項目 | 内容 |
| --- | --- |
| 目的 | Excel `.xlsx` の sheet / row 抽出を確認する。 |
| 手順 | 1. `.xlsx` 文書を artifacts に指定する。<br>2. sheets / rows selector を設定する。<br>3. preprocess を実行する。 |
| 期待結果 | 指定 sheet / row が table evidence として抽出され、`tables/*.md` が生成される。 |

### CCR-RT-021 C / C++ 変更解析

| 項目 | 内容 |
| --- | --- |
| 目的 | 変更関数、callee / caller、global、RT 禁止候補の抽出を確認する。 |
| 手順 | 1. C / C++ source を変更する。<br>2. preprocess を実行する。<br>3. `changed-symbols.json` と `code-slices/*.md` を確認する。 |
| 期待結果 | changed function、callee / caller、RT 禁止候補が warning / evidence に含まれる。 |

### CCR-RT-021A 汎用コード根拠 fallback

| 項目 | 内容 |
| --- | --- |
| 目的 | 詳細解析できない言語、または C / C++ header / define-only 変更で関数 evidence が無い場合も Bob が参照できる根拠が残ることを確認する。 |
| 手順 | 1. TypeScript / Python / Java 変更、または関数本体を含まない header 変更を用意する。<br>2. preprocess を実行する。<br>3. `changed-symbols.json`、`diff-context.md`、`code-slices/*.md` を確認する。 |
| 期待結果 | file scope の汎用 symbol と `SRC-*` evidence が生成され、Bob output validator が参照可能な evidence として扱う。 |

### CCR-RT-022 review-package 内容確認

| 項目 | 内容 |
| --- | --- |
| 目的 | review-package の必須ファイルが揃うことを確認する。 |
| 手順 | 1. preprocess を実行する。<br>2. `.bob-review/review-package` のファイル一覧を確認する。 |
| 期待結果 | `manifest.yaml`、`input-normalized.json`、`changed-files.json`、`changed-symbols.json`、`document-index.json`、`evidence-index.json`、`traceability-map.json`、Markdown summary、`bob-input.md`、`prompts/` が存在する。 |

### CCR-RT-023 Bob Workflow UI から preprocess 実行

| 項目 | 内容 |
| --- | --- |
| 目的 | workflow-register 経由で本拡張 provider が呼ばれることを確認する。 |
| 手順 | 1. `initializeWorkspace` 済み workspace を開く。<br>2. Bob Workflow UI から `code-consistency-review` workflow を開始する。<br>3. `preprocess-review-package` step を実行する。 |
| 期待結果 | review-package が生成され、workflow run state に command step 結果が反映される。 |

### CCR-RT-024 Bob へ bob-input.md を投入する

| 項目 | 内容 |
| --- | --- |
| 目的 | 生成された `bob-input.md` を Bob に渡してプレレビューできることを確認する。 |
| 手順 | 1. preprocess 後の `bob-input.md` を開く。<br>2. Bob Workflow UI の agent step または Bob chat で内容を使う。 |
| 期待結果 | Bob が review-package の根拠に基づく YAML 出力を生成できる。 |

### CCR-RT-025 Bob output capture: clipboard

| 項目 | 内容 |
| --- | --- |
| 目的 | clipboard から Bob 出力 YAML を取り込めることを確認する。 |
| 手順 | 1. valid Bob output YAML を clipboard にコピーする。<br>2. `Bob Code Consistency Review: Bob 出力 YAML を取り込む` を実行する。 |
| 期待結果 | `.bob-review/bob-output/bob-output.yaml` が保存される。 |

### CCR-RT-026 Bob output capture: workflow handoff

| 項目 | 内容 |
| --- | --- |
| 目的 | workflow-register result handoff / action input から Bob output を取り込めることを確認する。 |
| 手順 | 1. Bob Workflow UI で agent step 後の `capture-bob-output` step を実行する。<br>2. run state と output file を確認する。 |
| 期待結果 | assistant output が `bob-output.yaml` として保存される。 |

### CCR-RT-027 Bob output validation OK

| 項目 | 内容 |
| --- | --- |
| 目的 | schema と evidence index に合う Bob output が OK になることを確認する。 |
| 手順 | 1. valid Bob output と review-package を用意する。<br>2. `Bob Code Consistency Review: Bob 出力 YAML を検証` を実行する。 |
| 期待結果 | status ok、error 0 件が通知される。 |

### CCR-RT-028 Bob output validation error

| 項目 | 内容 |
| --- | --- |
| 目的 | unknown evidence_id や schema 不一致が error になることを確認する。 |
| 手順 | 1. unknown evidence_id を含む output を保存する。<br>2. validateOutput を実行する。 |
| 期待結果 | validation error が表示され、対象 evidence_id が report に含まれる。 |

### CCR-RT-029 Human triage 生成

| 項目 | 内容 |
| --- | --- |
| 目的 | Bob output から human triage 成果物を生成できることを確認する。 |
| 手順 | 1. valid Bob output を保存する。<br>2. `Bob Code Consistency Review: 人間確認用 triage を生成` を実行する。 |
| 期待結果 | `.bob-review/human-triage` に `triage-result.yaml`、`accepted-findings.md`、`questions-to-author.md`、`rejected-findings.md`、`follow-up-actions.md` が生成される。 |

### CCR-RT-030 End-to-End: Command Palette 経由

| 項目 | 内容 |
| --- | --- |
| 目的 | Command Palette だけで初期化から triage まで実行できることを確認する。 |
| 手順 | 1. initializeWorkspace。<br>2. createReviewInput または applyAiReviewInputDraft。<br>3. preprocess。<br>4. Bob output capture。<br>5. validateOutput。<br>6. triage。 |
| 期待結果 | review-package、bob-output、human-triage が生成され、重大な未処理例外が出ない。 |

### CCR-RT-031 End-to-End: Bob Workflow UI 経由

| 項目 | 内容 |
| --- | --- |
| 目的 | workflow-register / IBM Bob UI から同梱 workflow を実行できることを確認する。 |
| 手順 | 1. initializeWorkspace。<br>2. workflow-register reload。<br>3. Bob Workflow UI で `code-consistency-review` workflow を起動する。<br>4. preprocess、agent、capture、validate、triage の各 step を実行する。 |
| 期待結果 | run state と本拡張成果物が対応し、各 command step が成功する。 |

### CCR-RT-032 Multi-root workspace

| 項目 | 内容 |
| --- | --- |
| 目的 | `.bob` root と VCS / source root が異なる構成で動作することを確認する。 |
| 手順 | 1. `.bob` を持つ workspace と source repository を multi-root で開く。<br>2. `workflowRoot` / `workspaceRoot` / `vcs_root` を指定して preprocess を実行する。 |
| 期待結果 | review-input と成果物は Bob workspace 側、差分と source 読み込みは指定 VCS / source root 側で解決される。 |

### CCR-RT-033 文字コード: Shift-JIS / CP932

| 項目 | 内容 |
| --- | --- |
| 目的 | Shift-JIS / CP932 の文書やソースを `auto` または明示 encoding で読めることを確認する。 |
| 手順 | 1. Shift-JIS / CP932 文書またはソースを用意する。<br>2. `bobCodeConsistency.textEncoding` を `auto` / `cp932` に設定して preprocess を実行する。 |
| 期待結果 | 日本語が大きく文字化けせず、document evidence / code slices に出力される。 |

### CCR-RT-034 path escape 防止

| 項目 | 内容 |
| --- | --- |
| 目的 | workspace 外 artifact path が拒否されることを確認する。 |
| 手順 | 1. `review-input.yaml` に `../outside.md` を指定する。<br>2. preprocess または review-input builder 経路を実行する。 |
| 期待結果 | error になり、workspace 外ファイルは読み込まれない。 |

### CCR-RT-035 large diff / large document warning

| 項目 | 内容 |
| --- | --- |
| 目的 | 大きい diff / 文書で処理が破綻せず warning 付きで進むことを確認する。 |
| 手順 | 1. 大きめの diff または文書を用意する。<br>2. preprocess を実行する。 |
| 期待結果 | 上限や warning が成果物に記録され、Extension Host が停止しない。 |

## 7. 実機テスト結果記録テンプレート

| 項目 | 記入欄 |
| --- | --- |
| テスト日 |  |
| テスト担当 |  |
| OS / バージョン |  |
| VS Code / Bob IDE バージョン |  |
| IBM Bob 拡張バージョン |  |
| workflow-register commit / VSIX |  |
| bob-code-consistency-review commit / VSIX |  |
| workspace path |  |
| 実施した testcase ID |  |
| 合格 |  |
| 不合格 |  |
| 保留 |  |
| 主な不具合 / 備考 |  |

## 8. 合格基準

- CCR-RT-001 から CCR-RT-008 までの起動・初期化・review-input 作成の基本導線が合格する。
- CCR-RT-016 から CCR-RT-022 までの preprocess / review-package 生成が合格する。複数言語 sample では `SRC-*` の汎用コード根拠が生成される。
- CCR-RT-025 から CCR-RT-029 までの Bob output capture / validation / triage が合格する。
- Bob Workflow UI 経由の command provider 実行が少なくとも preprocess / capture / validate / triage で成功する。
- Developer Tools Console に未処理例外が残らない。
- workspace root 外への意図しない読み書きがない。

## 9. 回帰確認の優先度

| 優先度 | 対象 |
| --- | --- |
| P0 | 起動、workspace 初期化、review-input 検証、preprocess、Bob output capture、validate、triage。 |
| P1 | workflow-register provider、Bob Workflow UI、traceability Webview、AI draft 適用、Git / Bazaar 差分、multi-language Git sample。 |
| P2 | docx / xlsx 抽出、C / C++ 解析、汎用コード根拠 fallback、multi-root、Shift-JIS / CP932、large diff。 |
| P3 | repair、diagnostics 説明、UI 表示細部、OS 差分。 |
