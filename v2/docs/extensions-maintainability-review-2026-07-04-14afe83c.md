# extensions 配下 3 拡張機能 維持性・サイズ観点レビュー

- 対象リポジトリ: `katamor1/bob_builtin_analyze`
- 対象 ref: `14afe83c2218d881a9cd7b17b68b837c53507114`
- 対象ディレクトリ:
  - `extensions/workflow-register`
  - `extensions/bob-bazaar-review`
  - `extensions/bob-code-consistency-review`
- レビュー日: 2026-07-04
- レビュー種別: GitHub 上のソース、設定、package metadata、README、代表実装、テスト配置に基づく静的レビュー

## 0. 前提と制約

本レビューは静的レビューであり、以下は未実行である。

- `npm install` / `npm ci`
- `npm run compile`
- `npm test`
- `npm audit`
- `vsce package`
- 実 VSIX サイズ、`node_modules` 実ディスクサイズ、`out/` 実サイズの測定
- `madge` / `dependency-cruiser` による循環依存の機械検出
- `knip` / `ts-prune` / `depcheck` による未使用コード・未使用依存の機械検出

そのため、コードサイズ・ファイルサイズ・bundle サイズは、取得できたファイル構成、package metadata、`.vscodeignore`、`tsconfig.json`、代表的な型定義、テストファイル一覧からの評価を中心にする。実測が必要な項目は明示的に「要実測」として扱う。

## 1. 総評

3 拡張はいずれも TypeScript の `strict` mode で構成され、`src/**/*.ts` を `out/` に CommonJS / ES2022 としてコンパイルする構成で揃っている。機能ごとの分割は全体として進んでいるが、サイズ・依存・型定義・テスト密度の性格はかなり異なる。

| 拡張 | 総合評価 | サイズ/複雑度 | 主なリスク | 主な強み |
|---|---:|---:|---|---|
| `workflow-register` | B+ | 大 | 中心モデルと workflow runtime の型・状態が肥大化しやすい。source map を VSIX から除外する設定が見えない。 | モジュール分割と自動テスト密度が最も高い。runtime 依存は軽め。barrel export 集中は低い。 |
| `bob-bazaar-review` | A- | 小〜中 | `bzr` CLI、MCP、workspace state など、bundle には出ない暗黙依存が多い。 | 実行時 npm 依存がほぼなく、VSIX/bundle は最も小さく保ちやすい。責務も比較的明瞭。 |
| `bob-code-consistency-review` | B | 中〜大 | `cheerio` / `mammoth` / `xlsx` 等により bundle/VSIX と supply-chain 面の重さが最大。 | pipeline、document extraction、traceability、triage が比較的分離され、拡張依存も明示されている。 |

最優先で見るべきなのは `bob-code-consistency-review` の bundle/依存サイズと `workflow-register` の中心モデル肥大化である。`bob-bazaar-review` は比較的軽量だが、Bazaar/MCP/workspace 境界に関する暗黙依存を明文化しないと、コード量以上に理解コストが上がる。

## 2. 定量スナップショット

GitHub 上で確認できた範囲の下限値をまとめる。

| 指標 | `workflow-register` | `bob-bazaar-review` | `bob-code-consistency-review` |
|---|---:|---:|---:|
| `package.json` 行数 | 約226行 | 176行 | 209行 |
| `.vscodeignore` 行数 | 38行 | 31行 | 86行 |
| `tsconfig.json` 行数 | 17行 | 17行 | 17行 |
| 確認できた test/helper ファイル数 | 約40 | 15 | 21 |
| 代表的な中心型定義 | `src/core/model.ts` 約260行超 | `src/projectRules/types.ts` 約77行 | `src/core/types.ts` 約131行 + `traceabilityTypes.ts` 約104行 |
| 実行時 npm 依存 | `ajv`, `js-yaml` | なし | `ajv`, `cheerio`, `mammoth`, `xlsx`, `yaml` |
| lockfile | 見当たらず | 見当たらず | `package-lock.json` あり、約4147行 |
| VSIX 実測サイズ | 要実測 | 要実測 | 要実測 |
| 循環依存実測 | 要 `madge` | 要 `madge` | 要 `madge` |
| 未使用コード実測 | 要 `knip` / `ts-prune` | 要 `knip` / `ts-prune` | 要 `knip` / `ts-prune` |

## 3. 観点別レビュー

## 3.1 コードサイズ

### `workflow-register`

`workflow-register` は3拡張の中で最大かつ最も複雑である。workflow 登録、parser、engine、step execution、run state、task snapshot、result sink、Webview builder、AI authoring、diagnostics、commands を扱う。

良い点:

- `src/core` 以下に parser / engine / model / validator / run store などが寄せられており、VS Code 依存と純粋ロジックの切り分けは進んでいる。
- `src/commands`、`src/webview`、`src/core/engine` のように責務単位のディレクトリがある。
- テストファイル数が最も多く、実装増加に対する回帰検知の土台がある。

懸念:

- `src/core/model.ts` が workflow file schema、runtime state、provider API、result sink API まで抱えており、変更影響が集中しやすい。
- `engine.ts` と `core/engine/*` が併存しているため、facade と内部実装の依存方向を固定しないと循環や責務重複が入りやすい。
- Webview builder 関連 script が増えており、`out/` 側の compiled JS と source map が増えやすい。

推奨:

1. `src/core/model.ts` を `schemaTypes.ts`、`runtimeTypes.ts`、`providerApiTypes.ts`、`resultSinkTypes.ts` に分割する。
2. `core/engine` 配下の import 方向を ADR または dependency-cruiser rule で固定する。
3. Webview client script は可能なら bundle/minify するか、少なくとも source map を VSIX から除外する。
4. CI で最大単一ファイル行数を監視する。初期閾値例: 350行 warning、500行 fail。

### `bob-bazaar-review`

`bob-bazaar-review` は3拡張の中で最もコンパクトで、Bazaar CLI wrapper、review packet、project rules、result capture、MCP、GUI が主な機能である。

良い点:

- 実行時 npm 依存がなく、外部ライブラリ由来のコードサイズ増加が少ない。
- `projectRules/` と `mcp/` は独立した責務として分離されている。
- `package` script が `vsce package --no-dependencies` であり、依存同梱の膨張を避ける意図が明確。

懸念:

- `src/` 直下に `bazaar.ts`、`bazaarReviewCommands.ts`、`reviewGui.ts`、`reviewPacket.ts`、`workflowRegisterBridge.ts`、`workspaceResolver.ts` などが並び、root 直下の関心が増えつつある。
- Bazaar CLI と Bob/MCP の境界がコード量の割に多く、暗黙前提の理解コストが高い。

推奨:

1. `src/bazaar/`、`src/review/`、`src/workflow/`、`src/mcp/` のように root 直下 TS を段階的にサブディレクトリへ移す。
2. CLI wrapper と packet builder は `bazaar -> reviewPacket -> commands` の一方向に固定する。
3. MCP server と VS Code extension host の境界を docs と tests で明示する。

### `bob-code-consistency-review`

`bob-code-consistency-review` は pipeline 型の中規模〜大規模拡張である。review input、diff collection、document extraction、C/C++ analysis、traceability、Bob output capture、triage、template loading、workflow provider registration が含まれる。

良い点:

- `core/pipeline.ts` を中心に処理段階が分かれている。
- `analyzers/`、`templates/`、`triage/`、`webview/` など、責務別ディレクトリが見える。
- `extensionDependencies` で `IBM.bob-code` と `local.workflow-register` が明示されており、runtime 前提が package metadata に出ている。

懸念:

- 文書抽出、diff、traceability、AI output validation など domain が多く、中心型の増加が早い。
- `core/` に pipeline、types、validators、store、capture、canonicalizer が集まり、今後 `core` が雑多化する恐れがある。
- runtime dependency が重く、コードサイズよりも `node_modules` / VSIX サイズが支配的になりやすい。

推奨:

1. `core/` を `review-input/`、`diff/`、`documents/`、`traceability/`、`bob-output/` に分割する。
2. `types.ts` は domain ごとの型ファイルへ分ける。特に `ReviewInput`、`EvidenceRef`、`CodeAnalysisResult`、`PreprocessResult` は責務が違う。
3. `documentExtractor` で `xlsx` / `mammoth` / `cheerio` を lazy import し、activation 時の読み込みを抑える。

## 3.2 ファイルサイズ

### 共通

3拡張とも `tsconfig.json` で `sourceMap: true` になっている。`.vscodeignore` では `src/**` や `*.ts` は除外されているが、`out/**/*.map` の除外は確認できない。VSIX に source map を含める意図がないなら、これは全拡張共通のサイズ増加要因である。

推奨:

```gitignore
# .vscodeignore
out/**/*.map
```

source map を利用した障害解析を重視するなら含めてもよいが、その場合は VSIX budget に明示的に入れる。

### `workflow-register`

`.vscodeignore` で `src/**`、`test/**`、`node_modules/**` を除外しつつ、runtime dependency の必要パッケージのみ whitelist している。これは小さめの VSIX を作る方針として良い。

懸念は Webview 用 client script が `out/` にコンパイルされる点である。GUI authoring 機能が伸びるほど `out/webview` が膨らむ。

推奨:

- `vsce ls` を CI で取り、`out/webview/*` の増加を監視する。
- Webview script は可能なら 1〜2 bundle にまとめる。

### `bob-bazaar-review`

`.vscodeignore` は `node_modules/**` を全面除外し、package script も `--no-dependencies` である。実行時依存がないため、VSIX は概ね `out/`、templates、README/docs に収まるはずで、3つの中で最もサイズ制御しやすい。

注意点は `templates/.bob/**` である。workflow template、review schema、prompt template、skill document が VSIX に含まれる想定なので、テンプレートが増えるとソースコード以外で膨らむ。

推奨:

- template ファイルのサイズ budget を設ける。
- 長い prompt/template は docs と runtime template を分け、runtime には最小版だけ置く。

### `bob-code-consistency-review`

`.vscodeignore` は3つの中で最も複雑で、runtime dependency を残しつつ `node_modules` 内の tests、examples、docs、`.d.ts`、`.map` などを除外する設計になっている。これは重い依存を抱える拡張として妥当だが、依存の種類から見て VSIX サイズの主要因は `node_modules` になる。

特に `xlsx`、`mammoth`、`cheerio` は document extraction のために必要だが、通常の lightweight command でも同梱対象になる。`package-lock.json` が約4147行あり、依存グラフが他2拡張よりかなり大きい。

推奨:

1. `npm ci --omit=dev` 後の `node_modules` サイズを測る。
2. `vsce package` 後の `.vsix` サイズと展開後ファイル一覧を CI artifact に残す。
3. `documentExtractor` で `xlsx` / `mammoth` / `cheerio` を lazy import し、activation のメモリも抑える。
4. 文書抽出機能を別 extension または optional feature に分ける選択肢を検討する。

## 3.3 モジュール分割

| 拡張 | 評価 | コメント |
|---|---:|---|
| `workflow-register` | 良いが大規模化注意 | `core`、`commands`、`webview`、`parser`、`engine` に分かれている。中心型と engine facade の影響範囲を抑えたい。 |
| `bob-bazaar-review` | 概ね良い | `projectRules` と `mcp` は明確。root 直下 TS が増えつつあるため、サブドメイン化するとさらに読みやすい。 |
| `bob-code-consistency-review` | 良いが `core` 過密気味 | pipeline 分割は良い。`core` に domain が集まりすぎる前に、review-input/diff/documents/traceability/bob-output へ切り出したい。 |

共通の改善案:

- `src/index.ts` のような巨大 entry barrel は作らない。現在は barrel export 集中が低いので、この状態を維持する。
- ディレクトリごとに `README.md` または短い ADR を置き、依存方向を文章化する。
- `madge --circular` と `dependency-cruiser` を CI に入れる。

## 3.4 依存パッケージ・bundle サイズ

### `workflow-register`

実行時依存は `ajv` と `js-yaml` の2つである。JSON schema validation と YAML parsing という用途から妥当で、依存面の重さは中程度以下である。

`.vscodeignore` は `node_modules/**` を除外しつつ、`ajv`、`fast-deep-equal`、`fast-uri`、`json-schema-traverse`、`require-from-string`、`js-yaml`、`argparse` を whitelist している。これは VSIX に必要 runtime dependency だけを入れる意図として評価できる。

懸念:

- `package-lock.json` が確認できないため、再現性は `npm install` 時点の semver 解決に依存する。
- `sourceMap: true` により `out/**/*.map` が VSIX に入る可能性がある。

推奨:

- `package-lock.json` を追加する。
- `vsce ls` で whitelist が過不足ないか検証する。
- VSIX budget を設定する。

### `bob-bazaar-review`

実行時 npm 依存がないため、bundle/VSIX は最小化しやすい。`vsce package --no-dependencies` もこの方針と整合している。

懸念:

- npm と VSIX は軽いが、実行時には `bzr` CLI と Bob/MCP 設定に依存する。これは bundle size には出ないが、導入・テスト・障害調査コストには出る。
- templates が増えると VSIX サイズが増える。

推奨:

- `bzr` CLI の存在チェックと version check を必要 command 実行時に行う。
- template size budget を設ける。
- `vsce package --no-dependencies` を維持する。

### `bob-code-consistency-review`

実行時依存は `ajv`、`cheerio`、`mammoth`、`xlsx`、`yaml` である。3つの中で最も重い。特に `.docx` / `.xlsx` の抽出は価値がある反面、VSIX サイズ、install 時間、audit surface、CVE 対応コストを増やす。

懸念:

- `xlsx` は単体でも大きくなりがちで、spreadsheet parser としての攻撃面も広い。
- `mammoth` は docx zip/xml 解析を伴うため、文書サイズ制限・タイムアウト・例外処理が重要。
- `cheerio` は HTML/XML parsing のために transitive が増える。
- lockfile が大きく、dev と runtime を分けた audit が必要。

推奨:

1. `dependencies` と `devDependencies` の境界を再点検する。
2. document extraction は lazy import にする。
3. `.xlsx` / `.docx` support を optional にする案を検討する。
4. `npm audit --omit=dev` と full `npm audit` を分けて CI で見る。
5. VSIX budget を他2拡張より明示的に置く。

## 3.5 未使用コード

機械検出は未実行。現在の `tsconfig.json` には `strict: true` はあるが、`noUnusedLocals` と `noUnusedParameters` は確認できない。したがって、TypeScript compiler だけでは未使用 local/import/parameter の検出は十分ではない。

| 拡張 | 未使用コードリスク | 理由 |
|---|---:|---|
| `workflow-register` | 中 | public API、re-export、Webview script、commands が多い。テストは厚いが unused export 検査がない。 |
| `bob-bazaar-review` | 低〜中 | コード量は小さめだが、optional workflow integration と MCP server で静的検出が難しい export がある。 |
| `bob-code-consistency-review` | 中 | domain が広く、AI draft / traceability / webview / workflow provider の helper が増えやすい。 |

推奨:

```bash
npx knip --production
npx depcheck
npx ts-prune --project tsconfig.json
```

導入時は false positive が出るため、最初は report-only にし、baseline を作ってから fail gate にする。

## 3.6 循環依存

循環依存の機械検出は未実行。静的に見た限り、3拡張とも barrel export が少なく、巨大 index による依存隠蔽は少ない。これは良い。

懸念箇所:

- `workflow-register`: `core/engine.ts` と `core/engine/*`、`bobWorkflowRunner.ts` と `core/*`、`commands/*` と service/engine の依存方向。
- `bob-bazaar-review`: `workflowRegisterBridge`、`projectRules`、`review result capture`、MCP server 周辺。
- `bob-code-consistency-review`: `core` と `analyzers` の相互利用、`traceabilityCatalog` と `traceabilityValidation`、`extension.ts` と `workflowProviderRegistration`。

推奨:

```bash
npx madge --extensions ts --circular src
npx dependency-cruiser src --output-type err
```

dependency-cruiser ルール例:

- `src/core/**` は `src/webview/**` を import しない。
- `src/core/**` は VS Code API を直接 import しない。必要なら adapter layer 経由にする。
- `src/extension.ts` は composition root。下位 module は `extension.ts` を import しない。
- `src/**/types.ts` は実装 module を import しない。
- `export *` を禁止し、re-export は explicit export のみにする。

## 3.7 暗黙依存

### 共通

3拡張とも VS Code extension host、IBM Bob、workspace file system、`.bob` 配下の conventions に依存する。README と package metadata に一部は出ているが、trusted workspace 前提、生成物の機密性、external command 実行の境界はより明文化した方がよい。

### `workflow-register`

暗黙依存:

- IBM Bob extension API: `IBM.bob-code` の `registerSource` / `registerWorkflow` 相当。
- `.bob/workflows/*/WORKFLOW.md` の配置規約。
- `.bob/workflows/runs/<runId>` の run state / task snapshot 保存先。
- `vscode.executeCommand` provider と workflow YAML の command args。
- Bob task の optional API: messages、metadata、serialization、subagent、sendMessage。

懸念:

- workflow は repository 内の Markdown/YAML から command step や result sink を定義できるため、trusted workspace 前提である。
- task snapshot は Bob messages や last assistant text を保存し得る。

推奨:

- README に trusted workspace と snapshot privacy を明記する。
- Workspace Trust API に対応する。
- `vscode.executeCommand` は provider ID だけでなく実 command ID allowlist/denylist を持つ。

### `bob-bazaar-review`

暗黙依存:

- `bzr` CLI。
- Bazaar repository layout。
- MCP server 起動設定 `.bob/mcp.json`。
- Bob/LLM の MCP tool call。
- `.bob/review` の project rules / result schema / review result storage。
- `workflow-register` がある場合の optional integration。

懸念:

- npm dependency が軽いため問題が見えにくいが、実際の運用は external CLI と MCP に大きく依存する。
- MCP server 側で allowed workspace root を明示的に持たないと、Bob/LLM tool call から意図しない cwd を扱う余地がある。

推奨:

- MCP server に `BOB_BAZAAR_ALLOWED_ROOTS` を渡し、server 側で realpath + path.relative による境界検査を行う。
- Bazaar CLI version / encoding / alias 無効化の前提を docs に明記する。

### `bob-code-consistency-review`

暗黙依存:

- `IBM.bob-code` と `local.workflow-register`。
- Git / Bazaar CLI。
- `review-input.yaml` schema。
- `.bob-review/review-package`、`.bob-review/bob-output`、`.bob-review/human-triage`。
- `.bob-trace/traceability-catalog.json`。
- Markdown / DOCX / XLSX 文書構造。
- Shift-JIS 系 encoding fallback。

懸念:

- `absolute()` と `resolveWorkspacePath()` が absolute path をそのまま許容する箇所があり、workspace 境界が一貫しない。
- Git revision / Bazaar revision が CLI arg に入るため、shell injection ではないが option injection や異常 revision の検証が必要。
- review package に raw diff、文書抜粋、code slice、Bob prompt が残る。

推奨:

- `resolveWorkspacePathStrict(root, value, { allowExternal?: boolean })` を共通化する。
- default は workspace 内のみ許可する。
- Git revision は `git rev-parse --verify --end-of-options <rev>^{commit}` で SHA に解決してから使う。
- Bazaar revision は allowlist validation を入れる。
- generated artifacts の `.gitignore` helper と privacy notice を追加する。

## 3.8 union / mapped type など型定義の量やサイズ

### `workflow-register`

型定義量は最大。`WorkflowSchemaVersion`、`WorkflowStepType`、`RunStatus`、`StepRunStatus`、`WorkflowFailurePolicy`、`WorkflowStepReviewPauseAfter` などの union は適切だが、`model.ts` に集中している。

懸念:

- `CoreWorkflowDefinition` が file schema、runtime metadata、Bob adapter 用情報を同時に持つ。
- `EngineStep`、`ResultSourceDefinition`、`ResultSinkDefinition` は discriminated union として良いが、追加 step/sink が増えるほど中心型変更が増える。
- `workflowSchema.ts` と `schema/workflow-register.v1.schema.json` の二重管理が drift を起こし得る。

推奨:

- schema-derived type と runtime state type を分ける。
- JSON Schema から TS 型を生成するか、TS から JSON Schema を生成する。
- public API 型と internal runtime 型を別ファイルにする。

### `bob-bazaar-review`

型定義は比較的少ない。`ReviewStatus`、`ReviewSeverity`、`ReviewConfidence`、`ProjectRule`、`ChecklistResult`、`ReviewResult` などが project rules 周辺にまとまっている。

良い点:

- 型の domain が小さく、読みやすい。
- mapped type の過度な濫用は見えない。

懸念:

- `ReviewResult.vcs.type: "bazaar" | string` は柔軟だが、exhaustiveness check は弱い。
- MCP tool input/output の型が project rules 型とは別に増えると、型定義が分散しやすい。

推奨:

- MCP tool schema/input/output 型を `mcp/types.ts` に明示する。
- `ReviewResult.vcs.type` は `"bazaar" | (string & {})` のように意図を示すか、known/extension の別 field にする。

### `bob-code-consistency-review`

型定義は `core/types.ts` と `core/traceabilityTypes.ts` に集まっている。`ReviewInput`、`DiffSummary`、`EvidenceRef`、`DocumentExtractionResult`、`CodeAnalysisResult`、`TraceabilityResult`、`PreprocessResult` が `types.ts` にあり、domain が広い。

良い点:

- `TraceabilityStatus`、`TraceabilityItemType`、`TraceabilityLinkType` などは union で明確。
- `DiffSummary.files[].status` や code analysis confidence も union で表現されている。
- mapped type の過度な濫用は見えない。

懸念:

- `EvidenceRef.type` が literal union に `| string` を含み、実質任意 string である。
- `ReviewInput.artifacts: Record<string, unknown>` は schema validation 前提で柔軟だが、TypeScript 上は弱い。
- domain が広いため `types.ts` がさらに肥大化しやすい。

推奨:

- `reviewInputTypes.ts`、`diffTypes.ts`、`evidenceTypes.ts`、`documentTypes.ts`、`codeAnalysisTypes.ts`、`preprocessTypes.ts` に分割する。
- schema と TS 型の drift check を追加する。
- `ReviewInput.artifacts` は artifact kind ごとの discriminated union に寄せる。

## 3.9 barrel export の集中度

`export * from` は確認できず、barrel export の集中度は全体として低い。これは良い。

確認できた re-export:

- `workflow-register`: `core/parser.ts` と `core/parser/index.ts` が `parseWorkflowMarkdown` を明示 re-export。`bobWorkflowRunner.ts` も少数の re-export を持つ。
- `bob-bazaar-review`: 小規模な explicit re-export が見える程度。
- `bob-code-consistency-review`: `core/traceabilityCatalog.ts` が traceability 型や validator を明示 re-export。

懸念:

- `workflow-register` の `core/parser.ts` と `core/parser/index.ts` は二重 entry になり、import 経路が割れる。
- `bob-code-consistency-review` の `traceabilityCatalog.ts` は public facade と変換実装を兼ねており、今後 barrel 化しやすい。

推奨:

- `export *` を禁止する lint/dependency rule を入れる。
- public API re-export は explicit export のみにする。
- parser entry は1つに寄せる。
- facade と実装を分ける。

## 3.10 自動テスト密度

3拡張とも `npm run compile && node --test test/*.test.js` でテストする構成で統一されている。

### `workflow-register`

テスト密度は高い。確認できた test/helper ファイルは約40で、parser、engine、result sink、task snapshot、workflow runtime、authoring、AI provider、builder webview、run recovery、workspace roots など広くカバーしている。

追加したいテスト:

- `madge` による循環依存チェック
- `knip` による未使用 export/import チェック
- `.vscodeignore` の package allowlist 検証
- `vsce ls` snapshot テスト
- `vscode.executeCommand` の実 command ID allowlist/denylist regression

### `bob-bazaar-review`

テスト密度は中〜高。確認できた test/helper ファイルは15で、Bazaar client、project rules path、workflow provider registration、MCP server version、result capture、workspace roots、workflow template などが対象である。

追加したいテスト:

- MCP allowed root 外 `cwd` の拒否
- `bzr` がない場合の user-facing error
- template files が VSIX に含まれること
- `vsce package --no-dependencies` で `node_modules` が入らないこと

### `bob-code-consistency-review`

テスト密度は中。確認できた test/helper ファイルは21で、review pipeline、document extraction、traceability catalog/store/webview、Bob output capture/canonicalize、triage、workflow registration などが対象である。

追加したいテスト:

- `.xlsx` sheet/row/byte 上限
- `.docx` byte 上限
- raw diff 上限
- lazy import により activation 時に heavy dependency を読まないこと
- `vsce package` サイズ budget
- `npm audit --omit=dev` 結果の CI gate

## 4. 拡張別優先対応

## 4.1 `workflow-register`

| 優先度 | 対応 |
|---:|---|
| High | `model.ts` の public/internal/schema/runtime 分割計画を作る。 |
| High | `madge --circular` を CI に追加する。 |
| High | `vscode.executeCommand` の guardrail を実 command ID まで見る形に強化する。 |
| Medium | `.vscodeignore` に `out/**/*.map` を含めるか、source map 同梱方針を明文化する。 |
| Medium | `knip` / `ts-prune` を導入する。 |
| Low | `core/parser.ts` と `core/parser/index.ts` の二重 re-export 経路を整理する。 |

## 4.2 `bob-bazaar-review`

| 優先度 | 対応 |
|---:|---|
| High | MCP allowed root の明示と server 側検証を追加する。 |
| Medium | `src/bazaar/`, `src/review/`, `src/workflow/` へ root module を整理する。 |
| Medium | `bzr` version/check command と diagnostic を追加する。 |
| Low | template size budget と `vsce ls` snapshot を追加する。 |

## 4.3 `bob-code-consistency-review`

| 優先度 | 対応 |
|---:|---|
| High | `resolveWorkspacePathStrict` を導入し、review input、diff fixture、review package、Bob output、triage、traceability catalog の path 境界を統一する。 |
| High | Git/Bazaar revision validation を追加する。 |
| High | `.docx` / `.xlsx` / raw diff / excerpts / bob-input の byte/row/sheet 上限を追加する。 |
| High | `vsce package` の実サイズを CI gate 化する。 |
| Medium | `documentExtractor.ts` を format 別に分割する。 |
| Medium | `cCppChangeAnalyzer.ts` を parser/detector/renderer に分割する。 |
| Medium | `types.ts` を domain ごとに分割する。 |

## 5. 横断改善バックログ

### High

1. 3拡張すべてで `madge --circular` を入れる。
2. 3拡張すべてで `vsce package` のサイズ/含有ファイルチェックを入れる。
3. 3拡張すべてで `out/**/*.map` の同梱方針を決める。
4. `bob-code-consistency-review` の heavy dependency lazy loading とサイズ上限を入れる。
5. `workflow-register` の中心型分割方針を決める。

### Medium

1. `knip` / `ts-prune` / `depcheck` を report-only で導入する。
2. `package-lock.json` の有無と `npm ci` 運用を揃える。
3. README に「生成物」「VSIX サイズ」「暗黙依存」「必要 CLI」「trusted workspace」を追加する。
4. template/prompt/schema のサイズ budget を作る。

### Low

1. re-export shim を public API 境界だけに限定する。
2. file count / LOC count の推移を PR コメントに出す。
3. schema と TypeScript 型の drift check を追加する。

## 6. 実測用コマンド集

対象 ref を checkout できるローカル環境で、以下を実行すると本レビューの「要実測」部分を埋められる。

```bash
git checkout 14afe83c2218d881a9cd7b17b68b837c53507114

# 1. ソース/テスト/設定の行数
for d in extensions/workflow-register extensions/bob-bazaar-review extensions/bob-code-consistency-review; do
  echo "## $d"
  find "$d" -type f \
    \( -name '*.ts' -o -name '*.js' -o -name '*.json' -o -name '*.md' -o -name '*.yaml' -o -name '*.yml' \) \
    -not -path '*/node_modules/*' \
    -print0 | xargs -0 wc -l | sort -n | tail -20
  echo
  find "$d/src" -type f -name '*.ts' | wc -l
  find "$d/test" -type f -name '*.test.js' 2>/dev/null | wc -l
  du -sh "$d" 2>/dev/null
  echo
 done

# 2. compile/test/package/bundle size
for d in extensions/workflow-register extensions/bob-bazaar-review extensions/bob-code-consistency-review; do
  echo "## $d"
  (cd "$d" && npm ci && npm run compile && npm test && npx vsce package --no-yarn)
  (cd "$d" && du -sh node_modules out *.vsix 2>/dev/null || true)
  (cd "$d" && npx vsce ls > vsce-files.txt)
 done

# 3. 循環依存
for d in extensions/workflow-register extensions/bob-bazaar-review extensions/bob-code-consistency-review; do
  echo "## $d"
  (cd "$d" && npx madge --extensions ts --circular src)
 done

# 4. 未使用コード/依存
for d in extensions/workflow-register extensions/bob-bazaar-review extensions/bob-code-consistency-review; do
  echo "## $d"
  (cd "$d" && npx knip --production || true)
  (cd "$d" && npx depcheck || true)
 done
```

## 7. 推奨 CI gate 例

```jsonc
{
  "scripts": {
    "check": "npm run compile && npm test && npm run check:deps && npm run check:cycles && npm run package:check",
    "check:deps": "knip --production",
    "check:cycles": "madge --extensions ts --circular src",
    "package:check": "vsce package --no-yarn && node scripts/check-vsix-budget.js"
  }
}
```

`check-vsix-budget.js` で見るべき条件:

- VSIX サイズ上限
- `src/`, `test/`, `*.ts`, `*.tsbuildinfo` が入っていないこと
- `out/**/*.map` の方針に従っていること
- `node_modules` に tests/examples/docs が入っていないこと
- `bob-code-consistency-review` の VSIX サイズが閾値を超えたら warning/fail

## 8. 結論

- `workflow-register` は機能量・型定義量・テスト量が最大で、基盤拡張としてよく分割されている。ただし中心型と engine 周辺は今後の肥大化・循環依存を防ぐ設計ルールが必要。
- `bob-bazaar-review` は最も軽量で、実行時 npm 依存がない点が強い。bundle size 面では優秀だが、`bzr` CLI、MCP、workspace root など bundle に現れない暗黙依存の明文化が重要。
- `bob-code-consistency-review` は最も dependency/bundle リスクが大きい。文書抽出機能の価値は高いが、`xlsx` / `mammoth` / `cheerio` を lazy import 化し、VSIX size と audit を CI gate 化するべき。

まず入れるべきは、`madge` による循環依存チェック、`vsce package` のサイズ/含有ファイルチェック、`out/**/*.map` 方針の決定、`bob-code-consistency-review` の heavy dependency lazy loading、`workflow-register` の中心型分割である。これらを入れると、今後の拡張追加時に「気づいたら大きい・重い・絡まっている」をかなり防げる。
