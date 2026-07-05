# bob-bazaar-review サイズ・依存・構造レビュー（2026-07-05 / 350010e）

## 1. レビュー対象

- Repository: `katamor1/bob_builtin_analyze`
- 対象 commit: `350010e766d99ad19a0bba5bf11e2cbd0ee04e62`
- 対象 extension: `extensions/bob-bazaar-review`
- レビュー種別: 静的レビュー
- 対象観点:
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

## 2. レビュー方法と前提

このレビューでは GitHub 上の `350010e766d99ad19a0bba5bf11e2cbd0ee04e62` を固定 ref として、`package.json`、`tsconfig.json`、`.vscodeignore`、`src/**/*.ts`、代表的な `test/*.test.js`、品質ポリシー用スクリプト、CI workflow を確認した。

制約として、レビュー中に `npm test`、`npm run package`、`npm audit`、`vsce package` は実行していない。そのため、実測 VSIX サイズ、audit 結果、全テスト実行結果は「CI 定義と静的確認」までの扱いにしている。コード行数は GitHub fetch 結果の総行数から connector metadata 2行を除いた静的概算であり、空行・コメントを含む。

## 3. 総合評価

| 観点 | 評価 | 要約 |
| --- | --- | --- |
| コードサイズ | 中 | `src/**/*.ts` は 54ファイル、約 6,200行。平均約115行、中央値81行。拡張機能としては肥大化し始めているが、まだ制御可能。 |
| ファイルサイズ | 要監視 | 300行超が3ファイル、200行超が8ファイル。`reviewGuiHtml.ts`、`resultCaptureCore.ts`、`reviewRecordStore.ts` は分割候補。 |
| モジュール分割 | 良 | `bazaar`、`mcp`、`projectRules`、`records`、`ui`、`workflow`、`workspace` へ分割済み。`src/extension.ts` は composition root に近い。 |
| 依存・bundle | 良〜要測定 | runtime dependency は `js-yaml` のみ。VSIX 350KB policy と `.vscodeignore` はあるが、今回のレビューでは実測 VSIX サイズ未確認。 |
| 未使用コード | 要改善 | `knip`、`ts-prune`、`depcheck` は導入済みだが report-only。未使用コードが増えても CI は落ちない。 |
| 循環依存 | 良 | `check-import-cycles.js src` が package script と CI に組み込まれている。手動確認範囲でも明確な循環は見えない。 |
| 暗黙依存 | 中〜要管理 | `bzr` CLI、Bob extension、workflow-register、`.bob` 配下ファイル、環境変数、VS Code trust など暗黙境界が多い。多くは README/テスト化済みだが、定数一覧化が欲しい。 |
| 型定義量 | 良 | union type は業務状態表現に限定され、mapped/conditional type の過剰使用は見られない。`any` が外部境界に残る。 |
| barrel export | 良 | `export *` barrel を禁止する policy とテストがある。集中 barrel は確認されない。 |
| 自動テスト密度 | 良 | `node --test test/*.test.js` で広範囲をカバー。構造/依存/セキュリティ境界/records/result capture/MCP までテストがある。一方で実 VS Code extension host E2E と実 Bazaar repo 操作は薄い。 |

## 4. 静的メトリクス

### 4.1 Source 全体

| 指標 | 値 |
| --- | ---: |
| TypeScript source files | 54 |
| Source LOC（空行・コメント込み） | 6,200 |
| 平均 LOC / file | 114.8 |
| 中央値 LOC / file | 81 |
| 200行以上の source file | 8 |
| 300行以上の source file | 3 |

### 4.2 ディレクトリ別

| ディレクトリ | files | LOC | コメント |
| --- | ---: | ---: | --- |
| `projectRules` | 13 | 1,584 | review result schema、capture、validation、Markdown recovery が集約。機能密度が最も高い。 |
| `bazaar` | 10 | 1,201 | Bazaar CLI wrapper、packet、target metadata、diff parsing。外部 CLI 境界を持つ。 |
| `records` | 6 | 909 | campaign / record / triage の追加で新たな大きめ subdomain になっている。 |
| `mcp` | 9 | 807 | JSON-RPC、tool registry、tool schemas、project rules tools に分割済み。前回より改善。 |
| `ui` | 3 | 635 | ファイル数は少ないが `reviewGuiHtml.ts` に HTML/CSS/JS が集中。 |
| `workspace` | 5 | 494 | workspace resolution、template refresh、Bob workspace init。 |
| `workflow` | 5 | 492 | workflow-register bridge/provider と result bridge。 |
| `bob` | 2 | 29 | Bob context 連携の薄い wrapper。 |
| root `extension.ts` | 1 | 49 | command registration だけに寄せられている。 |

### 4.3 大きい source file

| rank | file | LOC | 評価 |
| ---: | --- | ---: | --- |
| 1 | `src/ui/reviewGuiHtml.ts` | 360 | HTML/CSS/inline JS が1ファイルに集中。Webview 資産分割候補。 |
| 2 | `src/projectRules/resultCaptureCore.ts` | 356 | JSON 抽出、正規化、契約検証、artifact 保存が同居。責務分割候補。 |
| 3 | `src/records/reviewRecordStore.ts` | 324 | YAML I/O、record validation、campaign summary、Markdown rendering が同居。責務分割候補。 |
| 4 | `src/records/reviewRecordCommands.ts` | 264 | VS Code command orchestration が大きい。pure logic との境界は比較的明確。 |
| 5 | `src/ui/reviewGui.ts` | 262 | GUI controller と packet 作成 orchestration が集中。今後の機能追加で肥大化リスク。 |
| 6 | `src/bazaar/reviewTarget.ts` | 255 | single/range/working tree の target preparation がまとまっている。 |
| 7 | `src/projectRules/resultCaptureMarkdownRecovery.ts` | 250 | Markdown parser/復元ロジック。テストはあるが仕様増で膨らみやすい。 |
| 8 | `src/bazaar/revisionInfo.ts` | 216 | diff/file list parsing と added-file content section が同居。 |
| 9 | `src/bazaar/bazaar.ts` | 190 | BazaarClient と validation。CLI 境界として許容範囲。 |
| 10 | `src/bazaar/bazaarReviewCommands.ts` | 186 | 旧 command flow を保持。GUI flow との重複が出やすい。 |

## 5. コードサイズ / ファイルサイズ所見

### 良い点

- `src/extension.ts` は command registration と provider registration のみで、composition root として薄い。
- `src/mcp/server.ts` は JSON-RPC server 本体に寄り、Bazaar tool 実装や project rules tool 実装が外へ出ている。
- `src/bazaar`、`src/projectRules`、`src/workflow`、`src/workspace`、`src/ui`、`src/records` の意味単位が明確で、root 直下に機能ファイルが散らばっていない。
- `reviewLimits.ts`、`markdownFence.ts`、`textEncoding.ts` など pure utility は小さい。

### 気になる点

1. **`reviewGuiHtml.ts` のファイルサイズ**
   - 360行で HTML、CSS、client-side JS、initial state injection が同居している。
   - まだ単一 webview としては読めるが、項目追加・validation 追加・UI 状態追加が入ると急に壊れやすくなる。
   - bundle size 上も、inline template は差分レビュー時にノイズになりやすい。

2. **`resultCaptureCore.ts` の責務集中**
   - JSON fenced block 抽出、balanced JSON 抽出、summary normalization、project contract validation、artifact backup/atomic write、metadata generation が同居している。
   - テストは厚いが、変更理由が異なるロジックが1ファイルに詰まっているため、保守時の影響範囲が読み取りづらい。

3. **`records` subdomain の急拡大**
   - `reviewRecordStore.ts` 324行、`reviewRecordCommands.ts` 264行。
   - campaign summary、triage、artifact path validation、YAML I/O などが入り、`projectRules` と同じくらい重要な subdomain になりつつある。
   - `records` は今後 `store`、`summary`、`artifactPaths`、`triage`、`commands` にさらに切り出す余地がある。

## 6. モジュール分割レビュー

### 現状の境界

```text
src/
  extension.ts
  bazaar/
  bob/
  mcp/
  projectRules/
  records/
  ui/
  workflow/
  workspace/
```

この構成はかなり良い。特に `mcp` は `server.ts`、`jsonRpc.ts`、`tools.ts`、`bazaarTools.ts`、`projectRulesTools.ts`、`toolSchemas.ts`、`toolTypes.ts` に分かれており、外部 protocol、registry、tool implementation、schema/type の境界が読める。

### 境界が濃い箇所

- `ui/reviewGui.ts`
  - `bazaar`、`bob`、`workspace`、`projectRules`、`workflow` を横断する orchestration 層。
  - UI controller と workflow completion が同居しているため、今後もこのファイルへ import が集まりやすい。

- `projectRules/resultCaptureCore.ts`
  - domain logic と file-system artifact writer が同居。
  - `resultCapture.ts` が VS Code wrapper、`resultCaptureCore.ts` が core という分け方自体は良いが、core 内をもう一段分けたい。

- `records/reviewRecordStore.ts`
  - store という名前だが、validation、summary generation、Markdown rendering、backup allocation まで持つ。
  - 「保存」「検証」「集計」「render」の境界で再分割できる。

### 推奨分割

| 優先度 | 対象 | 提案 |
| --- | --- | --- |
| P1 | `resultCaptureCore.ts` | `jsonExtractor.ts`、`reviewResultNormalizer.ts`、`projectContractValidation.ts`、`reviewResultArtifactWriter.ts` に分割。 |
| P1 | `reviewGuiHtml.ts` | template、style、client script を分離。VSIX packaging 方針に合わせて `media/` assets 化または string module 分割。 |
| P2 | `reviewRecordStore.ts` | `reviewRecordValidation.ts`、`campaignSummary.ts`、`reviewRecordArtifacts.ts` に分割。 |
| P2 | `reviewGui.ts` | packet creation orchestration を `ui/reviewGuiActions.ts` または `bazaar/reviewPacketWorkflow.ts` に抽出。 |
| P3 | `bazaar/reviewTarget.ts` | single/range/working-tree target preparation を strategy 関数に分ける。 |

## 7. 依存パッケージ / bundle サイズ

### package dependency

runtime dependency は `js-yaml` のみで、用途は `records/reviewRecordYaml.ts` の YAML dump/load。devDependencies は `typescript`、`@vscode/vsce`、`knip`、`depcheck`、`ts-prune`、型定義群。

これは妥当。`records` 機能の YAML 利用に対して `js-yaml` は自然な選択で、重い UI framework や bundler を持ち込んでいない点は良い。

### VSIX packaging

`package.json` には次の policy がある。

- `package`: `vsce package`
- `package:policy`: `node ../../scripts/check-vsix-policy.js --max-bytes 350000`
- `artifact:policy`: `node ../../scripts/check-artifact-size-policy.js --max-bytes 12000 templates`

`.vscodeignore` は次を行っている。

- `src/**`、`*.ts`、`out/**/*.map`、test/docs などを除外。
- `node_modules/**` を除外したうえで、`!node_modules/js-yaml/**` と `!node_modules/argparse/**` を再 include。

この方針は良い。ただし、今回のレビューでは実際の `.vsix` サイズは測定していない。CI では package と VSIX policy が走るため、PR 上で実測確認すること。

### bundle size リスク

- `reviewGuiHtml.ts` は inline HTML/CSS/JS なので、UI が成長すると bundle の増加が見えづらい。
- `templates/` は artifact policy で 12KB cap があるため、テンプレート肥大は抑制される。
- production dependency は `js-yaml` と transitive `argparse` に絞られているため、node_modules 起因の VSIX 肥大リスクは低い。

## 8. 未使用コード

### 現状

未使用コード検出は script と CI に存在する。

- `unused:report`: `node ../../scripts/run-unused-checks.js`
- 実行内容:
  - `knip --production --include dependencies,devDependencies,unlisted,unresolved,exports,types`
  - `ts-prune`
  - `depcheck . --ignore-bin-package --skip-missing`

ただし `run-unused-checks.js` は tool failure / finding があっても最後に **exit 0** にする report-only design になっている。

### 評価

この設計は初期導入としては理解できるが、未使用コードの増加を止める gate ではない。`src` が 6,200 LOC に到達し、`records` と `projectRules` が拡大しているため、report-only のままだと dead export / unused type / unlisted dependency が蓄積する可能性がある。

### 推奨

1. `unused:report` は維持しつつ、別 script `unused:policy` を追加し、少なくとも `knip --production` の `dependencies,unlisted,unresolved` は fail させる。
2. `tsconfig.json` に `noUnusedLocals` と `noUnusedParameters` を追加するか、まずは `noUnusedLocals` だけ CI warning から始める。
3. `ts-prune` の false positive を allowlist 化し、public command / extension API だけ明示許可する。
4. `src/projectRules/defaults.ts` のような大きい const data は type-only unused 判定から外れやすいので、実参照テストを維持する。

## 9. 循環依存

### 現状

`architecture:policy` で `node ../../scripts/check-import-cycles.js src` が定義されており、CI でも実行される。スクリプトは TypeScript AST から import/export/require/dynamic import を収集し、相対 import graph の DFS で cycle を検出する。

### 評価

良い。少なくとも `src` 配下の相対 import に対しては、循環依存が入ると CI で検出される設計になっている。

### 注意点

- package import や VS Code extension API など外部 dependency graph は対象外。これは問題ではない。
- dynamic import の string literal は拾うが、computed import は対象外。
- `records`、`projectRules`、`workflow` が相互参照を始めると cycle 化しやすい。今後は `types` と `pure logic` の依存方向を明文化した方がよい。

推奨依存方向:

```text
extension/ui/commands/workflow
  -> bazaar/projectRules/records/workspace/bob
  -> shared pure helpers / types
```

`projectRules` と `records` は相互参照させず、必要な共通型は `records` 側に寄せるか、共通 `reviewResultTypes` を作る。

## 10. 暗黙依存

### 確認した暗黙依存

| 依存 | 現状 | リスク |
| --- | --- | --- |
| `bzr` CLI | `BZR_PATH`、VS Code setting `bobBazaar.bzrPath`、Trusted Workspace に依存。 | CLI 未導入・alias・文字コード・exit code 差異。 |
| `bzr --no-aliases` | `BazaarClient` が全コマンドに付与。 | 良い。ユーザー alias による副作用を抑制。 |
| VS Code Workspace Trust | 未信頼 workspace では workspace-level `bzrPath` を採用しない。 | 良いが、README/diagnostic で見える化したい。 |
| IBM Bob extension | extension ID `IBM.bob-code`、command `bob-code.addToContext`。 | API shape が変わると fallback。 |
| workflow-register | extension ID `local.workflow-register`、command `workflowRegister.completeStep`、provider API。 | optional integration なので graceful degradation は必要。 |
| `.bob/mcp.json` | MCP server config と allowed roots を生成。 | workspace ごとの状態差分が出る。 |
| `.bob/review/checklist.json` | project rules の契約。 | missing 時の fallback と required loading が混在。 |
| `.bob/review/results/*.json|md|metadata` | capture result の保存先。 | artifact overwrite/backup policy が重要。 |
| `.bob-review-records` | campaign/record/triage 実績管理。 | path validation と schema version 維持が必要。 |
| 環境変数 | `BOB_BAZAAR_ALLOWED_ROOTS`、`BOB_BAZAAR_ENABLE_WRITE_TOOLS`、`BOB_BAZAAR_MCP_MAX_REQUEST_BYTES`、`BZR_TEXT_ENCODING`。 | 運用時の設定漏れ・権限過多。 |

### 評価

暗黙依存は多いが、かなりテストと README policy に落とし込まれている。特に allowed roots、write tools disabled by default、workspace escape guard、trusted workspace の扱いは良い。

一方で、依存一覧が複数ファイルに散っている。`src/constants` を作る必要まではないが、README の「暗黙依存」表と実装側 const の差分を検出するテストを増やすと保守しやすい。

## 11. 型定義量 / union・mapped type

### 確認した主な union type

| file | type | 評価 |
| --- | --- | --- |
| `projectRules/types.ts` | `ReviewStatus = "pass" | "fail" | "unknown" | "not_applicable" | "blocked"` | 必要。summary と validator の中心。 |
| `projectRules/types.ts` | `ReviewSeverity = "error" | "warning" | "info"` | 必要。 |
| `projectRules/types.ts` | `ReviewConfidence = "high" | "medium" | "low"` | 必要。 |
| `ui/reviewGuiTypes.ts` | `TargetMode = "singleRevision" | "revisionRange" | "workingTreeSinceRevision"` | 必要。 |
| `bazaar/revisionInfo.ts` | `BazaarChangedFileStatus = "added" | "modified" | "removed" | "renamed" | "unknown"` | 必要。 |
| `records/reviewRecordTypes.ts` | `TriageDecision = "accepted" | "rejected" | "needs_investigation" | "deferred"` | 必要。 |
| `bob/bobContext.ts` | `AddToBobContextResult = "added" | "clipboardFallback"` | 必要。 |
| `projectRules/resultCaptureTypes.ts` | `status: "ok" | "error"` | 必要。 |

### mapped / Record type

- `Record<ReviewStatus, number>` は summary count として妥当。
- `Record<string, unknown>` は external JSON / workflow state / schema で多用されるが、境界上なので許容。
- 複雑な conditional type、deep mapped type、巨大 generic type は見当たらない。

### 気になる点

1. `mcp/jsonRpc.ts` の `JsonRpcMessage` は `params?: any`、`result?: any`、`error?: any`。
   - protocol boundary なので完全型付けは難しいが、`unknown` に寄せて handler 側で narrow する方が安全。
2. `reviewTriage.ts`、`reviewRecordCommands.ts`、`reviewResultValidationCommand.ts` などに `any` が残る。
   - JSON/YAML 境界ではやむを得ないが、validator 関数近傍に閉じ込めたい。
3. `REVIEW_RESULT_SCHEMA` は `as const` の巨大 object。TypeScript 型推論が過剰に重くなるほどではないが、今後 schema が拡大するなら `.json` asset 化も検討できる。

## 12. barrel export の集中度

### 現状

`export * from ...` は禁止方針があり、`source:policy` と `mcpSourceLayout.test.js` で確認される。実装上も中心的な `index.ts` barrel は確認していない。

`projectRules/resultCapture.ts` は次のような明示 re-export を持つ。

- `export { extractJsonFromText }`
- `export type { CaptureReviewResultResult }`

これは public command wrapper の利便性として妥当であり、barrel export 集中とは見なさない。

### 評価

良い。barrel export による依存方向の隠蔽・循環依存化・tree shaking 不能化のリスクは現状低い。

### 推奨

- `export *` 禁止 policy は維持。
- 将来 public API を作る場合は `index.ts` を許可制にし、`--allow src/publicApi.ts` のような明示 allowlist にする。

## 13. 自動テスト密度

### package script / CI

`npm test` は `npm run compile && node --test test/*.test.js`。CI では bob-bazaar-review job が `npm ci`、dependency policy、architecture policy、source policy、unused report、artifact size policy、production audit、unit tests、package、VSIX policy を順に実行する。

これはかなり良い。単なる unit test だけでなく、構造・依存・bundle policy も CI に入っている。

### 確認したテスト領域

| 領域 | 代表 test | 評価 |
| --- | --- | --- |
| dependency / package | `dependencyPolicy.test.js` | lockfile、VSIX ignore、CI steps、README 記載を確認。良い。 |
| source layout | `extensionSourceLayout.test.js`、`mcpSourceLayout.test.js` | root 薄化、domain folder、MCP split、export-star 禁止を確認。良い。 |
| MCP security | `mcpAllowedRoots.test.js`、`mcpWriteTools.test.js`、`mcpRequestLimit.test.js` | allowed roots、write tool default off、request size。良い。 |
| result capture | `resultCaptureCore.test.js` | JSON 抽出、artifact 保存、metadata、Markdown recovery。厚い。 |
| records | `reviewRecordsCore.test.js`、`reviewRecordCommands.test.js` | campaign/triage/summary/artifact backup を確認。良い。 |
| workflow | `workflowBridge.test.js`、`workflowProviderRegistration.test.js`、`workflowStepCompletion.test.js`、`workflowTemplate.test.js` | workflow-register bridge と completion 周辺。良い。 |
| UI | `reviewGuiHtml.test.js`、`reviewGuiInitialTarget.test.js` | Webview HTML と initial target。最低限。 |
| Bazaar core | `bazaarClient.test.js`、`reviewLimits.test.js`、`markdownFence.test.js`、`bzrPathTrust.test.js` | pure logic / CLI wrapper policy。良い。 |

### テスト密度評価

- `src/**/*.ts` 54ファイルに対し、確認できた `test/*.test.js` は30本以上。
- policy/architecture テストが多いため、変更時の構造劣化には強い。
- `resultCaptureCore` と `records` のような大きいファイルには、それぞれ厚いテストがある。

### 不足

1. 実 `bzr` repository を使った integration test は薄い。
2. VS Code Extension Host 上での command / webview E2E は薄い。
3. VSIX size は policy script で確認されるが、レビュー文書や metrics artifact に最新値が残っていない。
4. `unused:report` は CI で走るが fail gate ではない。

## 14. 個別 findings

### BBR-SIZE-01: `reviewGuiHtml.ts` が inline asset として肥大化している

- Severity: Medium
- 対象: `src/ui/reviewGuiHtml.ts`
- 根拠: 360 LOC。HTML、CSS、client script、initial state injection が同居。
- 影響:
  - UI 変更差分が読みにくい。
  - CSP nonce / escaping / DOM event wiring の安全性確認がしづらい。
  - 今後の項目追加で急速に肥大化する。
- 推奨:
  - `renderHtml` は skeleton だけにする。
  - style/script を別 template string module へ切り出す。
  - 可能なら VS Code webview `media/` asset として分離し、VSIX policy に含める。

### BBR-SIZE-02: `resultCaptureCore.ts` の責務が多い

- Severity: Medium
- 対象: `src/projectRules/resultCaptureCore.ts`
- 根拠: 356 LOC。抽出、正規化、契約検証、保存、backup、metadata hash が同居。
- 影響:
  - JSON 抽出変更と artifact 保存変更が同じファイルに集まり、レビュー負荷が上がる。
  - 未使用コード検出が report-only のため、helper が残りやすい。
- 推奨:
  - `reviewResultJsonExtractor.ts`
  - `reviewResultNormalizer.ts`
  - `reviewResultContract.ts`
  - `reviewResultArtifactWriter.ts`
  へ分割。

### BBR-SIZE-03: `records` subdomain が実質的な大機能になっている

- Severity: Medium
- 対象: `src/records/reviewRecordStore.ts`、`src/records/reviewRecordCommands.ts`
- 根拠: `records` 6ファイル 909 LOC、うち store 324 LOC、commands 264 LOC。
- 影響:
  - campaign summary、triage、artifact path、YAML I/O が絡むため、今後の拡張で境界が曖昧になりやすい。
- 推奨:
  - `campaignSummary.ts`
  - `reviewRecordValidation.ts`
  - `reviewRecordArtifactStore.ts`
  - `reviewRecordMarkdown.ts`
  へ段階的に分割。

### BBR-DEPS-01: 実測 VSIX サイズがレビュー時点で文書に残っていない

- Severity: Low
- 対象: package / CI metrics
- 根拠: package policy は 350KB cap を持つが、今回レビューでは actual `.vsix` size 未測定。
- 影響:
  - サイズ増加傾向をレビュー文書から追えない。
- 推奨:
  - CI の `extension-metrics` に VSIX bytes を追加する。
  - `docs/metrics/bob-workflow-metrics-ja.md` または PR comment に最新 VSIX size を残す。

### BBR-UNUSED-01: unused checks が report-only

- Severity: Medium
- 対象: `scripts/run-unused-checks.js`
- 根拠: finding / tool exit code があっても exit 0。
- 影響:
  - 未使用 export、未使用 dependency、unlisted dependency が蓄積しても merge できる。
- 推奨:
  - `unused:policy` を新設し、少なくとも dependency/unresolved/unlisted は fail させる。
  - `unused:report` は当面の詳細 report として残す。

### BBR-TYPE-01: 外部 protocol boundary の `any` がやや広い

- Severity: Low
- 対象: `src/mcp/jsonRpc.ts`、`src/records/*`、`src/projectRules/*`
- 根拠: JSON-RPC message、YAML/JSON review result、workflow state で `any` / `Record<string, unknown>` が多い。
- 影響:
  - 境界の schema validation 前に不正 shape を触る可能性。
- 推奨:
  - `any` は `unknown` に寄せ、validator/narrowing helper に閉じ込める。
  - JSON-RPC `tools/call` params 用に最小型を作る。

### BBR-IMPLICIT-01: 暗黙依存の数が多く、一覧 drift のリスクがある

- Severity: Low〜Medium
- 対象: README / constants / tests
- 根拠: Bob extension ID、workflow-register ID、command IDs、`.bob` path、env vars、settings が複数ファイルに散在。
- 影響:
  - 仕様変更時に README、tests、package contributes、実装 const のどれかが古くなる。
- 推奨:
  - 暗黙依存一覧を README に表として維持。
  - 重要 ID は test で README/implementation/package contribution の一致を確認する。
  - 可能なら env var names / command IDs を module-level constants に集約する。

## 15. 優先アクション

### すぐやる

1. `unused:policy` を追加し、CI で fail gate にする。
2. `reviewGuiHtml.ts` と `resultCaptureCore.ts` の分割計画を issue 化する。
3. CI metrics に actual VSIX bytes を出す。

### 次のリファクタでやる

1. `records/reviewRecordStore.ts` を `summary`、`validation`、`artifact` に分割。
2. `reviewGui.ts` の packet creation orchestration を別 module 化。
3. JSON/YAML/protocol boundary の `any` を `unknown` + narrow helper へ寄せる。

### 継続

1. `architecture:policy`、`source:policy`、`dependency:policy`、`package:policy` は維持。
2. `export *` 禁止方針を継続。
3. runtime dependency を増やす場合は、`.vscodeignore`、package-lock、license metadata、VSIX size を同じ PR で更新する。
4. 実 `bzr` repo integration test と VS Code extension host E2E を将来的に追加する。

## 16. 結論

`bob-bazaar-review` は、前回の大きな懸念だった MCP server 肥大・source root 直下集中・source map bundle risk がかなり改善されている。現時点では、構造 policy、dependency policy、barrel export policy、VSIX policy、allowed roots / write tools の安全境界が整っており、拡張機能としては健全な方向にある。

一方で、機能追加により `projectRules`、`records`、`ui` が次の肥大化ポイントになっている。特に `reviewGuiHtml.ts`、`resultCaptureCore.ts`、`reviewRecordStore.ts` は、次に触るタイミングで分割した方がよい。

最大の運用上の穴は未使用コード検出が report-only である点。コードベースが 6,200 LOC 規模になったため、ここは fail gate 化する価値が高い。
