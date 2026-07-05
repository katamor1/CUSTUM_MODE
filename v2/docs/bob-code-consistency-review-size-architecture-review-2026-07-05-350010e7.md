# bob-code-consistency-review 拡張機能 サイズ・構造レビュー

- 対象リポジトリ: `katamor1/bob_builtin_analyze`
- 対象 ref: `350010e766d99ad19a0bba5bf11e2cbd0ee04e62`
- 対象拡張: `extensions/bob-code-consistency-review`
- レビュー日: 2026-07-05
- レビュー種別: GitHub 上のソース、設定、テスト、既存レビュー結果に基づく静的レビュー

## 0. レビュー方法と前提

本レビューは、指定 ref の `extensions/bob-code-consistency-review` を対象に、以下の観点で静的に確認した。

- コードサイズ
- ファイルサイズ
- モジュール分割
- 依存パッケージ・bundle サイズ
- 未使用コード
- 循環依存
- 暗黙依存
- union / mapped type などの型定義の量やサイズ
- barrel export の集中度
- 自動テスト密度

このレビュー内では、ローカル checkout、`npm ci`、`npm run compile`、`npm test`、`npm audit`、`vsce package` は実行していない。そのため VSIX 実サイズ、`node_modules` 実サイズ、全ファイル行数の最終実測は、後述の実測コマンドで CI 成果物として残す前提で評価している。

ただし、主要ファイルの内容、`package.json` / `package-lock.json` / `.vscodeignore` / `tsconfig.json` / テストファイルは指定 ref で確認した。

## 1. 総評

`bob-code-consistency-review` は、2026-07-04 時点のレビューで指摘されていた「巨大 entrypoint」「document extractor の肥大化」「C/C++ analyzer の単一ファイル集中」「path boundary」「VCS revision validation」「生成物サイズ制御」「bundle hygiene」の多くに手が入っている。

特に良い改善は次の通り。

1. `extension.ts` は command 登録と workflow provider 登録にほぼ限定され、実装は `commands/*`、`reviewExecutionCommands.ts`、`traceabilityCommands.ts` に分離された。
2. 文書抽出は `documentExtractor.ts` が dispatcher となり、Markdown / DOCX / XLSX の処理が個別 extractor へ分かれた。
3. C/C++ 解析は diff parser、symbol detector、renderer に分割され、さらに非 C/C++ 向けの generic evidence analyzer が追加された。
4. `resolveWorkspacePathStrict` と `resolveWorkspacePathForKind` により、workspace 内 containment と `.bob-review` / `.bob-trace` 配下の生成物配置 policy が明文化された。
5. Git revision は SHA 解決、Bazaar revision は allowlist validation、`bzrPath` は workflow args override 禁止となり、外部コマンド実行面のリスクがかなり下がった。
6. `maxDocumentBytes`、`maxRawDiffBytes`、`maxBobInputBytes` などの処理上限が設定化された。
7. `xlsx` から `read-excel-file` へ置換され、DOCX / XLSX 系の重い依存は dynamic import で遅延ロードされている。
8. `architecture:policy`、`source:policy`、`unused:report`、`dependency:policy`、`audit:prod`、`package:policy` が package scripts とテストで契約化されている。

一方で、現在の課題は「大きな1ファイル」から「core hub と module graph の集中」へ移っている。`core/` は型、path、VCS、schema、review input、Bob output、traceability、package builder を抱えており、依存の中心になりやすい。また、workspace path boundary はかなり改善されているが、diff fixture 内の file path や traceability draft JSON path 抽出など、厳格 resolver を迂回する小さな読み取り経路がまだ残る。

## 2. 主要評価サマリ

| 観点 | 評価 | 所見 |
|---|---:|---|
| コードサイズ | B+ | entrypoint と analyzer は小さくなった。`gitDiffCollector.ts`、`reviewPackageBuilder.ts`、`traceabilityCommands.ts`、`workflowProviderRegistration.ts` はまだ 250 行級。 |
| ファイルサイズ | B | `.vscodeignore` と生成物 clean / truncation は改善済み。VSIX 実サイズは未測定なので CI artifact 化が必要。 |
| モジュール分割 | B+ | document / C++ / command / type split は良い。`core/` の責務が広く、次の分割対象。 |
| 依存・bundle | B- | runtime dependency は 5 件。`xlsx` 削除と lazy import は良い。`mammoth` / `cheerio` / `read-excel-file` は依然として bundle 面の主要リスク。 |
| 未使用コード | B | `knip` / `depcheck` / `ts-prune` が導入済み。`noUnusedLocals` / `noUnusedParameters` は未設定。 |
| 循環依存 | B+ | `architecture:policy` で cycle check がスクリプト化された。`core` hub が肥大化すると循環の温床になる。 |
| 暗黙依存 | B- | IBM Bob、workflow-register、VS Code、Git/Bazaar、Node TextDecoder、Trusted Workspace、`.bob-*` 生成物の privacy 前提が多い。README / policy test で可視化は進んだ。 |
| 型定義量 | B+ | `types.ts` は re-export shim になり、domain type へ分割済み。`Record<string, unknown>` と `EvidenceRef.type | string` は型安全性が弱い。 |
| barrel export | A- | `export *` は禁止方向。`types.ts` と `traceabilityCatalog.ts` は explicit facade で、現状は健全。 |
| 自動テスト密度 | A- | path boundary、VCS validation、dependency policy、source layout、heavy dependency lazy loading、generic evidence まで追加され、密度は高い。実行結果 artifact と coverage 可視化は未確認。 |

## 3. 観測メトリクス

### 3.1 ソース・テスト規模

GitHub 検索 index と指定 ref 差分の観察では、対象拡張はおおむね次の規模である。

| 種別 | 規模 | 備考 |
|---|---:|---|
| `src/**/*.ts` | 約 63 ファイル | 検索 index 上の約 60 ファイルに、現行 ref で `codeChangeAnalyzer.ts`、`genericCodeEvidenceAnalyzer.ts`、`languageClassifier.ts` が追加された構成。正確値は `scripts/report-extension-metrics.js` で再計測する。 |
| `test/**/*.js` / helper | 約 35 ファイル | 旧 index 約 30 に、現行 ref で architecture / command palette / generic evidence / language classifier / process workflow 系が追加された構成。 |
| runtime dependencies | 5 件 | `ajv`、`cheerio`、`mammoth`、`read-excel-file`、`yaml`。 |
| devDependencies | 8 件 | `@types/*`、`@vscode/vsce`、`depcheck`、`knip`、`ts-prune`、`typescript` など。 |
| package budget | 11,000,000 bytes | `npm run package:policy` で `check-vsix-policy.js --max-bytes 11000000`。 |

厳密な source/test LOC は、ローカルまたは CI で次を実行して `docs/metrics/` に残すのがよい。

```bash
node scripts/report-extension-metrics.js \
  extensions/bob-code-consistency-review \
  --output docs/metrics/bob-code-consistency-review-metrics-350010e7.md
```

### 3.2 主要ファイルの行数感

取得できた主要ファイルの概算行数は次の通り。

| ファイル | 概算行数 | コメント |
|---|---:|---|
| `src/extension.ts` | 114 | command 登録中心。かなり薄い。 |
| `src/commands/reviewInputCommands.ts` | 175 | review-input wizard / AI draft / repair / diagnostics。 |
| `src/reviewExecutionCommands.ts` | 111 | preprocess / Bob output / validate / triage。 |
| `src/traceabilityCommands.ts` | 245 | traceability 系 command が集まり、現状の command 層では大きめ。 |
| `src/workflowProviderRegistration.ts` | 259 | workflow-register 連携と許可 option 定義が集まる。 |
| `src/core/fileSystem.ts` | 164 | path policy と realpath containment を保持。重要度が高い。 |
| `src/core/gitDiffCollector.ts` | 262 | Git / Bazaar diff、revision validation、diff limit が集まる。 |
| `src/core/reviewPackageBuilder.ts` | 約 289 | 生成物の中心。出力一覧、manifest、truncation、privacy notice を担当。 |
| `src/analyzers/documentExtractor.ts` | 163 | format dispatcher。旧単一 extractor より改善。 |
| `src/analyzers/documentMarkdownExtractor.ts` | 36 | 小さい。 |
| `src/analyzers/documentDocxExtractor.ts` | 76 | lazy import と DOM traversal。 |
| `src/analyzers/documentXlsxExtractor.ts` | 72 | lazy import、sheet / row limit。 |
| `src/analyzers/cCppChangeAnalyzer.ts` | 178 | C/C++ orchestration。旧より大幅に分割。 |
| `src/analyzers/cCppDiffParser.ts` | 78 | diff line parser。 |
| `src/analyzers/cCppSymbolDetector.ts` | 122 | heuristic symbol detection。 |
| `src/analyzers/genericCodeEvidenceAnalyzer.ts` | 126 | 非 C/C++ evidence fallback。 |
| `src/core/traceabilityTypes.ts` | 102 | union / interface が集中するが、許容範囲。 |

## 4. 詳細レビュー

## 4.1 コードサイズ

### 良い点

- `extension.ts` は command registration と workflow provider registration の薄い entrypoint になった。
- `reviewInputCommands.ts`、`workspaceCommands.ts` への分割により、review-input 系の処理が entrypoint から切り離された。
- `documentExtractor.ts` は format dispatch に寄せられ、Markdown / DOCX / XLSX の実装が個別ファイルになった。
- `cCppChangeAnalyzer.ts` は parser / detector / renderer へ分割され、関数検出や rendering の詳細を抱え込まなくなった。
- `core/types.ts` は compatibility shim になり、巨大 type file ではなくなった。

### 懸念

1. **`core/` がまだ大きい**
   - `core/` が file system、schema loader、VCS diff、review input、review package、Bob output、traceability、型定義をすべて抱える。
   - module 数は増えたが、依存の意味上は `core` という1層に集まりやすい。

2. **`traceabilityCommands.ts` と `workflowProviderRegistration.ts` が command / integration の集中点**
   - `traceabilityCommands.ts` は 245 行級で、AI draft、catalog apply、gate、review-input 生成、webview open、draft JSON path 解決まで持つ。
   - `workflowProviderRegistration.ts` は provider 登録と allowed option policy が同居しており、今後 action が増えるほど肥大化する。

3. **小ファイル増加による探索コスト**
   - 巨大ファイルは減ったが、source file 数は約 60 超となり、初見の開発者は処理の入口を探しにくくなる。
   - README / architecture docs の module map は今後も更新が必要。

### 推奨

- `core/` を次のように段階的に分ける。

```text
src/
  workspace/
    fileSystem.ts
    workspaceResolver.ts
    workspaceRoots.ts
  vcs/
    gitDiffCollector.ts
    bazaarDiffCollector.ts
    revisionValidation.ts
  package/
    reviewPackageBuilder.ts
    manifestBuilder.ts
    truncation.ts
  bobOutput/
    capture.ts
    canonicalizer.ts
    validator.ts
  traceability/
    catalog.ts
    validation.ts
    reviewInput.ts
  shared/
    textEncoding.ts
    limits.ts
```

- `traceabilityCommands.ts` を `commands/traceabilityDraftCommands.ts`、`commands/traceabilityCatalogCommands.ts`、`commands/traceabilityPrepCommands.ts` に分ける。
- `workflowProviderRegistration.ts` の allowed option table を `workflowProviderPolicy.ts` に分離する。
- 単一ファイル budget を CI 化する。初期案は 300 行 warning、450 行 fail。

## 4.2 ファイルサイズ・生成物サイズ

### 良い点

- `.vscodeignore` は `src/**`、`test/**`、`*.ts`、`out/**/*.map`、`package-lock.json` を除外している。
- `node_modules/**/test/**`、examples、coverage、各種 config、`.d.ts`、source map、README / CHANGELOG なども除外されている。
- `reviewPackageBuilder` は管理対象出力を生成前に clean し、古い `code-slices/` や `tables/` が残る問題を抑えている。
- `manifest.yaml` に `generation_id`、`input_hash`、`contains_sensitive_context`、privacy notice、recommended gitignore が入る。
- raw diff と Bob input には truncation policy が入った。
- 文書抽出では Markdown を byte limit 付きで読む。DOCX / XLSX は上限超過時に skip する。
- XLSX は sheet 数と row 数の limit が入っている。

### 懸念

1. **code slice / table file の個別上限が弱い**
   - `maxRawDiffBytes` と `maxBobInputBytes` はあるが、`code-slices/*.md` と `tables/*.md` の個別 file size budget は見えない。
   - generic evidence は diff hunk をそのまま slice markdown にするため、大きな diff では code slice 側も膨らみやすい。

2. **VSIX 実サイズがレビュー内で未測定**
   - `.vscodeignore` と `package:policy` は良いが、実際の VSIX file list / size は CI artifact として確認したい。

3. **DOCX / XLSX parser の内部展開サイズ**
   - 入力 file bytes は制限されるが、parser が展開する HTML / workbook data のメモリ量は file size と比例しない場合がある。

### 推奨

- `maxCodeSliceBytesPerFile` と `maxTableExcerptBytesPerFile` を追加する。
- `review-package-size-report.json` を生成し、各 output file の bytes と truncation reason を残す。
- CI で `vsce ls`、VSIX bytes、`du -sh node_modules out *.vsix` を artifact 化する。
- DOCX / XLSX は巨大展開を検知するため、chunk count / row count / HTML bytes の warning を追加する。

## 4.3 モジュール分割

### 良い点

現行の主な処理流れは読みやすい。

```text
extension.ts
  -> commands / reviewExecutionCommands / traceabilityCommands
  -> core/pipeline.ts
      -> validateReviewInput
      -> collectGitDiff
      -> extractDocuments
      -> analyzeCodeChanges
      -> buildTraceability
      -> buildReviewPackage
```

`pipeline.ts` は 50 行未満で、処理順序を表す薄い orchestration に保たれている。

文書抽出の分割は特に良い。

```text
analyzers/documentExtractor.ts
  -> documentMarkdownExtractor.ts
  -> documentDocxExtractor.ts
  -> documentXlsxExtractor.ts
  -> documentExtractionCommon.ts
```

C/C++ 解析の分割も良い。

```text
analyzers/cCppChangeAnalyzer.ts
  -> cCppDiffParser.ts
  -> cCppSymbolDetector.ts
  -> cCppAnalysisRenderer.ts
```

さらに、`codeChangeAnalyzer.ts` が C-like analyzer と generic analyzer を束ね、非 C/C++ 言語にも最低限の evidence を出す構造になった。

### 懸念

- `commands/` 配下にあるのは `reviewInputCommands.ts` と `workspaceCommands.ts` のみで、`reviewExecutionCommands.ts` と `traceabilityCommands.ts` は `src/` 直下に残る。
- `core/fileSystem.ts` は path resolver と generated artifact placement policy を持つため、単なる file system helper より責務が重い。
- analyzer が `core/fileSystem` と `core/*Types` に依存し、`core/pipeline` が analyzer に依存するため、`core` という名前の層だけを見ると循環が入りやすい。

### 推奨

- command handler はすべて `src/commands/` に寄せる。
- `fileSystem.ts` は `workspace/pathPolicy.ts`、`workspace/io.ts`、`shared/pathFormat.ts` に分ける。
- analyzer が依存できる shared module を明示し、`core/pipeline.ts` や `reviewPackageBuilder.ts` への逆依存を禁止する。

## 4.4 依存パッケージ・bundle サイズ

### runtime dependencies

`package.json` の runtime dependency は次の 5 件。

- `ajv`: JSON schema validation。
- `cheerio`: DOCX -> HTML 後の DOM traversal。
- `mammoth`: DOCX extraction。
- `read-excel-file`: XLSX extraction。
- `yaml`: YAML parse / serialize。

`xlsx` が production dependency から外れ、`read-excel-file` に置き換わった点は大きな改善である。`dependencyPolicy.test.js` でも `xlsx` を production dependency に戻さない契約が入っている。

### devDependencies

`knip`、`depcheck`、`ts-prune`、`@vscode/vsce` が devDependency に入り、未使用コード・依存・VSIX packaging を検査できる構成になっている。

なお、以前懸念だった `iconv-lite` は devDependency に残っているが、現行 `textEncoding.ts` は `node:util` の `TextDecoder("shift_jis")` を使っており、runtime import ではなくなっている。よって依存区分の問題は解消済みと見てよい。

### lazy import

`documentDocxExtractor.ts` は `import("mammoth")` と `import("cheerio")`、`documentXlsxExtractor.ts` は `import("read-excel-file/node")` を使い、extension activation 時に重い parser を読み込まない設計になっている。`heavyDependencyLoading.test.js` もこの契約を検査している。

### 懸念

- VSIX 実サイズはこのレビューでは未測定。
- `mammoth`、`cheerio`、`read-excel-file` は依然として bundle size / supply-chain surface の主因。
- package budget はあるが、実測結果の推移を docs/metrics へ保存する運用までは見えない。

### 推奨

- `npm run package && npm run package:policy` の結果を CI summary に出す。
- `vsce ls` を artifact として残し、VSIX に入る `node_modules` をレビューできるようにする。
- `read-excel-file` の必要機能が限定されるなら、さらに軽い CSV / sheet subset extractor への切替余地を評価する。

## 4.5 未使用コード

### 良い点

- `unused:report` として `knip` / `depcheck` / `ts-prune` 系のスクリプトが入っている。
- `dependencyPolicy.test.js` が `unused:report`、`architecture:policy`、`source:policy`、`audit:prod`、`package:policy` の存在を契約化している。
- `sourceLayoutPolicy.test.js` が旧 `core/types.ts` への legacy import を禁止し、不要な互換 shim 依存の増殖を抑えている。

### 懸念

- `tsconfig.json` は `strict: true` だが、`noUnusedLocals` / `noUnusedParameters` は未設定。
- `knip` / `depcheck` / `ts-prune` は script と CI 契約があるが、baseline や fail 条件の詳細はこのレビューでは未確認。
- `core/types.ts` と `traceabilityCatalog.ts` は explicit facade なので、意図的な re-export が unused export として報告される可能性がある。

### 推奨

- `noUnusedLocals: true` をまず test/build に warning 相当で導入する。
- `noUnusedParameters` は command handler や callback で false positive が出やすいため、prefix `_` 運用とセットで段階導入する。
- `knip` の ignore / entry 設定を repository に明示し、report-only から fail-on-new へ移行する。
- `core/types.ts` と `traceabilityCatalog.ts` の re-export は public facade として allowlist にする。

## 4.6 循環依存

### 良い点

- `architecture:policy` が `node ../../scripts/check-import-cycles.js src` として定義されている。
- `dependencyPolicy.test.js` が architecture policy の存在を検査している。
- `pipeline.ts` は薄く、現時点では処理方向が比較的素直である。

### 循環が入りやすい箇所

1. `core/` <-> `analyzers/`
   - `pipeline.ts` は analyzer を呼ぶ。
   - analyzer は `core/fileSystem`、`core/languageClassifier`、`core/*Types` を読む。
   - `core` の中に shared と application service が混在しているため、逆流依存が入りやすい。

2. `traceabilityCommands.ts` <-> `core/traceability*` <-> `webview/traceabilityPrepWebview.ts`
   - command、domain、webview の境界が増えるほど、facade を通さない import が増えやすい。

3. `workflowProviderRegistration.ts` <-> command handlers
   - provider 登録側が command option policy と handlers interface を持つため、command handler が registration 側の helper を import し続けると密結合が強い。

### 推奨ルール

```text
commands -> application/core services -> analyzers/shared/domain types
webview -> controller interface -> traceability services
integration/workflow -> commands の public handler のみ
analyzers -> shared/io/types のみ。pipeline / package builder は import 禁止
```

CI では `architecture:policy` を fail 条件にし、結果を summary に残す。

## 4.7 暗黙依存

### 主な暗黙依存

1. **VS Code Extension Host**
   - activation events、command palette、workspace configuration、clipboard、webview、progress UI に依存する。

2. **IBM Bob / workflow-register**
   - `extensionDependencies` として `IBM.bob-code` と `local.workflow-register` が必要。
   - `workflow-register` が `registerActionProvider` を export する前提。

3. **Git / Bazaar CLI**
   - Git は `git diff` と `git rev-parse` を使う。
   - Bazaar は `bzr --no-aliases diff -r base..head` を使う。
   - `bzrPath` は user/global config 側の信頼境界に置かれている。

4. **Node.js の encoding support**
   - Shift-JIS 系 decode に `TextDecoder("shift_jis")` を使う。
   - 実行 Node の ICU / WHATWG encoding support に暗黙依存する。

5. **workspace trust / path boundary**
   - workspace 内 path でも symlink や fixture 経由の path があり得る。
   - 多くは strict resolver で改善済みだが、全経路で同じ resolver が使われているわけではない。

6. **生成物の機密性**
   - `.bob-review/` と `.bob-trace/ai-traceability-draft/` は raw diff、設計書抜粋、Bob input、AI draft を含む可能性がある。

### 懸念: strict resolver を迂回する小経路

`resolveWorkspacePathForKind` は realpath check まで持つが、次のような箇所は独自の path 解決を持つ。

- `cCppChangeAnalyzer.ts` の `resolveSourceFile()` は diff file path に `resolveWorkspacePath()` を使う。通常の Git diff path では問題になりにくいが、手作り diff fixture の `files[].path` に絶対 path や `..` が入ると、workspace 外の source を読める余地が残る。
- `traceabilityCommands.ts` の `resolveWorkspaceContainedPath()` は `path.relative` で containment を見ているが、`realpath` で symlink escape を確認していない。

### 推奨

- VCS / fixture 由来の changed file path に `normalizeChangedFilePathStrict()` を導入する。
  - absolute path 禁止。
  - `..` segment 禁止。
  - NUL / control char 禁止。
  - Windows drive prefix 禁止。
  - normalized POSIX path を `DiffSummary.files[].path` と `DiffLine.file` に保存。
- `resolveWorkspaceContainedPath()` を廃止し、`resolveWorkspacePathStrict` または kind-aware resolver に統一する。
- path boundary test に「diff fixture 内の changed file path が workspace 外を指す場合」の regression test を追加する。
- traceability draft JSON path の symlink escape test を追加する。

## 4.8 union / mapped type などの型定義の量やサイズ

### 良い点

- 旧 `core/types.ts` は explicit re-export shim になり、実体は domain type module に分かれた。
- `analysisTypes.ts`、`diffTypes.ts`、`documentTypes.ts`、`preprocessTypes.ts`、`reviewTypes.ts`、`traceabilityResultTypes.ts`、`validationTypes.ts` に分割されている。
- mapped type の濫用は見えない。
- union は domain vocabulary を表す範囲に収まっている。

### 主な union

- `ReviewInput.review.vcs?: "git" | "bazaar" | "bzr"`
- `DiffSummary.vcs?: "git" | "bazaar"`
- `DiffSummary.files[].status: "added" | "modified" | "deleted" | "renamed" | "unknown"`
- `CodeAnalysisResult.changedSymbols[].kind: "function" | "type" | "define" | "global" | "unknown"`
- `confidence: "high" | "medium" | "low"`
- `TraceabilityStatus: "proposed" | "accepted" | "rejected" | "deprecated"`
- `TraceabilityItemType: requirement / basic_design / detailed_design / test_spec / qa_item / review_finding`
- `TraceabilityLinkType: satisfies / elaborates / verified_by / clarifies / reviewed_by / references`
- `ReviewLanguage`: C/C++、TypeScript、JavaScript、Python、C#、Java、Go、Rust、shell、SQL、JSON、YAML、Markdown、text、unknown など。

### 懸念

1. **`EvidenceRef.type` が実質任意 string**
   - `"requirement" | ... | string` なので、型レベルの exhaustiveness check は効かない。
   - plugin extensibility のためなら意図を明示した branded extension type にするとよい。

2. **`ReviewInput.artifacts: Record<string, unknown>` が広い**
   - schema validation 前提では妥当だが、TypeScript 側では artifact kind ごとの型安全性が弱い。

3. **schema と TS type の drift**
   - schema は JSON、TS type は手書きなので、追加 field や enum のずれが起きやすい。

### 推奨

```ts
type KnownEvidenceType =
  | "requirement"
  | "basic_design"
  | "detailed_design"
  | "test_spec"
  | "ledger"
  | "ticket"
  | "code"
  | "check_result"

type ExtensionEvidenceType = string & { readonly __extensionEvidenceType?: unique symbol }
```

または、known / extension を field 分離する。

```ts
type EvidenceRef = {
  evidence_id: string
  type: KnownEvidenceType
  extension_type?: string
}
```

`ReviewInput.artifacts` は schema-derived type の生成、または artifact item の discriminated union 化を検討する。

## 4.9 barrel export の集中度

### 現状評価

- `export * from` は見当たらず、barrel export の集中度は低い。
- `core/types.ts` は explicit type re-export shim で、互換性維持用として許容できる。
- `core/traceabilityCatalog.ts` は `formatTraceabilityItemId`、`buildReviewInputDraftFromTraceability`、`renderTraceabilityGateReport`、`validateTraceabilityCatalog`、traceability 型群を明示 export している。
- `source:policy` が `check-export-star-policy.js src` として定義されている。

### 懸念

- `traceabilityCatalog.ts` は facade として妥当だが、今後 traceability API が増えると巨大 barrel になりやすい。
- `types.ts` を便利 import として使うと domain type の分割が形骸化するため、現行の source layout test の維持が重要。

### 推奨

- `export *` 禁止は維持する。
- facade は domain ごとに1つまでに抑える。
- `types.ts` は external compatibility shim と位置づけ、内部 source からの import 禁止を継続する。
- `traceabilityCatalog.ts` が 50 行を超える、または re-export 以外の実装を持ち始めたら再分割する。

## 4.10 自動テスト密度

### 良い点

確認できたテスト領域は広い。

- path boundary: `pathBoundary.test.js`
- VCS revision validation / bzrPath override: `vcsValidation.test.js`
- dependency / package / CI policy: `dependencyPolicy.test.js`
- source layout: `sourceLayoutPolicy.test.js`
- heavy dependency lazy loading: `heavyDependencyLoading.test.js`
- generic multi-language evidence: `genericCodeEvidenceAnalyzer.test.js`
- workflow options / user options / provider registration
- review pipeline
- document extraction
- size limits
- privacy artifacts
- Bob output capture / presentation / triage
- traceability catalog / store / prep controller / webview / AI draft
- command palette policy
- integration sandbox script

`npm test` は `npm run compile && node --test test/*.test.js` で compile と Node test をまとめて実行する。さらに package scripts と policy tests により、次の検査が CI 契約化されている。

- dependency policy
- import cycle policy
- export star policy
- unused report
- production audit
- package build
- package size policy

### 懸念

- coverage 計測は見えない。
- `npm test` 単体には `architecture:policy` / `source:policy` / `unused:report` / `audit:prod` / `package:policy` は含まれない。CI での実行契約はあるが、ローカル開発者が `npm test` だけ実行すると見落とす。
- diff fixture 内の malicious path、traceability draft JSON symlink escape、code slice 個別サイズ上限など、今回見つけた残リスクの regression test は不足している。

### 推奨テスト追加

- `diffPathBoundary.test.js`
  - fixture の `files[].path` に absolute path / `..` / drive prefix が入った場合に reject する。
- `traceabilityDraftPathBoundary.test.js`
  - draft JSON path 抽出が symlink escape を読まないことを確認する。
- `codeSliceSizeLimits.test.js`
  - generic evidence と C/C++ code slice の個別 bytes 上限を確認する。
- `moduleBudget.test.js`
  - source file 行数 budget と directory fan-in/fan-out を警告する。
- `metricsArtifact.test.js` または CI step
  - `report-extension-metrics.js` の結果が docs/metrics に更新されることを検査する。

## 5. 優先度付き指摘一覧

| ID | Severity | 観点 | 指摘 | 推奨対応 |
|---|---:|---|---|---|
| CCR-MA-01 | Medium | 暗黙依存 / path | diff fixture / VCS 由来の file path が analyzer 側で非 strict resolver を通る | `normalizeChangedFilePathStrict()` を導入し、absolute / `..` / drive prefix / control char を reject |
| CCR-MA-02 | Medium | 暗黙依存 / path | traceability draft JSON path 解決が独自 containment で realpath check をしない | `resolveWorkspacePathStrict` 系へ統一し、symlink escape test を追加 |
| CCR-MA-03 | Medium | モジュール分割 | `core/` が shared と application service を兼ねる hub になっている | `workspace/`、`vcs/`、`package/`、`bobOutput/`、`traceability/` へ段階分割 |
| CCR-MA-04 | Medium | ファイルサイズ | `code-slices/*.md` と `tables/*.md` の個別出力上限がない | `maxCodeSliceBytesPerFile` / `maxTableExcerptBytesPerFile` と size report を追加 |
| CCR-MA-05 | Medium | bundle | VSIX 実サイズ・file list がレビュー内では未測定 | `vsce ls` と VSIX bytes を CI artifact / summary 化 |
| CCR-MA-06 | Low | 未使用コード | `noUnusedLocals` / `noUnusedParameters` は未設定 | report-only から段階導入 |
| CCR-MA-07 | Low | 型定義 | `EvidenceRef.type | string` と `ReviewInput.artifacts: Record<string, unknown>` が型安全性を弱める | known / extension type 分離、schema-derived type 検討 |
| CCR-MA-08 | Low | テスト密度 | coverage / metrics trend が見えない | coverage と `report-extension-metrics.js` の履歴を docs/metrics に残す |

## 6. すでに改善済みと評価する旧リスク

| 旧リスク | 現状評価 |
|---|---|
| `extension.ts` 肥大化 | command 実装が分離され、entrypoint は薄くなった。 |
| document extraction 単一ファイル集中 | Markdown / DOCX / XLSX extractor に分割済み。 |
| C/C++ analyzer 単一ファイル集中 | diff parser / symbol detector / renderer に分割済み。 |
| workspace 外 path 許容 | strict resolver と kind-aware resolver が導入され、大部分は改善済み。 |
| Git / Bazaar revision の弱い validation | Git SHA 解決、Bazaar allowlist validation が導入済み。 |
| `bzrPath` workflow override | workflow args override 禁止に改善済み。 |
| raw diff / document / Bob input size limit 不足 | processing limits と truncation warning が導入済み。 |
| `out/**/*.map` が VSIX に入り得る | `.vscodeignore` で除外済み。 |
| `xlsx` dependency | `read-excel-file` に置換済み。 |
| heavy parser の activation load | dynamic import と test で lazy loading を契約化済み。 |
| barrel export の増殖 | `source:policy` と explicit facade 方針が入っている。 |

## 7. 実測・CI で残すべきコマンド

対象 ref を checkout した環境で、以下を実行して本レビューの「実サイズ」部分を補完する。

```bash
git checkout 350010e766d99ad19a0bba5bf11e2cbd0ee04e62

# repository root
node scripts/report-extension-metrics.js \
  extensions/bob-code-consistency-review \
  --output docs/metrics/bob-code-consistency-review-metrics-350010e7.md

cd extensions/bob-code-consistency-review
npm ci
npm run compile
npm test
npm run dependency:policy
npm run architecture:policy
npm run source:policy
npm run unused:report
npm run audit:prod
npm run package
npm run package:policy
npx vsce ls > vsce-files-350010e7.txt
du -sh node_modules out *.vsix 2>/dev/null || true
```

加えて、生成された metrics / VSIX file list / package size を CI artifact として残す。

## 8. 次の改善バックログ

### High priority

1. `normalizeChangedFilePathStrict()` を追加し、diff fixture と VCS parser の出力 path を統一検証する。
2. `traceabilityCommands.ts` の `resolveWorkspaceContainedPath()` を strict / realpath 対応 resolver に置き換える。
3. `code-slices` / `tables` の個別 size limit と `review-package-size-report.json` を追加する。

### Medium priority

1. `core/` を `workspace/`、`vcs/`、`package/`、`bobOutput/`、`traceability/` に段階分割する。
2. `traceabilityCommands.ts` と `workflowProviderRegistration.ts` をさらに分割する。
3. VSIX size / file list / node_modules size を CI artifact 化し、docs/metrics に履歴を残す。
4. coverage または最低限の test count / LOC ratio を CI summary に出す。

### Low priority

1. `EvidenceRef.type` の known / extension 分離を検討する。
2. `ReviewInput.artifacts` を schema-derived type に寄せる。
3. `noUnusedLocals` を段階導入する。
4. facade module の行数・export 数 budget を設ける。

## 9. 結論

現在の `bob-code-consistency-review` は、前回レビューで挙がっていたサイズ・分割・依存・安全境界の主要リスクに対して、かなり具体的な改善が入っている。特に、entrypoint の薄化、format 別 extractor、C/C++ analyzer 分割、strict path resolver、VCS revision validation、heavy dependency lazy loading、dependency / architecture policy test は良い。

今後の焦点は、単一ファイルの肥大化ではなく、`core/` に集まる責務と、わずかに残る独自 path 解決の統一である。VSIX 実サイズと source/test LOC の実測を CI artifact として継続的に残せば、サイズ劣化・依存肥大・循環依存・未使用 export を早期に検知できる状態にできる。
