# Phase 2 Git / 複数言語の整合プレレビュー CODEX向け設計・テスト計画

- 対象リポジトリ: `katamor1/bob_builtin_analyze`
- 対象ディレクトリ: `extensions/`
- 主対象拡張機能: `bob-code-consistency-review`
- 関連拡張機能: `workflow-register`, `IBM.bob-code`, `bob-bazaar-review`
- 対象フェーズ: Phase 2 Git / 複数言語の整合プレレビュー
- 作成日: 2026-07-04
- 想定読者: CODEX 実装エージェント、整合プレレビュー設計者、UAT 担当、プロジェクトリーダ、SE レビュー担当

## 1. 目的

本書は、Phase 0 で安定化した workflow 実行基盤と、Phase 1 で作成した Bazaar レビュー実績モデルを踏まえ、Git プロジェクトおよび複数開発言語に対して、要求・設計・コード・テスト仕様の整合プレレビューを実行可能にするための CODEX 向け設計・テスト計画である。

Phase 2 の狙いは、`bob-code-consistency-review` を「C/C++ の変更を中心にした実験的プレレビュー」から、「Git を主対象 VCS とし、C/C++、C#/.NET/ASP、Java、SQL を扱える部門共通の整合プレレビュー基盤」へ拡張することである。

最終的には、次のような開発工程で Bob を再利用できる状態を作る。

1. コードベース・ドキュメントベースの調査
2. 外部仕様設計、内部仕様設計、コーディング、単体テスト設計、機能テスト設計、結合テスト設計の成果物間整合確認
3. Git 差分と要求書・設計書・テスト仕様書の対応確認
4. 複数言語が混在する保守開発・メジャーアップデートでの影響候補抽出
5. Bob 出力を人間が正式レビュー前に triage し、採用・棄却・追加調査へ分類する運用

## 2. Phase 2 の位置づけ

| フェーズ | 主目的 | Phase 2 との関係 |
|---|---|---|
| Phase 0 | 基盤安定化・運用設計 | command guardrail、path 境界、VCS revision validation、CI/VSIX、privacy を前提にする。 |
| Phase 1 | Bazaar レビュー実績作成 | review record、human triage、summary 生成の実績モデルを Phase 2 の整合プレレビュー記録へ流用する。 |
| Phase 2 | Git / 複数言語の整合プレレビュー | Git プロジェクトと C/C++・C#・Java・SQL の差分から review-package を作り、Bob 整合プレレビューを実行する。 |
| Phase 3 | 工程別 workflow 展開 | Phase 2 の言語別 evidence と traceability を、設計・テスト・QA 工程別 workflow へ展開する。 |

Phase 2 では、実装対象を `bob-code-consistency-review` に集中させる。`bob-bazaar-review` の機能を Git 用に複製するのではなく、`review-input.yaml`、`review-package`、`bob-output.yaml`、human triage の一連のパイプラインを拡張する。

## 3. スコープ

### 3.1 対象 VCS

| VCS | Phase 2 の扱い |
|---|---|
| Git | 主対象。base/head、branch、commit range、working tree 差分、rename、delete、binary、submodule を扱う。 |
| Bazaar | 既存互換。Phase 2 の主開発対象ではないが、共通 VCS interface の regression 対象に含める。 |

### 3.2 対象言語

| 言語 / 技術 | Phase 2 の最小対応 | 主な観点 |
|---|---|---|
| C/C++ | 既存 C/C++ 解析を強化し、関数、ヘッダ、define、global、構造体、API export を扱う。 | インターフェース影響、共有データ、RT/TS 制約、テスト観点。 |
| C# / .NET / ASP | `.cs`, `.csproj`, `.sln`, `.aspx`, `.cshtml`, config を分類し、クラス、メソッド、Controller、public API 候補を抽出する。 | Web/API 影響、DB access、設定、UI/UX、単体テスト不足。 |
| Java | `.java`, Maven/Gradle metadata、package/class/method、Spring Controller/Service/Repository 候補を抽出する。 | API 影響、例外処理、依存関係、テスト不足、バージョン更新影響。 |
| SQL | `.sql`, migration、DDL/DML、stored procedure、view、trigger、table/index 参照を抽出する。 | schema 互換、性能、データ移行、既存機能への副作用。 |

### 3.3 対象開発タイプ

| 開発タイプ | Phase 2 の扱い |
|---|---|
| 既存製品の保守開発 | bugfix、機能追加、UX 改善を主対象に、要求・設計・テストとの不足や意図しない変更を抽出する。 |
| 既存製品のメジャーアップデート | 画面刷新、大きな機能追加、言語バージョン変更、言語変更を含む場合は、interface-impact と document-update-gap を強く見る。 |

### 3.4 Phase 2 で実装しないこと

- 自動修正 patch の生成
- CI への自動 gate 組み込み
- 静的解析ツール並みの完全な AST / type resolution
- すべての framework 固有規約の網羅
- Git push / branch 作成 / merge など VCS 書き込み操作
- Bob 出力の自動採用
- 本番データベースへの接続や SQL 実行

## 4. Phase 2 の完了定義

| 区分 | 完了条件 |
|---|---|
| Git support | Git base/head、commit range、working tree の差分を安全に収集し、`changed-files.json` と `diff-context.md` に反映できる。 |
| language adapters | C/C++、C#、Java、SQL の変更ファイル分類と最小 symbol / evidence 抽出ができる。 |
| review-package v2 | 複数言語の evidence を統一形式で `review-package` に格納できる。 |
| traceability | 元文書を変更せず、`.bob-trace/traceability-catalog.json` から accepted item を `review-input.yaml` へ変換できる。 |
| Bob prompt | 複数言語の evidence を Bob に渡す prompt template があり、言語別の確認観点を含む。 |
| output validation | Bob 出力 YAML を schema と `evidence-index.json` に照らして検証できる。 |
| human triage | Bob 出力を人間が採用・棄却・追加調査・正式レビュー送りへ分類できる。 |
| UAT | Git + C/C++、Git + C#、Git + Java、Git + SQL の代表 fixture または実案件相当サンプルで E2E 確認できる。 |
| compatibility | 既存 Bazaar / C/C++ 最小シナリオを壊さない。 |

## 5. 既存資産の利用方針

既存の `bob-code-consistency-review` は、すでに `review-input.yaml`、traceability sidecar、review-package、Bob 出力検証、human triage の流れを持っている。Phase 2 ではこの構造を維持し、以下の軸で拡張する。

| 既存資産 | Phase 2 での拡張方針 |
|---|---|
| `review-input.yaml` | `analysis_options.language` と VCS 指定を強化し、Git / 複数言語を明示的に扱う。 |
| `ReviewInputDraft` | `language_profile`、`project_type`、`framework_hint`、`db_hint` を追加候補にする。 |
| `.bob-trace/traceability-catalog.json` | 言語別 code evidence との対応、stale 判定、未対応レビュー指摘を扱う。 |
| `review-package` | `language-summary.json`、`interface-impact.json`、`db-impact.json` などを追加候補にする。 |
| `changed-symbols.json` | C/C++ 固有から `changed-symbols-v2.json` へ発展させ、language adapter ごとの symbol を格納する。 |
| `bob-input.md` | 言語別の確認観点と evidence index を含む。 |
| `bob-output.yaml` | 複数言語の findings、evidence reference、triage hint を schema 化する。 |
| `human triage` | findings を言語、工程、review_focus、evidence に紐付けて判断できるようにする。 |

## 6. 成果物モデル

### 6.1 review-package v2 配置

既存の `.bob-review/review-package` を維持しつつ、Phase 2 では次を追加する。

```text
.bob-review/
  review-package/
    manifest.yaml
    input-normalized.json
    changed-files.json
    changed-symbols.json
    changed-symbols-v2.json
    language-summary.json
    interface-impact.json
    db-impact.json
    document-index.json
    evidence-index.json
    traceability-map.json
    change-summary.md
    diff-context.md
    document-excerpts.md
    deterministic-checks.md
    bob-input.md
    prompts/
      system.md
      task.md
      output-format.md
      language-guidance.md
    code-slices/
      <evidence_id>.md
    tables/
      <evidence_id>.md
```

### 6.2 language-summary.json

```json
{
  "schema_version": "language-summary/v1",
  "languages": [
    {
      "language": "csharp",
      "files_changed": 8,
      "symbols_changed": 14,
      "framework_hints": ["aspnet", "entity-framework"],
      "primary_risks": ["interface-impact", "test-gap", "db-impact"]
    }
  ],
  "mixed_language": true,
  "warnings": []
}
```

### 6.3 changed-symbols-v2.json

```json
{
  "schema_version": "changed-symbols/v2",
  "symbols": [
    {
      "evidence_id": "CODE-CS-0001",
      "language": "csharp",
      "file": "src/Web/Controllers/OrderController.cs",
      "symbol_kind": "method",
      "name": "OrderController.Submit",
      "visibility": "public",
      "change_kind": "modified",
      "line_range": { "start": 42, "end": 88 },
      "risk_tags": ["api", "validation", "test-gap"]
    }
  ]
}
```

### 6.4 interface-impact.json

```json
{
  "schema_version": "interface-impact/v1",
  "items": [
    {
      "evidence_id": "IF-0001",
      "language": "java",
      "file": "src/main/java/com/example/UserController.java",
      "interface_kind": "rest-endpoint",
      "name": "POST /users",
      "change_kind": "modified",
      "compatible": "unknown",
      "reason": "request validation changed; API specification evidence not found"
    }
  ]
}
```

### 6.5 db-impact.json

```json
{
  "schema_version": "db-impact/v1",
  "items": [
    {
      "evidence_id": "DB-0001",
      "language": "sql",
      "file": "db/migration/V42__alter_customer.sql",
      "object_kind": "table",
      "object_name": "customer",
      "operation": "alter_table",
      "risk_tags": ["schema-compatibility", "migration", "performance"]
    }
  ]
}
```

## 7. CODEX 実装原則

CODEX は次を守る。

1. 既存 command ID、workflow provider ID、schema enum を破壊的に変更しない。
2. `review-input.yaml`、`bob-output.yaml`、`review-package` の既存正常系 fixture を壊さない。
3. Git revision は Phase 0 方針どおり、diff 前に安全に解決する。
4. path は workspace 内に限定し、absolute path や `..` escape を許可しない。
5. 言語別 analyzer は best-effort とし、不明点は `unknown` / `warning` として Bob と人間に渡す。
6. AI には最終 YAML、正式承認、採否判断を直接させない。
7. Bob 出力は schema と evidence reference で検証する。
8. human triage を正式レビュー前の判断点にする。
9. SQL は解析対象であり、実データベースへ接続・実行しない。
10. 言語 adapter は独立モジュールとして追加し、pipeline 本体に言語固有 if 文を増やしすぎない。

## 8. Work package 一覧

| ID | 対象 | 名称 | 優先度 | 主な成果物 |
|---|---|---|---:|---|
| P2-CCR-01 | VCS | Git diff collector v1 | 1 | Git revision resolver、changed-files、diff-context、rename/binary handling |
| P2-CCR-02 | core | VCS provider interface 統一 | 1 | Git/Bazaar 共通 interface、VCS regression tests |
| P2-CCR-03 | core | language adapter interface | 1 | Analyzer interface、language classifier、adapter registry |
| P2-CCR-04 | C/C++ | C/C++ analyzer v2 | 2 | function/header/global/interface evidence、RT/TS hints |
| P2-CCR-05 | C#/.NET/ASP | C# analyzer v1 | 2 | class/method/controller/view/config evidence |
| P2-CCR-06 | Java | Java analyzer v1 | 2 | package/class/method/controller/service evidence |
| P2-CCR-07 | SQL | SQL analyzer v1 | 2 | DDL/DML/object impact evidence |
| P2-CCR-08 | review-package | review-package v2 / evidence schema | 1 | language-summary、changed-symbols-v2、interface/db impact |
| P2-CCR-09 | review-input | Git / language aware review-input builder | 2 | language_profile、framework_hint、wizard / AI draft 更新 |
| P2-CCR-10 | Bob prompt/output | multi-language prompt / output schema | 2 | language-guidance、bob-output schema v2、validator tests |
| P2-CCR-11 | triage/metrics | consistency triage / summary 強化 | 3 | language別 triage、accepted finding metrics |
| P2-UAT-01 | test/docs | Git multi-language E2E fixtures / UAT | 1 | C/C++、C#、Java、SQL fixture と UAT checklist |
| P2-OPS-01 | docs | 運用テンプレート・報告書 | 3 | review campaign、実績報告、導入手順 |

## 9. P2-CCR-01: Git diff collector v1

### 9.1 目的

Git プロジェクトで base/head、commit range、working tree 差分を安全に収集し、review-package の基礎情報を作る。

### 9.2 設計

#### 9.2.1 Git revision resolver

Git diff 前に revision を full SHA へ解決する。

```bash
git rev-parse --verify --end-of-options <rev>^{commit}
```

方針:

- `--end-of-options` を必ず使う。
- `--help` や `--output=...` のような option injection を拒否する。
- 解決できない revision は validation error にする。
- working tree review では `head` を解決し、未コミット差分を別 block として扱う。

#### 9.2.2 changed files

`git diff --name-status` 相当の情報から、次を抽出する。

| 項目 | 内容 |
|---|---|
| status | added / modified / deleted / renamed / copied / typechanged / unmerged / unknown |
| old_path | rename / copy の元 path |
| path | 現在 path |
| language | language classifier の結果 |
| binary | binary 判定 |
| generated | generated file 候補 |
| large | size / diff 上限超過候補 |

#### 9.2.3 diff context

- unified diff は上限付きで取得する。
- binary file は本文を含めず metadata のみにする。
- rename は old/new の対応を保持する。
- submodule は commit 変更として記録し、内部 diff は追わない。

### 9.3 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| commit range | `HEAD~1..HEAD` を収集する。 | changed-files と diff-context が生成される。 |
| branch name | branch を resolver に渡す。 | full SHA に解決される。 |
| option injection | `--help` を base に渡す。 | diff 実行前に拒否。 |
| rename | file rename を含む diff。 | old_path / path / status が記録される。 |
| binary | binary file 変更。 | raw binary は含めず warning。 |
| working tree | 未コミット変更を収集。 | staged / unstaged の扱いが記録される。 |
| submodule | submodule 変更。 | submodule metadata として記録される。 |

### 9.4 受け入れ条件

- Git 差分が `changed-files.json`、`diff-context.md` に反映される。
- 危険な revision 入力が Git CLI に渡らない。
- Bazaar 既存処理を壊さない。

## 10. P2-CCR-02: VCS provider interface 統一

### 10.1 目的

Git と Bazaar の差分収集を同じ pipeline から扱えるようにする。

### 10.2 設計

追加候補:

```text
extensions/bob-code-consistency-review/src/core/vcs/vcsProvider.ts
extensions/bob-code-consistency-review/src/core/vcs/gitProvider.ts
extensions/bob-code-consistency-review/src/core/vcs/bazaarProvider.ts
extensions/bob-code-consistency-review/src/core/vcs/vcsTypes.ts
```

Interface 例:

```ts
export type VcsProvider = {
  readonly type: "git" | "bazaar"
  resolveRange(input: ReviewRangeInput): Promise<ResolvedReviewRange>
  collectChangedFiles(range: ResolvedReviewRange): Promise<ChangedFile[]>
  collectDiffContext(range: ResolvedReviewRange, files: ChangedFile[]): Promise<DiffContext>
}
```

### 10.3 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| provider select | `review.vcs: git` | Git provider が選ばれる。 |
| provider select | `review.vcs: bazaar` | Bazaar provider が選ばれる。 |
| invalid vcs | `review.vcs: svn` | schema validation error。 |
| normalized output | Git/Bazaar の changed file を比較。 | pipeline が同じ型で扱える。 |

### 10.4 受け入れ条件

- pipeline が VCS 固有実装を直接呼ばない。
- Git/Bazaar の regression fixture が通る。
- 新しい VCS を将来追加しやすい構造になる。

## 11. P2-CCR-03: language adapter interface

### 11.1 目的

C/C++、C#、Java、SQL の解析を adapter として分離し、review-package に統一 evidence を出力する。

### 11.2 設計

追加候補:

```text
extensions/bob-code-consistency-review/src/core/languages/languageClassifier.ts
extensions/bob-code-consistency-review/src/core/languages/languageAdapter.ts
extensions/bob-code-consistency-review/src/core/languages/languageRegistry.ts
extensions/bob-code-consistency-review/src/core/languages/adapters/cppAdapter.ts
extensions/bob-code-consistency-review/src/core/languages/adapters/csharpAdapter.ts
extensions/bob-code-consistency-review/src/core/languages/adapters/javaAdapter.ts
extensions/bob-code-consistency-review/src/core/languages/adapters/sqlAdapter.ts
```

Interface 例:

```ts
export type LanguageAdapter = {
  readonly language: SupportedLanguage
  classify(file: ChangedFile): LanguageClassification
  analyze(input: LanguageAnalysisInput): Promise<LanguageAnalysisResult>
}
```

`LanguageAnalysisResult` は次を返す。

- symbols
- interface impacts
- db impacts
- test hints
- warnings
- code slices
- evidence refs

### 11.3 language classifier

| 拡張子 / file | language |
|---|---|
| `.c`, `.h`, `.cpp`, `.hpp`, `.cc`, `.hh` | c_cpp |
| `.cs`, `.csproj`, `.sln`, `.aspx`, `.ascx`, `.cshtml`, `web.config`, `appsettings*.json` | csharp |
| `.java`, `pom.xml`, `build.gradle`, `settings.gradle` | java |
| `.sql`, `*.ddl`, `*.dml`, migration folders | sql |

### 11.4 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| classify c | `.cpp` と `.h` | c_cpp に分類。 |
| classify csharp | `.cs`, `.csproj`, `.cshtml` | csharp に分類。 |
| classify java | `.java`, `pom.xml` | java に分類。 |
| classify sql | migration `.sql` | sql に分類。 |
| unknown | `.png` | unknown / binary 扱い。 |
| registry | 複数 adapter 登録 | language ごとに適切な adapter が呼ばれる。 |

### 11.5 受け入れ条件

- 言語別処理が adapter へ分離される。
- unknown file は安全に warning 化される。
- pipeline 本体が言語ごとの詳細 parsing に依存しない。

## 12. P2-CCR-04: C/C++ analyzer v2

### 12.1 目的

既存 C/C++ 解析を、複数言語 adapter 方式へ移行しつつ強化する。

### 12.2 解析対象

- 関数定義 / 宣言
- `#define` / macro 変更
- `struct` / `enum` / `typedef` 変更
- global / static 変数候補
- header include 変更
- exported API 候補
- RT / TS 禁止処理候補
- 単体テスト対象候補

### 12.3 risk tags

| tag | 意味 |
|---|---|
| `interface-impact` | ヘッダ、export、public API 相当の変更。 |
| `shared-memory-impact` | global / struct / shared data 変更。 |
| `rt-ts-rule` | RT / TS 制約に関わる可能性。 |
| `test-gap` | 対応テストが見つからない可能性。 |

### 12.4 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| function change | C 関数の body 変更。 | method/function symbol が出る。 |
| header API | `.h` の関数宣言変更。 | interface-impact が出る。 |
| struct change | struct field 追加。 | shared-memory-impact 候補。 |
| macro change | `#define` 値変更。 | changed symbol と warning。 |
| test hint | `src/foo.c` 変更で `test/foo_test.c` なし。 | test-gap hint。 |

### 12.5 受け入れ条件

- 既存 C/C++ fixture が通る。
- `changed-symbols-v2.json` に C/C++ symbol が出る。
- Bob prompt に C/C++ 固有観点が入る。

## 13. P2-CCR-05: C# / .NET / ASP analyzer v1

### 13.1 目的

C# / .NET / ASP 系プロジェクトの Git 差分を整合プレレビューに載せる。

### 13.2 解析対象

- class / interface / enum
- public / internal method
- Controller / Action 候補
- Razor / ASPX view 変更
- `.csproj` / `.sln` dependency 変更
- config 変更 (`web.config`, `appsettings*.json`)
- DB access hint (`DbContext`, SQL literal, repository pattern)
- test project / test method 候補

### 13.3 framework hints

| hint | 判定例 |
|---|---|
| `aspnet-mvc` | Controller, ActionResult, `.cshtml` |
| `aspnet-webforms` | `.aspx`, `.ascx`, code-behind |
| `web-api` | ApiController, route attributes |
| `entity-framework` | DbContext, migration, LINQ query |
| `dotnet-test` | xUnit, NUnit, MSTest attributes |

### 13.4 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| controller change | Controller method 変更。 | interface-impact / web-api hint。 |
| view change | `.cshtml` 変更。 | UI/UX impact hint。 |
| csproj change | package reference 変更。 | dependency-impact warning。 |
| config change | `appsettings.json` 変更。 | configuration-impact warning。 |
| test gap | service method 変更で test なし。 | test-gap hint。 |

### 13.5 受け入れ条件

- C# 系ファイルが language-summary に出る。
- Controller / public method / config 変更が Bob input に evidence として含まれる。
- SQL 実行や build 実行に依存しない。

## 14. P2-CCR-06: Java analyzer v1

### 14.1 目的

Java プロジェクトの Git 差分を整合プレレビューに載せる。

### 14.2 解析対象

- package / class / interface / enum
- public method
- Spring Controller / Service / Repository hint
- Maven / Gradle dependency 変更
- config (`application*.properties`, `application*.yml`) 変更
- exception handling 変更
- JUnit / test class 候補

### 14.3 framework hints

| hint | 判定例 |
|---|---|
| `spring-web` | `@RestController`, `@Controller`, `@RequestMapping` |
| `spring-service` | `@Service` |
| `spring-data` | `@Repository`, repository interface |
| `maven` | `pom.xml` |
| `gradle` | `build.gradle` |
| `junit` | `@Test`, test source path |

### 14.4 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| rest controller | `@RestController` method 変更。 | interface-impact。 |
| service logic | Service method 変更。 | design-code-consistency / test-gap hint。 |
| pom change | dependency version 変更。 | dependency-impact warning。 |
| config change | `application.yml` 変更。 | configuration-impact warning。 |
| test exists | `src/test` に対応テストあり。 | test evidence candidate。 |

### 14.5 受け入れ条件

- Java 系ファイルが language-summary に出る。
- Spring / Maven / Gradle の代表 hint が抽出される。
- Bob prompt に Java 固有確認観点が入る。

## 15. P2-CCR-07: SQL analyzer v1

### 15.1 目的

SQL ファイル変更を、データ互換性・性能・移行リスクの観点で整合プレレビューに載せる。

### 15.2 解析対象

- CREATE / ALTER / DROP TABLE
- CREATE / ALTER VIEW
- CREATE / ALTER PROCEDURE / FUNCTION
- TRIGGER
- INDEX
- INSERT / UPDATE / DELETE
- migration file naming
- referenced table / column 候補

### 15.3 DB dialect hints

| dialect | 判定例 |
|---|---|
| `sqlserver` | `GO`, `NVARCHAR`, `[schema]`, T-SQL procedure |
| `postgresql` | `SERIAL`, `JSONB`, `plpgsql`, `public.` |
| `mysql` | backtick identifier, `AUTO_INCREMENT`, delimiter |
| `generic` | dialect 不明 |

### 15.4 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| alter table | column 追加。 | db-impact item。 |
| drop column | column 削除。 | compatibility risk。 |
| index change | index 追加 / 削除。 | performance risk / improvement hint。 |
| stored procedure | procedure 変更。 | interface-impact / db-impact。 |
| dialect | SQL Server / PostgreSQL / MySQL fixture。 | dialect hint が出る。 |

### 15.5 受け入れ条件

- SQL ファイルが db-impact に反映される。
- 実 DB 接続なしで解析できる。
- Bob prompt に SQL 固有確認観点が入る。

## 16. P2-CCR-08: review-package v2 / evidence schema

### 16.1 目的

複数言語の解析結果を、Bob と人間が追跡しやすい evidence 形式へ統合する。

### 16.2 evidence ID 方針

| prefix | 用途 |
|---|---|
| `CODE-C-` | C/C++ code evidence |
| `CODE-CS-` | C# code evidence |
| `CODE-JAVA-` | Java code evidence |
| `CODE-SQL-` | SQL evidence |
| `IF-` | interface impact |
| `DB-` | DB impact |
| `DOC-` | document excerpt |
| `TRACE-` | traceability map |

### 16.3 deterministic checks

- evidence ID 重複
- evidence file path の workspace escape
- Bob output が存在しない evidence を参照していないか
- checklist / review_focus と evidence type の不整合
- 大きすぎる code slice の truncation warning
- language adapter warning の集約

### 16.4 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| duplicate evidence | 同じ evidence_id を生成。 | deterministic-checks に error。 |
| missing evidence | Bob output が存在しない evidence を参照。 | validateOutput で error。 |
| mixed language | C# + SQL diff。 | language-summary と db-impact が生成される。 |
| truncation | 大きい code slice。 | warning と上限内 slice。 |

### 16.5 受け入れ条件

- `evidence-index.json` が複数言語 evidence を参照できる。
- Bob output validation が evidence reference を厳格に確認する。
- 既存 review-package v1 fixture が破壊されない。

## 17. P2-CCR-09: Git / language aware review-input builder

### 17.1 目的

人間が review-input.yaml をフル手書きせず、Git range、対象言語、関連文書、レビュー観点を選べるようにする。

### 17.2 `ReviewInputDraft` 拡張候補

```ts
export type ReviewInputDraftV2 = ReviewInputDraft & {
  language_profile?: Array<"c_cpp" | "csharp" | "java" | "sql">
  project_type?: "maintenance" | "major_update"
  framework_hint?: string[]
  db_hint?: string[]
}
```

### 17.3 wizard 更新

- Git / Bazaar 選択
- Git base/head 入力
- working tree review 選択
- 変更ファイルから言語候補を自動表示
- 関連文書候補を文書種別ごとに表示
- focus preset を project type に応じて提示

### 17.4 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| Git wizard | base/head と docs を選ぶ。 | `review-input.yaml` が生成される。 |
| language auto | changed files から C# + SQL を検出。 | language_profile が補完される。 |
| AI draft | AI が未許可 language を返す。 | builder / validator で拒否。 |
| path validation | 存在しない artifact path。 | 保存不可。 |

### 17.5 受け入れ条件

- Git + language profile を含む review-input が生成できる。
- AI draft は JSON object のみに限定され、builder / validator を通る。
- 人間が traceability / review-input を承認する導線を維持する。

## 18. P2-CCR-10: multi-language prompt / output schema

### 18.1 目的

Bob が複数言語 evidence を混同せず、要求・設計・テストとの不整合候補を構造化して返せるようにする。

### 18.2 prompt template 追加

```text
resources/templates/prompts/consistency-review-v2/
  system.md
  task.md
  language-guidance.md
  output-format.md
```

`language-guidance.md` には次を含める。

- C/C++: header/API、shared data、RT/TS、memory/error handling
- C#: Controller/API、View、config、DB access、test project
- Java: Controller/Service/Repository、dependency、exception、test
- SQL: DDL/DML、migration、compatibility、performance

### 18.3 Bob output schema v2

既存 schema と互換性を保ちながら、finding に次を追加候補とする。

```yaml
language: csharp
finding_type: design-code-consistency
severity: warning
evidence_refs:
  - CODE-CS-0001
  - DOC-BD-0003
impact:
  interface: true
  database: false
  tests: true
human_triage_hint: needs_investigation
```

### 18.4 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| schema v1 | 既存 Bob output fixture。 | 互換で valid。 |
| schema v2 | language / evidence_refs 付き output。 | valid。 |
| missing evidence | 存在しない evidence_refs。 | validateOutput で error。 |
| invalid language | `language: ruby`。 | schema error。 |
| prompt assembly | C# + SQL package。 | language-guidance に C# と SQL 観点が入る。 |

### 18.5 受け入れ条件

- Bob output v2 が evidence-index と整合する。
- 既存 v1 output も migration または互換 path で扱える。
- Bob prompt に言語別の禁止事項と確認観点が入る。

## 19. P2-CCR-11: consistency triage / summary 強化

### 19.1 目的

Phase 2 の整合プレレビュー結果を、言語別・工程別・レビュー観点別に人間が判断し、集計できるようにする。

### 19.2 triage 拡張

```yaml
schema_version: consistency-triage/v2
review_id: order-submit-git-r1
items:
  - finding_id: F-001
    language: csharp
    review_focus: requirement-code-consistency
    decision: accepted
    next_action: fix_code
    target_phase: coding
    owner: se-name
    evidence_refs:
      - CODE-CS-0001
      - REQ-0002
```

### 19.3 metrics

| 指標 | 意味 |
|---|---|
| findings_by_language | 言語別 finding 件数。 |
| accepted_by_language | 言語別採用件数。 |
| findings_by_focus | review_focus 別 finding 件数。 |
| document_gap_count | 文書更新不足候補。 |
| test_gap_count | テスト不足候補。 |
| interface_impact_count | interface impact 候補。 |
| db_impact_count | DB impact 候補。 |

### 19.4 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| triage v2 | language 付き findings を triage。 | language 別 summary が出る。 |
| invalid decision | 未許可 decision。 | validation error。 |
| missing evidence | evidence_refs が存在しない。 | validation error。 |
| summary | 複数言語 findings を集計。 | language / focus 別件数が一致。 |

### 19.5 受け入れ条件

- 人間判断を source of truth にできる。
- Phase 1 の実績報告モデルへ接続できる。
- 言語別・工程別の改善 backlog を作れる。

## 20. P2-UAT-01: Git multi-language E2E fixtures / UAT

### 20.1 目的

Git と複数言語の整合プレレビューを、実案件投入前に fixture で再現できるようにする。

### 20.2 fixture 候補

```text
docs/workflows/code-consistency-review/examples/
  git-cpp-bugfix/
  git-csharp-webapi-change/
  git-java-service-change/
  git-sql-migration-change/
  git-mixed-csharp-sql-change/
```

各 fixture は次を持つ。

```text
README.md
repo/
  <sample source>
docs/
  requirements.md
  basic-design.md
  detailed-design.md
  test-spec.md
expected/
  review-input.yaml
  changed-files.json
  changed-symbols-v2.json
  evidence-index.json
  bob-output.valid.yaml
  triage.yaml
```

### 20.3 UAT ケース

| ID | ケース | 期待結果 |
|---|---|---|
| P2-UAT-001 | Git + C/C++ bugfix | function / header evidence と test-gap が出る。 |
| P2-UAT-002 | Git + C# Web API change | Controller / config / test-gap evidence が出る。 |
| P2-UAT-003 | Git + Java service change | Service / dependency / test evidence が出る。 |
| P2-UAT-004 | Git + SQL migration | db-impact と document-update-gap が出る。 |
| P2-UAT-005 | Git + C# + SQL mixed change | interface-impact と db-impact が同じ review-package に入る。 |
| P2-UAT-006 | Git working tree precommit | 未コミット差分から review-package が作れる。 |
| P2-UAT-007 | invalid Git revision | diff 実行前に validation error。 |
| P2-UAT-008 | Bob output missing evidence | validateOutput で error。 |

### 20.4 合格基準

- 少なくとも C/C++、C#、Java、SQL の各 1 fixture が E2E 成功する。
- Git 差分収集から Bob output validation、human triage まで通る。
- invalid input の negative test が通る。
- 既存 Bazaar scenario が regression として成功する。

## 21. P2-OPS-01: 運用テンプレート・報告書

### 21.1 目的

Phase 2 の結果を、7 プロジェクトへ横展開するための報告・導入テンプレートにする。

### 21.2 追加 docs 候補

```text
docs/uat/git-multilanguage-consistency-uat-plan-ja.md
docs/ops/code-consistency-review-rollout-guide-ja.md
docs/metrics/code-consistency-review-metrics-ja.md
docs/templates/code-consistency-review-report-template-ja.md
```

### 21.3 報告テンプレート項目

- project / repository / language profile
- review target: base/head, changed files, changed languages
- linked documents: requirements, basic design, detailed design, test spec
- findings by language
- findings by review_focus
- accepted / rejected / needs_investigation
- document update gap
- test gap
- interface / DB impact
- estimated review preparation time reduction
- next action backlog

### 21.4 受け入れ条件

- プロジェクトリーダが Phase 2 結果を確認できる summary を生成できる。
- 言語別・工程別に改善 backlog を作れる。
- Phase 3 の工程別 workflow 展開判断に使える。

## 22. 全体テスト戦略

### 22.1 テスト層

| 層 | 目的 | 対象 |
|---|---|---|
| unit | Git resolver、language classifier、adapter、schema validator を高速検証する。 | `src/core/vcs`, `src/core/languages`, `src/core/validators` |
| fixture integration | sample repo と docs から review-package を生成する。 | examples / fixtures |
| command integration | VS Code command と workflow action provider を検証する。 | preprocess, capture, validate, triage |
| workflow integration | `code-consistency-review` workflow を通す。 | workflow-register + bob-code-consistency-review |
| real-machine UAT | 実 Git workspace / Bob IDE で確認する。 | UAT project |

### 22.2 共通 negative tests

| 観点 | 異常入力 | 期待結果 |
|---|---|---|
| Git revision | `--help`, `--output=...`, 存在しない rev | diff 実行前に拒否。 |
| path | absolute path, `../`, symlink escape | validation error。 |
| language | 未対応 language を AI draft が返す | builder / schema で拒否。 |
| output | 存在しない evidence ref | validateOutput error。 |
| package | duplicate evidence ID | deterministic-checks error。 |
| SQL | 実 DB 接続要求 | 実行せず、unsupported warning。 |
| binary | binary diff | raw binary を package に含めない。 |

## 23. CODEX への作業指示テンプレート

```text
対象: <P2 work package ID>
目的: <1文で目的>
変更対象:
- <path>

制約:
- 既存 command ID / workflow provider ID を変更しない。
- 既存 review-input / bob-output fixture を壊さない。
- Git revision は diff 前に resolver を通す。
- workspace 外 path を許可しない。
- 言語 adapter は best-effort とし、解析不能時は warning にする。
- SQL は実行しない。
- Bob 出力は schema と evidence-index で検証する。
- README/docs とテストを同時に更新する。

実装内容:
1. <実装ステップ>
2. <実装ステップ>
3. <実装ステップ>

テスト:
- npm run compile
- npm run test
- 追加 unit test: <list>
- 追加 fixture / UAT: <list>

完了条件:
- <受け入れ条件>
```

## 24. 推奨実装順

Phase 2 は次の順序で進める。

1. `P2-CCR-01`: Git diff collector v1
2. `P2-CCR-02`: VCS provider interface 統一
3. `P2-CCR-03`: language adapter interface
4. `P2-CCR-08`: review-package v2 / evidence schema
5. `P2-UAT-01`: 最小 Git fixture を先に追加
6. `P2-CCR-04`: C/C++ analyzer v2
7. `P2-CCR-05`: C# analyzer v1
8. `P2-CCR-06`: Java analyzer v1
9. `P2-CCR-07`: SQL analyzer v1
10. `P2-CCR-09`: Git / language aware review-input builder
11. `P2-CCR-10`: multi-language prompt / output schema
12. `P2-CCR-11`: consistency triage / summary 強化
13. `P2-OPS-01`: 運用テンプレート・報告書

Git collector、VCS interface、language adapter interface を先に固める理由は、後続の言語別 analyzer を同じ契約で追加できるようにするためである。

## 25. CODEX レビュー観点

| 観点 | 確認内容 |
|---|---|
| VCS safety | Git revision / path / binary / submodule を安全に扱っているか。 |
| adapter isolation | 言語別処理が adapter に閉じ、pipeline が肥大化していないか。 |
| evidence integrity | evidence ID、evidence-index、Bob output refs が整合しているか。 |
| human-in-the-loop | AI draft、traceability、Bob findings の承認を人間が行う導線が残っているか。 |
| compatibility | 既存 Bazaar / C/C++ / review-package v1 fixture を壊していないか。 |
| privacy | diff、文書抜粋、コード slice の保存範囲と共有範囲が明確か。 |
| operability | UAT 担当が fixture と手順で再実行できるか。 |
| maintainability | analyzer / VCS / schema / prompt が責務別に分かれているか。 |

## 26. Phase 2 の成功指標

| 指標 | 目標 |
|---|---|
| Git E2E fixture 成功数 | 4 言語それぞれ 1 件以上。 |
| Bob output validation 成功率 | UAT 対象で 90% 以上。 |
| evidence ref validation error | 正常 fixture で 0 件。 |
| human triage 完了率 | UAT record の 100%。 |
| accepted finding rate | 実案件 UAT で継続測定。Phase 2 では基準値を作る。 |
| review preparation time | baseline と Bob-assisted を両方記録する。 |
| regression | Phase 1 Bazaar review 実績作成導線を壊さない。 |

## 27. 参照資料

- `docs/phase0-foundation-stabilization-codex-plan-ja.md`
- `docs/phase1-bazaar-review-record-codex-plan-ja.md`
- `extensions/bob-code-consistency-review/README.md`
- `docs/workflows/code-consistency-review/README.md`
- `docs/workflows/code-consistency-review/review-input-schema.md`
- `docs/workflows/code-consistency-review/review-package-spec.md`
- `docs/workflows/code-consistency-review/bob-output-schema.md`
- `extensions/workflow-register/README.md`
- `extensions/README.md`

## 28. 推奨コミット

```text
docs: add phase 2 Git multilanguage consistency prereview Codex plan
```
