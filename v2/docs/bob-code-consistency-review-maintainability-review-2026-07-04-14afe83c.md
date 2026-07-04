# bob-code-consistency-review 拡張機能 維持性・サイズ観点レビュー

- 対象リポジトリ: `katamor1/bob_builtin_analyze`
- 対象 ref: `14afe83c2218d881a9cd7b17b68b837c53507114`
- 対象拡張: `extensions/bob-code-consistency-review`
- レビュー日: 2026-07-04
- レビュー種別: GitHub 上のソース、README、`package.json`、`package-lock.json`、`.vscodeignore`、代表的な実装ファイル、テスト配置に基づく静的レビュー

## 0. 前提と制約

本レビューは静的レビューであり、以下は未実行である。

- `npm ci` / `npm install`
- `npm run compile`
- `npm test`
- `npm audit`
- `vsce package`
- 実 VSIX サイズ、`node_modules` 実ディスクサイズ、`out/` 実サイズの測定
- `madge` / `dependency-cruiser` による循環依存の機械検出
- `knip` / `ts-prune` / `depcheck` による未使用コード・未使用依存の機械検出

したがって、コードサイズ・ファイルサイズ・bundle サイズは、取得できたファイル構成、行数規模、package metadata、`.vscodeignore` からの評価を中心とする。実測が必要な箇所は「要実測」として明示する。

## 1. 総評

`bob-code-consistency-review` は、Git / Bazaar 差分、要求書・基本設計書・詳細設計書・テスト仕様書、C/C++ 変更解析、traceability sidecar、Bob 出力 validation、human triage をつなぐレビュー前処理拡張である。`workflow-register` よりも業務ドメイン寄りで、文書抽出と生成物作成の責務が大きい。

設計としては、`extension.ts` が command entry、`reviewExecutionCommands.ts` が実行系 command wrapper、`core/pipeline.ts` が thin orchestration、`analyzers/*` が文書・コード解析、`core/reviewPackageBuilder.ts` が生成物作成、`core/bobOutput*` が Bob 出力処理、`core/traceability*` が sidecar 管理という分割になっており、責務は比較的読みやすい。

一方で、依存パッケージと bundle size は3拡張の中で最も重くなりやすい。`cheerio`、`mammoth`、`xlsx`、`yaml`、`ajv` を runtime dependency として持ち、DOCX/XLSX 全読み込み、raw diff 50MB buffer、review-package への raw diff / code slice / document excerpt / bob-input 出力があるため、入力サイズ・生成物サイズ・機密情報残存の制御が重要である。

最優先の改善ポイントは、path boundary の一貫性、文書抽出と raw diff のサイズ上限、依存・VSIX サイズの CI 可視化、循環依存・未使用 export/dependency の機械検査である。

## 2. 主要スナップショット

| 観点 | 評価 | 所見 |
|---|---:|---|
| コードサイズ | B | pipeline は薄いが、`cCppChangeAnalyzer.ts`、`documentExtractor.ts`、`extension.ts`、`reviewPackageBuilder.ts` が大きめ。ドメイン処理が増えるほど肥大化しやすい。 |
| ファイルサイズ | C+ | `review-package` 生成物が raw diff、document excerpts、code slices、bob-input を持つため膨らみやすい。`sourceMap: true` だが `out/**/*.map` 除外は見えない。 |
| モジュール分割 | B+ | command / pipeline / analyzer / package builder / traceability / output validation の分割は良い。`core` が広すぎる点は整理余地あり。 |
| 依存・bundle | C+ | runtime 依存に `cheerio`、`mammoth`、`xlsx` があり、3拡張中で最も重い。`.vscodeignore` は依存内の不要物を除外しているが、bundle budget がない。 |
| 未使用コード | B- | `strict` は有効だが `noUnusedLocals` / `noUnusedParameters` は見えない。`knip` / `depcheck` / `ts-prune` も未確認。 |
| 循環依存 | B | 現状は薄い pipeline により大きな循環は入りにくいが、`core` と `analyzers` の相互利用が増えると危険。機械検出が必要。 |
| 暗黙依存 | C | IBM Bob、`workflow-register`、Git/Bazaar CLI、`.bob-review`、`.bob-trace`、`.bob/workflows`、文書フォーマット、workspace trust 前提が多い。 |
| 型定義量 | B | `types.ts` と `traceabilityTypes.ts` に union / record / nested object が集約されている。読みやすいが今後肥大化しやすい。 |
| barrel export | A- | `export *` は見当たらない。`traceabilityCatalog.ts` に明示 re-export がある程度で集中度は低い。 |
| 自動テスト密度 | B+ | 確認できた test/helper は約21。主要機能にテストがあるが、サイズ・依存・循環・未使用検査は未整備。 |

## 3. コードサイズ

### 確認できた大きめのファイル

- `src/analyzers/cCppChangeAnalyzer.ts`: 約362行。C/C++ 関数検出、diff line parsing、call graph、RT forbidden candidate 検出、code slice 生成を1ファイルで担当。
- `src/analyzers/documentExtractor.ts`: 約291行。Markdown / DOCX / XLSX 抽出、selector matching、table markdown 化、evidence ID 生成を担当。
- `src/extension.ts`: 約239行。command registration と command 実装の一部を持つ。
- `src/core/gitDiffCollector.ts`: 約201行。Git/Bazaar diff 収集、diff parse、language inference を担当。
- `src/core/reviewPackageBuilder.ts`: 約186行。review package の全生成物を出力。
- `src/workflowProviderRegistration.ts`: 約181行。`workflow-register` への action provider 登録と workflow option merge を担当。

### 良い点

- `core/pipeline.ts` は `validateReviewInput` -> `collectGitDiff` -> `extractDocuments` -> `analyzeCppChanges` -> `buildTraceability` -> `buildReviewPackage` の薄い orchestration に留まっている。
- command entry と core pipeline が分かれているため、テスト対象の切り出しはしやすい。
- 文書抽出、C/C++ 解析、traceability、Bob output validation が大きく分かれており、横断的に巨大な1ファイルへ集約されていない。

### 懸念

1. **analyzer の単一ファイル肥大化**
   - `cCppChangeAnalyzer.ts` は関数検出、diff parser、symbol extraction、call graph、RT forbidden detection、markdown rendering まで含む。
   - 将来 C/C++ 以外や解析精度向上を入れると、早い段階で 500行を超える可能性が高い。

2. **documentExtractor の責務過多**
   - Markdown / DOCX / XLSX の抽出方式が1ファイルに入っている。
   - format ごとの dependency と failure mode が異なるため、`extractors/markdown.ts`、`extractors/docx.ts`、`extractors/xlsx.ts` に分けると保守しやすい。

3. **extension.ts の command 実装混在**
   - `extension.ts` は command registration だけでなく、`runCreateReviewInput`、`runPrepareAiReviewInputDraft`、`runApplyAiReviewInputDraft`、`runRepairReviewInput` などの実装も持つ。
   - コマンドが増えるほど extension entry が重くなる。

### 推奨

- `analyzers/cpp/` 配下に `diffParser.ts`、`functionDetector.ts`、`callGraph.ts`、`codeSliceRenderer.ts` を分割する。
- `analyzers/document/` 配下に `markdownExtractor.ts`、`docxExtractor.ts`、`xlsxExtractor.ts`、`tableRenderer.ts` を分割する。
- `extension.ts` は command registration のみに寄せ、実装は `reviewInputCommands.ts`、`traceabilityCommands.ts`、`reviewExecutionCommands.ts` へ移す。
- CI で単一ファイル行数 budget を設定する。初期案: 350行 warning、500行 fail。

## 4. ファイルサイズ・生成物サイズ

### 配布ファイル観点

`tsconfig.json` は `sourceMap: true` である。`.vscodeignore` は `src/**`、`test/**`、`tests/**`、`*.ts`、`*.tsbuildinfo`、`package-lock.json` などを除外しているが、`out/**/*.map` の除外は見えない。

`.vscodeignore` は dependency 内の test/spec/example/demo/benchmark、`.github`、`.vscode`、coverage、各種 config、`*.ts`、`*.d.ts`、`*.map`、README/CHANGELOG などを除外しており、重い依存を抱える拡張としては良い方針である。

### runtime 生成物観点

`reviewPackageBuilder` は以下を `outDir` に生成する。

- `input-normalized.json`
- `changed-files.json`
- `changed-symbols.json`
- `document-index.json`
- `evidence-index.json`
- `traceability-map.json`
- `manifest.yaml`
- `change-summary.md`
- `diff-context.md`
- `document-excerpts.md`
- `traceability-map.md`
- `deterministic-checks.md`
- `bob-input.md`
- `prompts/*.md`
- `code-slices/*.md`
- `tables/*.md`

`diff-context.md` は raw unified diff を含み、`bob-input.md` は document excerpts、diff context、traceability map、evidence summary を統合する。したがって、review package は workspace 内のコード・設計書・要求書の抜粋をかなり持つ。

### 懸念

- Git/Bazaar diff は `--unified=80` かつ maxBuffer 50MB で収集される。
- DOCX は `mammoth.convertToHtml({ path })`、XLSX は `XLSX.readFile()` で読み込む。
- XLSX は sheets 指定がなければ全 sheet を対象にする。
- `document-excerpts.md`、`diff-context.md`、`bob-input.md` に明確な bytes 上限・truncation policy が見えない。
- `.bob-review/` が target project で `.gitignore` されているとは限らない。

### 推奨

- `maxRawDiffBytes`、`maxDocumentBytes`、`maxWorkbookSheets`、`maxRowsPerSheet`、`maxExcerptBytes`、`maxBobInputBytes` を設定化する。
- truncation した場合は `deterministic-checks.md` と `manifest.yaml` に warning を残す。
- `initializeWorkspace` 時に `.gitignore` へ `.bob-review/` と `.bob-trace/` の追記を提案する。
- VSIX については `out/**/*.map` を含めるか決める。含めないなら `.vscodeignore` へ追加する。
- CI で `vsce ls` と VSIX サイズ budget を導入する。

## 5. モジュール分割

### 現状の分割

```text
src/
  extension.ts
  extensionCommandOptions.ts
  reviewExecutionCommands.ts
  reviewInputWizard.ts
  traceabilityCommands.ts
  workflowProviderRegistration.ts
  workflowOptions.ts
  workspaceInitializer.ts
  workspaceResolver.ts
  analyzers/
    cCppChangeAnalyzer.ts
    documentExtractor.ts
    traceabilityBuilder.ts
  core/
    pipeline.ts
    types.ts
    fileSystem.ts
    gitDiffCollector.ts
    reviewInputBuilder.ts
    reviewInputValidator.ts
    reviewPackageBuilder.ts
    bobOutput*.ts
    traceability*.ts
    textEncoding.ts
  templates/
  triage/
  webview/
```

### 良い点

- `pipeline.ts` は薄く、処理順序が読みやすい。
- `reviewExecutionCommands.ts` は preprocess/capture/validate/triage にまとまっている。
- `workflowProviderRegistration.ts` に `workflow-register` 連携を閉じ込めている。
- `traceability*` と `bobOutput*` がそれぞれ独立した塊になっている。
- Webview 関連は `webview/` に分離されている。

### 改善余地

- `core` が file system、schema loader、VCS diff、review input、package builder、Bob output、traceability まで含んで広い。
- `analyzers` が `core/fileSystem` や `core/types` に依存しているが、今後 `core` から analyzer を呼ぶ関係も増えると循環しやすい。
- `extension.ts` は registration と command implementation の両方を持つ。

### 推奨ディレクトリ案

```text
src/
  extension.ts
  commands/
    reviewInputCommands.ts
    reviewExecutionCommands.ts
    traceabilityCommands.ts
  integration/
    workflowProviderRegistration.ts
    workflowOptions.ts
  workspace/
    workspaceResolver.ts
    workspaceInitializer.ts
  pipeline/
    pipeline.ts
    reviewPackageBuilder.ts
  vcs/
    gitDiffCollector.ts
    bazaarDiffCollector.ts
    revisionValidator.ts
  documents/
    markdownExtractor.ts
    docxExtractor.ts
    xlsxExtractor.ts
  codeAnalysis/
    cppAnalyzer.ts
    diffParser.ts
    functionDetector.ts
  traceability/
  bobOutput/
  shared/
    fileSystem.ts
    textEncoding.ts
    types.ts
```

短期では、大移動よりも `extension.ts` の command implementation 分割、`documentExtractor.ts` の format 別分割、`cCppChangeAnalyzer.ts` の helper 分割を優先する。

## 6. 依存パッケージ・bundle サイズ

### runtime dependencies

`package.json` の runtime dependency は以下。

- `ajv`: JSON schema validation。
- `cheerio`: DOCX -> HTML 変換後の DOM traversal。
- `mammoth`: DOCX extraction。
- `xlsx`: XLSX workbook extraction。
- `yaml`: review-input / Bob output YAML parse/serialize。

この依存構成は機能上は妥当だが、文書 parser 系が多く、VSIX と supply-chain surface が大きくなりやすい。

### dev dependencies

- `@types/node`
- `@types/vscode`
- `@vscode/vsce`
- `iconv-lite`
- `typescript`

`iconv-lite` は `devDependencies` にあるが、`textEncoding.ts` が runtime 側で必要とする場合は VSIX packaged runtime に入るか要確認が必要である。TypeScript が compile 後に `require("iconv-lite")` を残す構造なら、devDependency のままだと packaged extension で欠落するリスクがある。実際の import を確認し、runtime import なら `dependencies` へ移すべきである。

### lockfile / transitive dependency

`package-lock.json` は存在し、root package の dependency / devDependency は `package.json` と整合している。ただし `.vscodeignore` は `package-lock.json` を除外している。これは VSIX 配布としては問題ないが、CI は `npm ci` 前提にするべきである。

### 推奨

- `npm ci && npm run compile && npm test && vsce package` を CI 化する。
- `vsce ls` を artifact として残し、VSIX に入った node_modules を確認する。
- `iconv-lite` が runtime import なら `dependencies` に移動する。
- `xlsx` は既知の大きい依存なので、必要機能が限定されるなら lazy import か optional feature 化を検討する。
- bundle budget を設定する。初期案: 10MB warning、20MB fail。実測後に引き下げる。
- `npm audit --omit=dev` と license check を CI に入れる。

## 7. 未使用コード

### 現状評価

`tsconfig.json` は `strict: true` だが、`noUnusedLocals` と `noUnusedParameters` は見えない。`test` script は `npm run compile && node --test test/*.test.js` であり、未使用 export や未使用 dependency の検査は含まれない。

`export * from` は確認されず、barrel によって未使用 export が隠れるリスクは低い。ただし `core/types.ts` と `traceabilityTypes.ts` は多くの型を public-like に export しているため、`ts-prune` では false positive / public API 判断が必要になる。

### 気になる候補

- `iconv-lite` が devDependency に置かれている点。runtime import なら「未使用」ではなく「依存区分誤り」。runtime import でないなら不要 dependency の可能性。
- `traceabilityCatalog.ts` は re-export と builder function を兼ねる public facade になっているため、未使用 export の温床になりやすい。
- `reviewInputBuilder` 周辺の enum/value export は command/UI/AI draft で使われるため、機械検出の除外設計が必要。

### 推奨

- `noUnusedLocals: true`、`noUnusedParameters: true` を段階導入する。
- `knip --production` を report-only で導入する。
- `depcheck` で unused dependency / missing dependency を確認する。
- `ts-prune` で unused export を確認し、public API と test-only API を baseline 管理する。
- `iconv-lite` の runtime import 有無を検査し、必要なら dependency へ移す。

## 8. 循環依存

### 現状評価

機械検出は未実行。静的に見る限り、主要な依存方向は次のように比較的素直である。

```text
extension.ts / commands
  -> core pipeline / command option helpers
  -> analyzers / builders / validators
  -> shared types / fileSystem / textEncoding
```

`pipeline.ts` が薄いため、現時点では大きな循環は入りにくい。ただし `analyzers` が `core/fileSystem` と `core/types` を import し、`core/pipeline` が `analyzers` を import しているため、`core` という名前の層が曖昧である。今後 analyzer から pipeline/core package builder へ依存が戻ると循環が起きる。

### 循環が入りやすい箇所

- `core` <-> `analyzers`
- `core/traceabilityCatalog.ts` <-> `traceabilityValidation.ts` / `traceabilityTypes.ts`
- `extension.ts` <-> `workflowProviderRegistration.ts` <-> command handlers
- `webview` <-> `core/traceabilityPrepController.ts`

### 推奨 dependency rule

- `src/analyzers/**` は `src/core/pipeline.ts` と `src/core/reviewPackageBuilder.ts` を import しない。
- `src/core/**` は `src/extension.ts`、`src/commands/**`、`src/webview/**` を import しない。
- `src/webview/**` は VS Code API と controller interface 以外を直接 import しすぎない。
- `src/integration/**` は command handler の薄い adapter に限定する。

推奨コマンド:

```bash
npx madge --extensions ts --circular src
npx dependency-cruiser src --output-type err
```

## 9. 暗黙依存

### 主な暗黙依存

1. **IBM Bob / VS Code**
   - `package.json` は `IBM.bob-code` と `local.workflow-register` を extension dependency として宣言している。
   - workflow-register には `registerActionProvider` を期待している。

2. **Git / Bazaar CLI**
   - Git は `git diff --name-status base head`、`--numstat`、`--unified=80` を使う。
   - Bazaar は `bzr --no-aliases diff -r base..head` を使う。
   - shell injection は `execFile` / `shell: false` で抑えているが、revision 文字列を CLI arg として直接渡しているため option injection / weird rev の検証が弱い。

3. **workspace path 境界**
   - `extensionCommandOptions.absolute()` と `core/fileSystem.resolveWorkspacePath()` は absolute path をそのまま許容する。
   - `reviewInputValidator` は artifact path の存在確認をするが、workspace 内確認はしていない。
   - `workspaceResolver` は root 選択に `.bob` marker を使うが、明示 root は `path.resolve()` して返す。

4. **生成物の機密性**
   - `.bob-review/review-package` は raw diff、文書抜粋、code slices、bob-input を含む。
   - `.bob-review/bob-output` は Bob 出力 YAML を含む。
   - `.bob-trace` は traceability catalog / gate report を含む。

5. **文書フォーマット**
   - Markdown / DOCX / XLSX の構造に依存する。
   - XLSX sheet 未指定時は全 sheet を読む。

6. **エンコーディング**
   - UTF-8 / Shift-JIS 系 fallback の挙動に依存する。文字化け時の検出・警告の強さがレビュー品質に影響する。

### 推奨

- `resolveWorkspacePathStrict(root, value, { allowExternal?: boolean })` を共通化する。
- default は workspace 内のみ許可し、外部 path は設定と env の両方で明示 opt-in にする。
- Git revision は `git rev-parse --verify --end-of-options <rev>^{commit}` で SHA に解決してから diff に渡す。
- Bazaar revision は allowlist validation を入れる。
- generated artifacts の privacy notice と `.gitignore` helper を追加する。
- Workspace Trust API に対応し、untrusted workspace では preprocess / command execution / external CLI を disable する。

## 10. union / mapped type など型定義の量やサイズ

### 現状

`core/types.ts` は review input、diff summary、evidence、document extraction、code analysis、traceability result、preprocess result を定義している。`traceabilityTypes.ts` は traceability catalog domain の union と interface を定義している。

主な union:

- `ReviewInput.review.vcs?: "git" | "bazaar" | "bzr"`
- `DiffSummary.files[].status: "added" | "modified" | "deleted" | "renamed" | "unknown"`
- `CodeAnalysisResult.changedSymbols[].kind: "function" | "type" | "define" | "global" | "unknown"`
- `confidence: "high" | "medium" | "low"`
- `TraceabilityStatus: "proposed" | "accepted" | "rejected" | "deprecated"`
- `TraceabilityItemType: "requirement" | "basic_design" | "detailed_design" | "test_spec" | "qa_item" | "review_finding"`
- `TraceabilityLinkType: "satisfies" | "elaborates" | "verified_by" | "clarifies" | "reviewed_by" | "references"`

mapped type の過度な濫用は見えず、現状の型は読みやすい。

### 懸念

- `core/types.ts` が review input、VCS diff、document extraction、code analysis、preprocess result まで保持しており、ドメインが広い。
- `EvidenceRef.type` が string literal union に `| string` を含むため、実質的には任意 string である。拡張性はあるが exhaustiveness check は弱い。
- `ReviewInput.artifacts: Record<string, unknown>` は柔軟だが、artifact kind ごとの型安全性が薄い。
- `TraceabilityCatalog` は整っているが、AI draft / review input draft / traceability item の変換型が増えると1ファイルに集まりやすい。

### 推奨

- `types.ts` を `reviewInputTypes.ts`、`diffTypes.ts`、`evidenceTypes.ts`、`documentTypes.ts`、`codeAnalysisTypes.ts`、`preprocessTypes.ts` に分ける。
- `EvidenceRef.type` は `KnownEvidenceType | (string & {})` のように意図を明示するか、known/extension を別 field にする。
- `ReviewInput.artifacts` は artifact kind ごとの discriminated union / schema-derived type に寄せる。
- JSON schema から TypeScript 型を生成するか、型から schema を生成し、schema と型の drift を防ぐ。

## 11. barrel export の集中度

### 現状評価

`export * from` は確認されず、barrel export の集中度は低い。これは良い。

明示的な re-export は `core/traceabilityCatalog.ts` に見られる。`formatTraceabilityItemId`、`renderTraceabilityGateReport`、`validateTraceabilityCatalog`、traceability 型群を明示 export しており、巨大 barrel ではない。

### 懸念

- `traceabilityCatalog.ts` は public facade と `buildReviewInputDraftFromTraceability` の実装を兼ねている。
- 今後 traceability の API が増えると、ここが barrel 化しやすい。

### 推奨

- `traceability/index.ts` を作るなら explicit export のみにし、`export *` は禁止する。
- `buildReviewInputDraftFromTraceability` は `traceabilityToReviewInput.ts` のような変換専用 module に移す。
- dependency-cruiser で barrel 経由の逆流依存を禁止する。

## 12. 自動テスト密度

### 確認できたテスト

確認できた test/helper は約21で、以下の領域をカバーしている。

- `reviewPipeline.test.js`
- `documentExtraction.test.js`
- `bobOutputCaptureCanonicalize.test.js`
- `bobOutputPresentation.test.js`
- `reviewOutputTriage.test.js`
- `workflowProviderRegistration.test.js`
- `workflowOptions.test.js`
- `workspaceRoots.test.js`
- `traceabilityCatalog.test.js`
- `traceabilityCatalogStore.test.js`
- `traceabilityPrepController.test.js`
- `traceabilityPrepWebview.test.js`
- `traceabilityPrepWebviewAssets.test.js`
- `traceabilityCommandWiring.test.js`
- `liveTraceabilitySidecarSample.test.js`
- `reviewInputAiDraftProvider.test.js`
- `traceabilityAiDraftProvider.test.js`
- `notificationBehavior.test.js`
- `integrationSandboxScript.test.js`
- helpers

`package.json` の test script は `npm run compile && node --test test/*.test.js` で、compile と unit test をまとめて実行する。これは良い。

### 足りないテスト / gate

- Git revision option injection regression。
- Bazaar revision validation regression。
- absolute path / workspace escape の default reject。
- oversized DOCX/XLSX/diff の truncation。
- VSIX packaged dependency の smoke test。
- `iconv-lite` runtime dependency の packaging check。
- `madge --circular`。
- `knip` / `depcheck` / `ts-prune`。
- `vsce ls` / VSIX size budget。

### 推奨テスト追加

- `gitDiffCollector.revisionValidation.test.js`
- `pathBoundary.test.js`
- `documentExtractionLimits.test.js`
- `reviewPackageSizeLimits.test.js`
- `vsixContents.test.js` または CI script
- `dependencyGraph.test.js` ではなく CI job として `madge`

## 13. 優先度付き改善バックログ

### High

1. `resolveWorkspacePathStrict` を導入し、review input、diff fixture、review package、Bob output、triage、traceability catalog の path 境界を統一する。
2. Git / Bazaar revision validation を追加する。
3. DOCX/XLSX/diff/bob-input のサイズ上限と truncation warning を追加する。
4. `iconv-lite` が runtime import なら `dependencies` へ移す。
5. VSIX contents と bundle size を CI で可視化する。

### Medium

1. `documentExtractor.ts` を format 別に分割する。
2. `cCppChangeAnalyzer.ts` を parser/detector/renderer に分割する。
3. `extension.ts` から command implementation を分離する。
4. `knip` / `depcheck` / `ts-prune` を report-only で導入する。
5. `madge --circular` を CI に追加する。

### Low

1. `core/types.ts` をドメイン別に分割する。
2. `traceabilityCatalog.ts` の facade と変換実装を分離する。
3. README に generated artifacts privacy、Workspace Trust、path boundary、サイズ制限を追記する。
4. `.gitignore` helper を initializer に追加する。
5. schema と TS 型の drift check を導入する。

## 14. 実測用コマンド

対象 ref を checkout できるローカル環境で、以下を実行すると本レビューの「要実測」部分を埋められる。

```bash
git checkout 14afe83c2218d881a9cd7b17b68b837c53507114
cd extensions/bob-code-consistency-review

npm ci
npm run compile
npm test

# code size
find src test resources templates -type f \
  \( -name '*.ts' -o -name '*.js' -o -name '*.json' -o -name '*.md' -o -name '*.yaml' \) \
  -print0 | xargs -0 wc -l | sort -n

# package contents / bundle size
npx vsce package --no-yarn
npx vsce ls > vsce-files.txt
du -sh node_modules out *.vsix 2>/dev/null || true

# dependency graph
npx madge --extensions ts --circular src

# unused code/deps
npx knip --production || true
npx depcheck || true

# audit
npm audit --omit=dev || true
```

## 15. 結論

`bob-code-consistency-review` は、レビュー前処理としての責務分解はよく、pipeline も薄く保たれている。テストも主要機能には広く存在する。

ただし、文書 parser 依存、raw diff、review-package 生成物、absolute path 許容、Git/Bazaar CLI 入力、Bob/workflow-register 連携という複数の境界を持つため、3拡張の中では最も「サイズ・依存・入力境界」の運用リスクが高い。

まずは path boundary、revision validation、サイズ上限、VSIX/dependency CI、循環依存検査を入れるべきである。その後、document extractor と C/C++ analyzer の分割、型定義のドメイン分割を進めると、チーム利用時の保守性とレビュー品質がかなり安定する。
