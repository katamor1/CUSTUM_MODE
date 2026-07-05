# bob-code-consistency-review コード・ドキュメント・テスト整合レビュー

- 対象リポジトリ: `katamor1/bob_builtin_analyze`
- 対象コミット: `350010e766d99ad19a0bba5bf11e2cbd0ee04e62`
- 対象パス: `extensions/bob-code-consistency-review`
- 実施日: 2026-07-05
- 観点: コーディング、ドキュメントの整合性、仕様に対するテストの存在と整合性
- 方法: 指定コミットのソース、拡張定義、設計書、テスト仕様、実テストの静的照合。ローカルでの `npm test` 実行は未実施。

## 1. 総合判定

`bob-code-consistency-review` は、単なる scaffold ではなく、workflow-register 連携、review-input 生成、traceability sidecar、review-package 生成、Bob 出力 capture / validation、人間 triage までを持つ実装としてかなり進んでいる。

特に、workspace path boundary、workflow 経由 option の安全化、Bob 出力 canonicalization、生成物の privacy notice、パイプライン系サンプルテストは良い。正式レビュー前の安全な前処理拡張としての骨格は成立している。

一方で、ドキュメントと実装の同期、および「単体テスト仕様」と実際の `test/*.test.js` の対応付けには改善余地が大きい。次リリース前に、少なくとも Excel 依存の記述不一致、設定項目の漏れ、単体/結合テストの区分、CCR-UT ID と実テストのトレーサビリティは直したい。

### 判定サマリ

| 観点 | 判定 | コメント |
| --- | --- | --- |
| コーディング | 概ね良好。一部改善推奨。 | 安全境界と pipeline は強い。Webview の HTML escaping 契約と message validation はやや脆い。 |
| ドキュメント整合性 | 要修正。 | 詳細設計の `.xlsx` 依存記述、設定表の漏れ、実機テスト仕様の Webview 操作範囲にズレがある。 |
| 仕様に対するテスト | 部分的に充実。ただし traceability 不足。 | パイプライン、path boundary、Bob output、privacy は良い。CCR-UT ID と実テスト名の対応、単体/結合の切り分けが不足。 |

## 2. 良い点

### 2.1 command / provider の構成が明確

`package.json` は `bobCodeConsistency.*` command 群を activation event、Command Palette、設定値として整理している。`src/extension.ts` も VS Code command 登録と workflow provider 登録を 1 か所に集約しており、entry point の見通しはよい。

特に `workflowProviderRegistration.ts` は、workflow-register 側から渡る `inputs` / `args` / `state` を専用 helper で正規化しているため、ワークフロー連携の境界が読みやすい。

### 2.2 workflow 経由 option の安全化が強い

`workflowUserOptions.ts` は、`workspaceRoot`、`workflowRoot`、`bobRoot`、`bzrPath`、`diffFixturePath` などの実行環境や外部実行に関わる key を workflow user option から拒否している。さらに command ごとに許可 key を whitelist 化している。

この方針は、workflow 定義や入力値から任意 workspace / Bazaar 実行ファイル / fixture を差し替えられるリスクを抑えており、良い防御線になっている。

### 2.3 path boundary と生成物の配置制約がよい

`fileSystem.ts` の `resolveWorkspacePathStrict()` と `resolveWorkspacePathForKind()` は、workspace 外 escape、絶対 path、誤った生成物配置、symlink escape を扱っている。`pathBoundary.test.js` も review input、docsRoot、review-package、Bob output、triage、traceability catalog、diff fixture など複数の境界を検証している。

### 2.4 Bob output capture / validation / triage のテストが具体的

`bobOutputCaptureCanonicalize.test.js` と `reviewOutputTriage.test.js` は、実 AI 出力に近い shorthand、workflow-state wrapper、multiple YAML 候補、fallback 誤用、missing output、unknown evidence ID、triage file 生成を確認している。単なる schema happy path だけでなく、運用で起きそうな揺れを拾っている点はよい。

### 2.5 review-package の privacy notice が明示されている

`privacyArtifacts.test.js` は `.gitignore` への `.bob-review/`、`.bob-trace/ai-traceability-draft/`、`.bob/workflows/runs/` の追記、および manifest / deterministic checks への privacy notice を確認している。生成物が設計書、顧客仕様、ソース、raw diff を含み得る拡張として、良い運用ガードである。

## 3. 指摘事項

### F-01: 詳細設計の Excel 依存記述が実装・依存ポリシーと矛盾している

- 重要度: High
- 観点: ドキュメント整合性
- 対象: `docs/detailed-design-ja.md`, `src/analyzers/documentXlsxExtractor.ts`, `package.json`, `test/dependencyPolicy.test.js`

詳細設計の Document Extractor 詳細では、`.xlsx` は `xlsx` で workbook を読む、と記述されている。しかし実装は `read-excel-file/node` を動的 import しており、依存ポリシーテストも production dependency として `read-excel-file` を要求し、`xlsx` を禁止している。

これは単なる表記揺れではなく、依存ライブラリ選定・脆弱性回避ポリシー・実装方式に関わる不一致である。保守者が詳細設計だけを読んで `xlsx` を再導入すると、既存の dependency policy と衝突する。

推奨対応:

1. `docs/detailed-design-ja.md` の `.xlsx` 抽出説明を `read-excel-file` ベースへ修正する。
2. `xlsx` 非採用の理由を README / detailed design のどちらかに明記する。
3. `grep -R "xlsx" extensions/bob-code-consistency-review docs/workflows/code-consistency-review` で古い依存名の残存を洗い出す。

### F-02: README / 詳細設計の設定表に processing limit 系設定が載っていない

- 重要度: Medium
- 観点: ドキュメント整合性
- 対象: `package.json`, `README.md`, `docs/detailed-design-ja.md`

`package.json` には次の設定が存在する。

- `bobCodeConsistency.maxDocumentBytes`
- `bobCodeConsistency.maxWorkbookSheets`
- `bobCodeConsistency.maxRowsPerSheet`
- `bobCodeConsistency.maxExcerptBytesPerDocument`
- `bobCodeConsistency.maxRawDiffBytes`
- `bobCodeConsistency.maxBobInputBytes`

一方、README と詳細設計の設定表は `textEncoding` までで止まっている。これらの limit は、大きな設計書、Excel 台帳、raw diff、Bob input サイズを扱う上で運用上かなり重要である。

推奨対応:

1. README の設定表に全 limit 設定を追加する。
2. 詳細設計の設定設計にも同じ項目を追加する。
3. limit 超過時の動作、warning、切り捨て単位を `review-package` 仕様または README に追記する。

### F-03: 単体テスト仕様では Git / Bazaar CLI を mock としているが、実テストは real Git に依存している

- 重要度: High
- 観点: 仕様に対するテストの整合性
- 対象: `docs/unit-test-spec-ja.md`, `test/liveTraceabilitySidecarSample.test.js`, `test/reviewPipeline.test.js`

単体テスト仕様は、VS Code API、workflow-register、Git / Bazaar CLI を mock / stub 化するとしている。しかし実テストには、`git init`、`git commit`、`git switch` を実行して sample workspace を作るものがある。`reviewPipeline.test.js` も real git diff を使う sample test を含む。

これはテスト自体が悪いという意味ではない。むしろ実 Git sample による結合確認は有用である。ただし `npm test` が「単体テスト」として説明されている一方で実 Git を要求するため、CI や開発端末で Git が無い場合に失敗し得る。仕様と実態がズレている。

推奨対応:

1. `npm test` を純粋な unit に寄せ、real Git sample は `npm run test:integration` へ分ける。
2. もしくは `docs/unit-test-spec-ja.md` を改訂し、「unit 相当だが一部 sample integration は real Git を使う」と明記する。
3. CI の前提条件に Git を明記し、Bazaar は fixture / optional にする。

### F-04: CCR-UT ID と実テストの traceability が不足している

- 重要度: High
- 観点: 仕様に対するテストの存在と整合性
- 対象: `docs/unit-test-spec-ja.md`, `test/*.test.js`

単体テスト仕様は `CCR-UT-001` から `CCR-UT-054` まで非常に具体的に定義している。しかし実テスト名は仕様 ID を含まず、どの ID がどの test file / test case で満たされているかを追跡できない。

実装としては、path boundary、review pipeline、Bob output、triage、privacy、workflow option はかなりテストされている。一方で、次の領域は仕様 ID に対する直接テストが見つけにくい、または source regex / sample integration に偏っている。

- WorkspaceInitializer の workflow backup / unchanged / review-input 非上書きの個別 ID
- ReviewInputDiscovery / ReviewInputBuilder / Diagnostics の個別 ID
- docx / xlsx 抽出の明示 fixture
- TraceabilityPrepController の action apply の実行テスト
- workflow-register provider の実登録 runtime test
- Webview save message の runtime test

推奨対応:

1. `docs/bob-code-consistency-review-test-traceability-matrix.md` を追加し、`CCR-UT-*` ごとに `Covered / Partial / Missing / Integration-only` を記録する。
2. 実テスト名に `CCR-UT-xxx` を含める。
3. `Partial` と `Missing` は issue 化する。
4. source regex test は「構造 drift 検知」と明記し、behavior test と分ける。

### F-05: Traceability Prep Webview の実機テスト仕様が、実装より広い操作を期待している

- 重要度: Medium
- 観点: ドキュメント整合性、仕様に対するテスト整合性
- 対象: `docs/real-machine-test-spec-ja.md`, `src/core/traceabilityPrepController.ts`, `src/webview/traceabilityPrepWebviewAssets.ts`

実機テスト仕様の `CCR-RT-011` は、Webview で domain、document、item、link、decision を追加するとしている。一方、実装上の `TraceabilityPrepAction` は proposed domain / item / link / decision の approve / reject と accepted item の deprecate が中心で、新規 document や item を手入力で追加する action は定義されていない。

README や基本設計の文脈では、Traceability Prep は AI draft などで作られた proposed 候補を人間が accepted / rejected / deprecated に分類する UI と読める。その場合、実機テスト仕様の「追加する」が過剰である。

推奨対応:

1. v1 の意図が「候補承認 UI」なら、`CCR-RT-011` を「既存 proposed 候補を承認 / 棄却 / 廃止して保存する」に修正する。
2. もし手入力追加 UI が必要なら、`TraceabilityPrepAction`、Webview form、validation、unit test を追加する。

### F-06: Webview HTML escaping の契約が暗黙で、将来の XSS regression に弱い

- 重要度: Medium
- 観点: コーディング
- 対象: `src/webview/traceabilityPrepWebview.ts`, `src/webview/traceabilityPrepWebviewAssets.ts`

現状、初期 model JSON は `<` を escape して script に埋め込んでおり、`escapeHtml()` も用意されている。現在の主要 caller は `row()` に渡す body を事前に escape しているため、直ちに危険とは見ていない。

ただし `row(title, state, body, actions)` は `title` と `state` は escape する一方で、`body` と `actions` は HTML として結合する。この「body は caller が escape 済み」という契約は関数 signature から分からない。将来 caller が生文字列を渡すと Webview XSS の regression になる。

推奨対応:

1. `rowText(title, state, bodyText, actionsHtml)` のように body を関数内で escape する。
2. HTML を渡す必要がある場合は `rowHtml(...)` のように名前を分ける。
3. Webview asset の unit test に `<img onerror=...>` や `" data-args=...` を含む catalog fixture を追加する。

### F-07: Webview message / workflow provider の runtime test が source regex に偏っている

- 重要度: Medium
- 観点: 仕様に対するテストの存在と整合性
- 対象: `test/workflowProviderRegistration.test.js`, `test/traceabilityPrepWebview.test.js`, `test/traceabilityCommandWiring.test.js`

これらのテストは構造 drift 検知としては有効だが、正規表現で source を確認するだけでは、実際に provider が登録されるか、handler に渡る option が期待通りか、Webview save message で catalog / report が書かれるかまでは保証しない。

推奨対応:

1. `vscode.extensions.getExtension()` と mock workflow-register API を stub し、`registerWorkflowProviders()` を実行して provider 数・ID・handler input を検証する。
2. Webview は mock panel / mock webview を使い、`ready`、`action`、`save` message の副作用をテストする。
3. source regex test は残してよいが、behavior test の代替にしない。

### F-08: README の実装分割説明に古い文脈が残っている

- 重要度: Low
- 観点: ドキュメント整合性
- 対象: `README.md`

README の「現在の実装分割」節では主要ファイル一覧はおおむね合っているが、「現在の追加分割は `src/commands/reviewInputCommands.ts` まで反映済み」という表現が残っている。実際には `src/commands/workspaceCommands.ts`、`reviewExecutionCommands.ts`、`traceabilityCommands.ts`、Webview、triage まで存在しているため、読み手には古い移行途中の記述に見える。

推奨対応:

- この一文を削除するか、「command handler は `src/commands/*`、traceability / execution は専用 entry に分割済み」のように現状表現へ更新する。

## 4. 仕様領域ごとのテスト評価

| 仕様領域 | 主要な実テスト | 評価 |
| --- | --- | --- |
| workspace 初期化 | `privacyArtifacts.test.js` | privacy / gitignore は確認済み。workflow backup / unchanged / existing review-input 非上書きは ID 単位の明示テストを追加したい。 |
| workflow option safety | `workflowUserOptions.test.js`, `workflowOptions.test.js`, `pathBoundary.test.js` | 良好。blocked key、allowed key、state fallback、path boundary が確認されている。 |
| review input discovery / builder / diagnostics | `reviewPipeline.test.js`, `liveTraceabilitySidecarSample.test.js` | pipeline 経由の確認はあるが、CCR-UT 単位の直接テストが薄い。diagnostics / repair は特に明示性を上げたい。 |
| document extraction | `reviewPipeline.test.js` | Markdown / sample document 経由は確認されている。docx / xlsx fixture の明示テストが見つけにくい。 |
| C / C++ 解析 | `reviewPipeline.test.js`, `liveTraceabilitySidecarSample.test.js` | sample ベースで関数・RT 禁止候補を確認しており実用的。細粒度 unit ID との対応は要整理。 |
| multi-language generic evidence | `reviewPipeline.test.js` | TypeScript / Python / Java の generic evidence は確認されている。 |
| path boundary | `pathBoundary.test.js` | 強い。絶対 path、escape、misplaced artifacts、symlink escape、diff fixture escape を確認している。 |
| traceability sidecar | `liveTraceabilitySidecarSample.test.js`, `traceabilityPrepWebview.test.js`, `traceabilityCommandWiring.test.js` | sample integration は良い。Webview / controller の behavior test は不足。 |
| Bob output capture / validation | `bobOutputCaptureCanonicalize.test.js`, `reviewOutputTriage.test.js`, `liveTraceabilitySidecarSample.test.js` | 良好。canonicalization、evidence validation、error handling が具体的。 |
| human triage | `reviewOutputTriage.test.js`, `liveTraceabilitySidecarSample.test.js` | 良好。生成ファイルと missing output error を確認している。 |
| dependency / package policy | `dependencyPolicy.test.js` | 良好。lockfile、audit、package policy、no `xlsx`、README ops notes を確認している。 |
| real machine / UAT | `docs/real-machine-test-spec-ja.md`, `integrationSandboxScript.test.js` | sample launcher の検査はある。実機仕様の操作範囲は Webview 実装と一部ズレる。 |

## 5. 優先対応案

### P0 / 次リリース前に直す

1. 詳細設計の `.xlsx` 実装記述を `read-excel-file` へ修正する。
2. README / 詳細設計へ processing limit 系設定を追加する。
3. `docs/unit-test-spec-ja.md` と `npm test` の実態を合わせる。real Git test を integration 扱いにするか、単体テスト仕様を改訂する。
4. `CCR-UT-*` と実テストの traceability matrix を追加する。

### P1 / 近いタイミングで直す

1. Traceability Prep Webview の実機テスト仕様を実装に合わせる、または手入力追加 UI を実装する。
2. Webview の `row()` を body escape 前提から explicit な text / html API に分ける。
3. workflow-register provider と Webview message の runtime behavior test を追加する。
4. docx / xlsx extraction fixture test を追加する。

### P2 / 保守性改善

1. source regex test の目的を「構造 drift 検知」として明文化する。
2. README の古い移行途中コメントを削除する。
3. `npm run test:unit`、`npm run test:integration`、`npm test` の役割を package scripts と docs で揃える。

## 6. レビュー結論

コードベース自体は、path containment、workflow option sanitization、Bob output validation、privacy metadata といった安全性に関わる中心部分がよく作られている。実用上の主なリスクは、実装よりも「ドキュメントが古い箇所」と「仕様 ID と実テストの対応が追跡しづらい箇所」に集中している。

したがって、現時点でのおすすめは大規模な作り直しではなく、ドキュメント同期とテスト traceability の整備である。ここを整えると、拡張機能の保守・引き継ぎ・UAT の信頼性がかなり上がる。
