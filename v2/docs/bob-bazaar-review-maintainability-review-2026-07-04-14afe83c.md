# bob-bazaar-review 拡張機能 維持性・サイズ観点レビュー

- 対象リポジトリ: `katamor1/bob_builtin_analyze`
- 対象 ref: `14afe83c2218d881a9cd7b17b68b837c53507114`
- 対象拡張: `extensions/bob-bazaar-review`
- レビュー日: 2026-07-04
- レビュー種別: GitHub 上のソース、README、`package.json`、`.vscodeignore`、代表的な実装ファイル、テスト配置に基づく静的レビュー

## 0. 前提と制約

本レビューは静的レビューであり、以下は未実行である。

- `npm install` / `npm ci`
- `npm run compile`
- `npm test`
- `vsce package --no-dependencies`
- 実 VSIX サイズ、`out/` 実サイズ、template 実サイズの測定
- `madge` / `dependency-cruiser` による循環依存の機械検出
- `knip` / `ts-prune` / `depcheck` による未使用コード・未使用依存の機械検出
- 実 Bazaar repository / Bob MCP / VS Code Extension Host 上での動作確認

そのため、コードサイズ・ファイルサイズ・bundle サイズは、取得できたファイル構成、package metadata、`.vscodeignore`、`tsconfig.json`、代表的な型定義、テストファイル一覧からの評価を中心とする。実測が必要な項目は「要実測」として明示する。

## 1. 総評

`bob-bazaar-review` は、IBM Bob 向けに Bazaar revision / range / working tree の review packet を作成し、project rules、review result capture、review result validation、MCP tools、`workflow-register` action provider 連携を提供する VS Code 拡張である。

3拡張の中では最も軽量で、`package.json` 上の runtime dependencies はなく、`vsce package --no-dependencies` を使う設計である。したがって bundle / VSIX サイズの観点ではかなり優秀である。一方、実行時には `bzr` CLI、Bazaar repository、Bob MCP、`.bob/review` の project rule ファイル、`workflow-register` の optional API に強く依存する。つまり「npm bundle は軽いが、運用上の暗黙依存は多い」タイプの拡張である。

最も大きい維持性リスクは、MCP server が 1 ファイルで多数の tools と JSON-RPC stdio protocol handling を抱え、かつ tool input の `cwd` を server 側の allowed root で縛っていない点である。次点で、root `src/` 直下に多くの機能ファイルが並びつつあり、今後レビュー GUI・MCP・project rules・workflow integration が増えると、root 直下の見通しが悪くなる可能性がある。

## 2. 主要スナップショット

| 観点 | 評価 | 所見 |
|---|---:|---|
| コードサイズ | B+ | 全体は軽め。最大級は `src/mcp/server.ts` 約319行、`src/bazaar.ts` 約183行、`src/extension.ts` 約160行。MCP server の責務集中が主な懸念。 |
| ファイルサイズ | A- | runtime npm 依存がなく、`.vscodeignore` も `node_modules/**` を除外。template と `out/**/*.map` の同梱方針は要確認。 |
| モジュール分割 | B | `projectRules/` と `mcp/` は分かれているが、root `src/` 直下に Bazaar / review / GUI / workflow / workspace 系が混在し始めている。 |
| 依存・bundle | A | `dependencies` がなく、`vsce package --no-dependencies`。bundle は小さくしやすい。外部 CLI 依存は bundle には出ない。 |
| 未使用コード | B- | `strict` は有効だが `noUnusedLocals` / `noUnusedParameters` は見えない。`knip` / `ts-prune` / `depcheck` は未確認。 |
| 循環依存 | B | 大きな循環は見えにくい構造だが、`extension.ts`、`workflowRegisterBridge.ts`、`projectRules/*`、`mcp/server.ts` の境界は監視対象。 |
| 暗黙依存 | C+ | `bzr` CLI、Bazaar repo、MCP stdio、`.bob/mcp.json`、`.bob/review`、Bob/workflow-register 連携に依存。bundle に現れない前提が多い。 |
| 型定義量 | A- | `projectRules/types.ts` は約77行で小さく、union も適切。MCP tool input/output 型は server 内に閉じており、今後分離余地あり。 |
| barrel export | A | `export *` は確認できず、barrel 集中は低い。明示的 re-export も少ない。 |
| 自動テスト密度 | B+ | 確認できた test/helper は15。Bazaar client、project rules、workflow integration、MCP version、result capture など主要点を押さえている。 |

## 3. コードサイズ

### 確認できた大きめのファイル

| ファイル | 規模 | 主な責務 |
|---|---:|---|
| `src/mcp/server.ts` | 約319行 | MCP tools 定義、JSON-RPC message handling、Bazaar/project rules tool dispatch、stdio reader。 |
| `src/bazaar.ts` | 約183行 | Bazaar CLI wrapper、`execFile` 実行、revision/path validation、encoding decode、error wrapping。 |
| `src/extension.ts` | 約160行 | command registration、workflow-register action provider 登録、MCP config、project rules command、review context bridge。 |
| `src/projectRules/io.ts` | 約136行 | `.bob/review` path 解決、checklist/schema load/init、workspace escape 防止。 |
| `src/projectRules/types.ts` | 約77行 | project rule / review result / validation result 型。 |

### 良い点

- 3拡張の中ではコード量が最も小さく、domain も Bazaar review 支援に比較的集中している。
- `BazaarClient` は `execFile` + `shell: false` で Bazaar CLI を包み、`--no-aliases` を強制している。
- `projectRules/` は checklist/schema/result capture/validation/markdown/store がまとまっており、domain 境界が比較的明確。
- `mcp/` は VS Code extension host から独立した stdio server として分離されている。
- runtime npm dependency がないため、コードを追う際に外部 package API の理解コストが少ない。

### 懸念

1. **MCP server の責務集中**
   - `src/mcp/server.ts` が tools 定義、schema helper、JSON-RPC dispatch、tool implementation、stdio framing reader をすべて持つ。
   - tools が増えると、server entry が急速に肥大化し、テストも粒度が荒くなりやすい。

2. **root `src/` 直下の混在**
   - `bazaar.ts`、`bazaarReviewCommands.ts`、`reviewGui.ts`、`reviewGuiHtml.ts`、`workflowRegisterBridge.ts`、`workspaceResolver.ts`、`reviewPacket.ts` などが root に並ぶ。
   - 現状ではまだ読めるが、GUI と workflow と CLI の関心が同階層で増えると見通しが落ちる。

3. **extension entry の拡大余地**
   - `extension.ts` は command registration と action provider registration を両方持ち、`collectReviewContext` や `loadReviewRules` の実装も含む。
   - command が増えると activation entry が肥大化しやすい。

### 推奨

- `src/mcp/server.ts` を以下に分割する。

```text
src/mcp/
  server.ts              # stdio entry / initialize / tools/list / tools/call のみ
  tools.ts               # ToolDef[] と tool dispatch
  jsonRpc.ts             # JsonRpcMessage / respond / framing reader
  schemas.ts             # objectSchema / stringProp helper
  projectRulesTools.ts   # project_rules_* implementation
  bazaarTools.ts         # bazaar_* implementation
```

- root `src/` を以下のように段階的に整理する。

```text
src/
  bazaar/
    client.ts
    reviewCommands.ts
    reviewPacket.ts
    revisionInfo.ts
    reviewTarget.ts
  projectRules/
  mcp/
  workflow/
    workflowBridge.ts
    workflowRegisterBridge.ts
    workflowStepCompletion.ts
  ui/
    reviewGui.ts
    reviewGuiHtml.ts
    reviewGuiTypes.ts
  workspace/
    workspaceResolver.ts
    workspaceRoots.ts
```

- まずは大規模移動ではなく、MCP server と `extension.ts` の command implementation 分割から始める。
- CI で最大単一ファイル行数を監視する。初期閾値例: 300行 warning、450行 fail。

## 4. ファイルサイズ

### 配布ファイル観点

`.vscodeignore` は以下を除外している。

- `src/**`
- `*.ts`
- `*.tsbuildinfo`
- `tsconfig.json`
- `node_modules/**`
- `test/**`, `tests/**`, `coverage/**`, `.tmp/**`, `tmp/**`
- `.vscode/**`, `*.vsix`, `.git/**`, `.gitignore`
- lockfiles / package manager files

`package.json` の package script は `vsce package --no-dependencies` であり、runtime npm dependency もない。そのため、配布物は主に `out/**`、templates、README/docs、package metadata になる想定である。

### 懸念

- `tsconfig.json` は `sourceMap: true` であり、`.vscodeignore` に `out/**/*.map` 除外が見えない。VSIX に source map が入る可能性がある。
- `templates/.bob/**`、project rule schema、prompt template、workflow template、skill document などが増えると、コード以外のファイルサイズが増える。
- MCP server は standalone Node script として `out/mcp/server.js` になるため、source map を含めるかどうかで size が変わる。

### 推奨

- source map を配布しない方針なら `.vscodeignore` に追加する。

```gitignore
out/**/*.map
```

- source map を配布する方針なら、VSIX size budget に source map を含める。
- `vsce ls` を CI artifact に残し、template / skill / schema がどれだけ入っているか確認する。
- template size budget を設ける。特に prompt/skill は肥大化しやすい。

## 5. モジュール分割

### 現状の構造

確認できる主な構造は以下である。

```text
src/
  extension.ts
  bazaar.ts
  bazaarReviewCommands.ts
  reviewPacket.ts
  reviewTarget.ts
  revisionInfo.ts
  reviewGui.ts
  reviewGuiHtml.ts
  reviewGuiTypes.ts
  workflowBridge.ts
  workflowRegisterBridge.ts
  workflowStepCompletion.ts
  workspaceResolver.ts
  workspaceRoots.ts
  mcp/
    server.ts
  projectRules/
    defaults.ts
    io.ts
    markdown.ts
    packet.ts
    resultCapture.ts
    resultCaptureCore.ts
    resultCaptureMarkdownRecovery.ts
    reviewResultsStore.ts
    types.ts
    validator.ts
```

### 良い点

- `projectRules/` が独立しており、project-specific checklist/schema/result validation/capture の責務がまとまっている。
- `mcp/server.ts` が VS Code extension host から分離されている。
- `BazaarClient` が `bazaar.ts` に閉じており、CLI 実行が散らばっていない。
- workflow-register 連携は `workflowRegisterBridge.ts` と `workflowBridge.ts` に寄せられている。

### 課題

- `src/` root がフラットで、GUI / workflow / Bazaar / workspace / Bob context が混在する。
- `mcp/server.ts` が internal modules に広く依存しており、tool 増加時の編集衝突が起きやすい。
- `extension.ts` は command registration と実装 helper を両方持つ。

### 推奨

1. `src/bazaar/`、`src/ui/`、`src/workflow/`、`src/workspace/` へ root module を分割する。
2. `mcp/server.ts` は entry point として薄くし、tool 実装を分ける。
3. `extension.ts` は composition root として command registration だけに寄せる。
4. dependency-cruiser で以下をルール化する。
   - `projectRules/**` は `ui/**` を import しない。
   - `mcp/**` は VS Code API を import しない。
   - `bazaar/**` は `projectRules/**` と `ui/**` を import しない。
   - `extension.ts` は下位 module から import されない。

## 6. 依存パッケージ・bundle サイズ

### package metadata 上の状態

`package.json` には `dependencies` がなく、`devDependencies` のみである。

- `@types/node`
- `@types/vscode`
- `typescript`
- `@vscode/vsce`

また、package script は `vsce package --no-dependencies` である。

### 評価

bundle/VSIX サイズの面では非常に良い。npm runtime dependency を同梱しないため、他2拡張よりも軽量に保ちやすい。`bzr` CLI、Node.js runtime、VS Code API、Bob MCP は外部環境に依存するが、VSIX 自体は小さいはずである。

### 懸念

- `package-lock.json` は対象 ref で確認できなかった。runtime dependency がないため影響は小さいが、dev toolchain の再現性には関係する。
- `--no-dependencies` は正しいが、将来 runtime dependency を追加したときに package script だけが残ると必要 dependency が VSIX に入らないリスクがある。
- bundle size には出ないが、`bzr` CLI がない環境では主要機能が動かない。

### 推奨

- devDependencies だけでも `package-lock.json` を追加し、CI は `npm ci` にする。
- `dependencies` を追加した場合は `vsce package --no-dependencies` の妥当性を必ず再確認する。
- `vsce ls` の CI snapshot で `node_modules` が入っていないことを確認する。
- `bzr --version` check command または lazy diagnostic を追加し、導入失敗を早期に検出する。

## 7. 未使用コード

### 現状評価

`tsconfig.json` は `strict: true` だが、`noUnusedLocals` と `noUnusedParameters` は確認できない。`package.json` の test script は `npm run compile && node --test test/*.test.js` で、compile と unit test は実行されるが、未使用 export / unused dependency の検出は含まれない。

`export * from` は確認できず、barrel export 経由で未使用 export が隠れるリスクは低い。runtime dependencies がないため、未使用 dependency のリスクも他拡張より低い。

### 気になる候補

- Optional integration 系の `workflowRegisterBridge.ts`、`workflowBridge.ts` は静的未使用検出で false positive になりやすい。
- MCP server tool は JSON-RPC tool name 経由で使われるため、内部関数を単純な import graph だけでは判断しにくい。
- GUI helper / review packet helper は Command Palette / workflow / Bob context から indirect に使われる。

### 推奨

- `noUnusedLocals: true`、`noUnusedParameters: true` を段階導入する。
- `knip --production` を report-only で導入する。
- `ts-prune` は MCP tool / command entry / workflow provider の false positive を baseline 管理する。
- `depcheck` は現時点では軽いが、将来 dependencies を追加した時の gate として入れておく。

## 8. 循環依存

### 現状評価

機械検出は未実行。静的に見る限り、以下のような依存方向で大きな循環は入りにくい。

```text
extension.ts
  -> bazaarReviewCommands / reviewGui / projectRules / mcpConfig / workflowRegisterBridge
mcp/server.ts
  -> bazaar / projectRules/*
projectRules/*
  -> projectRules/types / defaults / markdown / validator / store
bazaarReviewCommands
  -> bazaar / reviewPacket / reviewTarget / bobContext
```

ただし、root `src/` がフラットなため、今後 UI から projectRules、projectRules から UI、workflow から extension などの逆流が入りやすい。

### 循環が入りやすい箇所

- `extension.ts` と `workflowRegisterBridge.ts`。
- `workflowBridge.ts` と `reviewPacket.ts` / `projectRules/packet.ts`。
- `projectRules/resultCapture*` と `projectRules/validator.ts` / `markdown.ts`。
- `mcp/server.ts` と projectRules / Bazaar helper の相互依存。

### 推奨

```bash
npx madge --extensions ts --circular src
npx dependency-cruiser src --output-type err
```

ルール例:

- `src/mcp/**` は `vscode` を import しない。
- `src/bazaar/**` は `src/ui/**` と `src/workflow/**` を import しない。
- `src/projectRules/**` は `src/ui/**` を import しない。
- `src/extension.ts` は下位 module から import しない。
- `export *` を禁止する。

## 9. 暗黙依存

`bob-bazaar-review` は npm dependency が軽い代わりに、bundle に現れない暗黙依存が多い。

### 主な暗黙依存

1. **Bazaar CLI**
   - `bzrPath` 設定の default は `bzr`。
   - `BazaarClient` は `execFile` で `bzr` を呼び、`--no-aliases` を強制する。
   - `BZR_PROGRESS_BAR=none` も設定している。

2. **Bazaar repository / cwd**
   - review command と MCP tools は `cwd` を Bazaar repository root または child directory として扱う。
   - CLI の `root` / `revno` / `log` / `diff` / `cat` / `status` に依存する。

3. **Bob MCP 設定**
   - `.bob/mcp.json` に Node executable と `out/mcp/server.js` を登録する。
   - env は `BZR_PATH` と `BZR_TEXT_ENCODING` を渡す。
   - allowed workspace root は env に渡していない。

4. **`.bob/review` project rules**
   - checklist と review-result schema は `.bob/review/checklist.json` と `.bob/review/review-result.schema.json` が基本。
   - 外部 path は `BOB_BAZAAR_ALLOW_EXTERNAL_REVIEW_RULES=1` で opt-in する設計。

5. **workflow-register optional integration**
   - `local.workflow-register` がある場合、action provider として `bobBazaar.*` を登録する。
   - 未導入時には optional に落ちる想定。

6. **Bob review packet document**
   - `collectReviewContext` は開いている document から marker 文字列で review packet を探す。
   - 複数 packet が開いていると意図しない packet を拾うリスクがある。

### 推奨

- `configureWorkspaceMcpServer` で `BOB_BAZAAR_ALLOWED_ROOTS` または `BOB_BAZAAR_WORKSPACE_ROOT` を env に入れる。
- MCP server 側で `cwd` を realpath し、allowed root 配下かを検証する。
- `project_rules_init` も allowed root 配下だけで実行する。
- `collectReviewContext` は active packet URI / generated packet path / runId を state に保持し、単純な marker 検索から脱却する。
- README に `bzr` CLI、MCP refresh/restart、trusted workspace、`.bob/review` 生成物の説明を追加する。

## 10. union / mapped type など型定義の量やサイズ

### 現状

`projectRules/types.ts` は約77行で、型定義はコンパクトで読みやすい。

主な union:

- `ReviewStatus = "pass" | "fail" | "unknown" | "not_applicable" | "blocked"`
- `ReviewSeverity = "error" | "warning" | "info"`
- `ReviewConfidence = "high" | "medium" | "low"`

`ReviewResult.summary` は `Record<ReviewStatus, number>` を使っており、mapped type 的な表現は適切である。

### 良い点

- project rule domain に閉じた型で、読みやすい。
- `ChecklistResult` / `ReviewFinding` / `ReviewResult` が素直に分かれている。
- union は status/severity/confidence のような閉じた値に使われており妥当。
- mapped type の過度な濫用はない。

### 懸念

- `ReviewResult.vcs.type` が `"bazaar" | string` で、拡張性はあるが exhaustiveness check は効きにくい。
- MCP tool input/output の型は `server.ts` 内の `any` / `Record<string, unknown>` / inline schema helper に寄っており、型安全性より実装簡易性が優先されている。
- `JsonRpcMessage.params?: any`、`ToolDef.inputSchema: Record<string, unknown>` は MCP server が大きくなるほど弱い境界になる。

### 推奨

- `ReviewResult.vcs.type` は `"bazaar" | (string & {})` のように意図を示すか、`knownType` / `rawType` を分ける。
- MCP tool ごとの input/output 型を `src/mcp/types.ts` に切り出す。
- `any` を `unknown` + runtime validation に寄せる。
- MCP schema と TypeScript 型の対応をテストする。

## 11. barrel export の集中度

### 現状評価

`export * from` は確認できず、barrel export の集中度は低い。これは良い状態である。

明示的 re-export も目立たず、`workflow-register` や `bob-code-consistency-review` と比べても依存経路が追いやすい。

### 推奨

- 今後も `export *` は禁止する。
- public API 用の `index.ts` を作る場合も explicit export に限定する。
- `mcp/tools.ts` などを作る場合、tool implementation をまとめすぎて巨大 barrel にしない。

## 12. 自動テスト密度

### 確認できたテスト

確認できた test/helper は15である。

- `bobContext.test.js`
- `bazaarClient.test.js`
- `helpers/sourceReader.js`
- `workflowBridge.test.js`
- `projectRulesPath.test.js`
- `bazaarReviewCommandWiring.test.js`
- `workflowProviderRegistration.test.js`
- `mcpServerVersion.test.js`
- `reviewGuiInitialTarget.test.js`
- `reviewResultsStore.test.js`
- `workflowStepCompletion.test.js`
- `resultCaptureCore.test.js`
- `integrationSandboxScript.test.js`
- `workflowTemplate.test.js`
- `workspaceRoots.test.js`

`package.json` の test script は `npm run compile && node --test test/*.test.js` で、compile と unit test を一体で走らせる設計である。

### 良い点

- Bazaar client の validation / command wiring をテストしている。
- project rules path と result capture core をテストしている。
- workflow-register provider registration のテストがある。
- MCP server version のテストがあり、MCP server artifact への意識がある。
- workspace roots と workflow template のテストがある。

### 足りないテスト / gate

- MCP allowed root 外 `cwd` の拒否。
- `project_rules_init` が allowed root 外を拒否すること。
- `BZR_MAX_BUFFER` の異常値 clamp。
- `bobBazaar.maxDiffBytes` / `maxAddedFileContentBytes` の runtime clamp。
- 複数 review packet が開いている場合の選択。
- `vsce package --no-dependencies` の contents check。
- `madge --circular`。
- `knip` / `ts-prune` / `depcheck`。

### 推奨テスト追加

- `mcpAllowedRoots.test.js`
- `configBounds.test.js`
- `reviewPacketSelection.test.js`
- `vsixContents.test.js` または CI script
- `dependencyGraph` は test ではなく CI job として `madge`

## 13. 優先度付き改善バックログ

### High

1. MCP server に allowed workspace root 検証を追加する。
2. `mcp/server.ts` を `tools.ts` / `jsonRpc.ts` / `bazaarTools.ts` / `projectRulesTools.ts` に分割する。
3. `bobBazaar.maxDiffBytes` / `maxAddedFileContentBytes` / `BZR_MAX_BUFFER` を runtime clamp する。
4. `vsce ls` と VSIX サイズ budget を CI に追加する。
5. `madge --circular` を CI に追加する。

### Medium

1. root `src/` 直下を `bazaar/`、`ui/`、`workflow/`、`workspace/` に整理する。
2. `extension.ts` を command registration のみに寄せる。
3. `collectReviewContext` を marker search から packet URI/state ベースに変える。
4. `knip` / `ts-prune` / `depcheck` を report-only で導入する。
5. `package-lock.json` を追加し、CI を `npm ci` に揃える。

### Low

1. MCP tool input/output 型を分離する。
2. README に `bzr` CLI、MCP allowed root、trusted workspace、`.bob/review` 生成物を明記する。
3. template / prompt / schema size budget を作る。
4. `export *` 禁止 rule を導入する。

## 14. 実測用コマンド

対象 ref を checkout できるローカル環境で、以下を実行すると本レビューの「要実測」部分を埋められる。

```bash
git checkout 14afe83c2218d881a9cd7b17b68b837c53507114
cd extensions/bob-bazaar-review

# install / build / test
npm install
npm run compile
npm test

# code size
find src test templates docs -type f \
  \( -name '*.ts' -o -name '*.js' -o -name '*.json' -o -name '*.md' \) \
  -print0 | xargs -0 wc -l | sort -n

# package contents / bundle size
npx vsce package --no-dependencies
npx vsce ls > vsce-files.txt
du -sh out templates *.vsix 2>/dev/null || true

# dependency graph
npx madge --extensions ts --circular src

# unused code/deps
npx knip --production || true
npx depcheck || true
```

## 15. 結論

`bob-bazaar-review` は、3拡張の中で最も軽量で、runtime npm dependency がなく、VSIX/bundle サイズを小さく保ちやすい。`BazaarClient` の `execFile` + `shell: false` + `--no-aliases` 強制、project rules path の workspace escape 防止、result validation 型のコンパクトさも評価できる。

ただし、軽量さの裏側で `bzr` CLI、MCP stdio server、Bob/workflow-register 連携、`.bob/review` 生成物、review packet document 選択という暗黙依存が多い。特に MCP server は allowed root を server 側で持たず、tool input の `cwd` に強く依存しているため、運用安全性と保守性の両面で最初に締めるべきである。

短期では MCP allowed root、MCP server 分割、runtime config clamp、VSIX contents check、循環依存 CI を入れる。中期では root `src/` の domain 別整理と `collectReviewContext` の state 化を進めると、軽量さを保ったまま安全に拡張しやすくなる。
