# workflow-register 拡張機能 維持性・サイズ観点レビュー

- 対象リポジトリ: `katamor1/bob_builtin_analyze`
- 対象 ref: `14afe83c2218d881a9cd7b17b68b837c53507114`
- 対象拡張: `extensions/workflow-register`
- レビュー日: 2026-07-04
- レビュー種別: GitHub 上のソース、設定、package metadata、README、代表的な実装ファイル、テストファイル一覧に基づく静的レビュー

## 0. 前提と制約

本レビューは静的レビューであり、以下は未実行である。

- `npm install` / `npm ci`
- `npm run compile`
- `npm test`
- `vsce package`
- 実 VSIX サイズ、`node_modules` 実ディスクサイズ、`out/` 実サイズの測定
- `madge` / `dependency-cruiser` による循環依存の機械検出
- `knip` / `ts-prune` / `depcheck` による未使用コード・未使用依存の機械検出

そのため、コードサイズ・ファイルサイズ・bundle サイズは、取得できたファイル内容と package metadata からの評価を中心にし、実測が必要な項目は明示的に「要実測」として扱う。

## 1. 総評

`workflow-register` は、`.bob/workflows/*/WORKFLOW.md` を Bob workflow として読み込み、検証、登録、実行、再開、診断、AI 補助、GUI Builder を提供する基盤拡張である。機能範囲はかなり広いが、`core`、`commands`、`webview`、adapter/registration 系に分割されており、全体としてはよく整理されている。

最も大きい維持性リスクは、`src/core/model.ts` が workflow schema、runtime state、provider API、result sink API まで抱える中心型になっている点である。次点で、`WorkflowEngine` / `BobWorkflowEngineRunner` / `WorkflowRegisterService` が orchestration と state mutation を多く持つため、今後の機能追加で単一ファイル肥大化と循環依存が入りやすい。

一方、依存パッケージは `ajv` と `js-yaml` に限られ、bundle サイズの素性は良い。テストファイルも非常に多く、3拡張横断で見ても `workflow-register` は最も自動テスト密度が高い。barrel export の集中も低く、現時点では依存を隠す巨大 index は見当たらない。

## 2. 主要スナップショット

| 観点 | 評価 | 所見 |
|---|---:|---|
| コードサイズ | B | 機能範囲に対して分割は進んでいるが、`engine.ts`、`bobWorkflowRunner.ts`、`workflowRegisterService.ts`、`model.ts` が中心化しやすい。 |
| ファイルサイズ | B | `.vscodeignore` は `src/**`、`test/**`、不要 node_modules を除外しているが、`sourceMap: true` かつ `out/**/*.map` 除外が見えない。 |
| モジュール分割 | B+ | `core` / `commands` / `webview` / adapter は良い。`core/model.ts` と runner/service の責務分割余地が大きい。 |
| 依存・bundle | A- | runtime 依存は `ajv`, `js-yaml` のみ。lockfile が見当たらない点と source map 方針が課題。 |
| 未使用コード | B- | compiler 設定に `noUnusedLocals` / `noUnusedParameters` が見えず、`knip` 等も見えない。 |
| 循環依存 | B | 構造上は抑制されているが、engine facade と submodule 間、Bob runner と core 間は監視対象。機械検出は要追加。 |
| 暗黙依存 | C+ | VS Code API、IBM Bob API、Bob task API、`.bob/workflows`、`.bob/workflows/runs`、任意 VS Code command、workspace trust 前提が多い。 |
| 型定義量 | B- | discriminated union は適切だが、中心型 `model.ts` に集まりすぎ。schema TS と schema JSON の二重管理もある。 |
| barrel export | A- | `export *` は見当たらず、明示的 re-export が少数。`core/parser.ts` と `core/parser/index.ts` の二重 shim は整理余地。 |
| 自動テスト密度 | A | 確認できた test/helper は約40。parser/engine/runtime/authoring/webview 周辺まで広くある。サイズ・循環・未使用検出は未整備。 |

## 3. コードサイズ

### 良い点

- README 上も、`src/extension.ts`、`src/extensionWithAuthoring.ts`、`src/bobApi.ts`、`src/bobWorkflowRunner.ts`、`src/bobWorkflowFactory.ts`、`src/bobWorkflowMessages.ts`、`src/bobTaskInputs.ts`、`src/taskSnapshotRecovery.ts`、`src/resultHandoff.ts` など、主要ファイルの責務が説明されている。
- `WorkflowRegisterService` は VS Code command registration、watcher、workflow reload、run/resume/retry の入口をまとめる composition layer として機能している。
- `core/engine/*` に step executor、run state、preflight、pause、manual completion、result writer が分割されている。
- parser は `parseWorkflowMarkdown` -> `parseV1Workflow` / `parseLegacyWorkflow` に分岐し、YAML front matter 解析、schema validation、normalization が分割されている。

### 懸念

1. **中心ファイルの肥大化**
   - `src/core/model.ts` は workflow schema version、step type、run status、guardrails、artifact、completion、engine step、agent provider、action input/result、result sink、run step attempt、workflow run state まで持つ。
   - `CoreWorkflowDefinition` は file schema と runtime metadata の両方を含む。`filePath`、`workflowRoot`、`workflowFile`、`workflowFolderName`、`definitionHash` など runtime/loader 由来の情報も混在している。

2. **orchestrator が大きくなりやすい**
   - `WorkflowEngine` は run creation/recovery、preflight、pause、step loop、retry、manual completion、review gate、artifact write、hook emit を扱う。
   - `BobWorkflowEngineRunner` は Bob task、subagent、snapshot、message sending、manual hold、recovery をつなぐ adapter で、境界が太い。
   - `WorkflowRegisterService` は file watcher、registry、command entry、run selection、runtime factory、workflow registration を持つ。

3. **GUI Builder 系の拡大余地**
   - `webview` と authoring model/serializer/loader が既に存在し、GUI の追加機能は JS 生成物とテストを増やす。
   - UI script が拡大すると VSIX の `out/webview` と source map が増えやすい。

### 推奨

- `model.ts` を `schemaTypes.ts`、`runtimeTypes.ts`、`providerApiTypes.ts`、`resultSinkTypes.ts` に分割する。
- `CoreWorkflowDefinition` は `ParsedWorkflowDefinition` と `LoadedWorkflowDefinition` に分け、workspace path や definition hash を後段で付加する。
- `WorkflowEngine` の step loop は現状維持でもよいが、run creation/recovery、preflight、step transition、review gate をさらに helper に切り出し、engine facade は orchestration だけにする。
- `BobWorkflowEngineRunner` は Bob task API adapter、snapshot adapter、subagent adapter を分ける。
- CI で最大単一ファイル行数を監視する。初期閾値例: 350行 warning、500行 fail。

## 4. ファイルサイズ

### 確認できた事実

- `tsconfig.json` は `sourceMap: true` である。
- `.vscodeignore` は `src/**`、`*.ts`、`*.tsbuildinfo`、`tsconfig.json`、`test/**`、`tests/**`、`coverage/**` を除外している。
- `.vscodeignore` は `node_modules/**` をいったん除外し、`ajv`、`fast-deep-equal`、`fast-uri`、`json-schema-traverse`、`require-from-string`、`js-yaml`、`argparse` を whitelist している。
- `out/**/*.map` の除外は確認できない。
- `package-lock.json` は対象 ref では見つからなかった。

### 評価

VSIX には `src/**` と `test/**` が入らない想定なので、ソースファイル自体の大きさは配布サイズに直接効きにくい。一方で `sourceMap: true` のため、compiled JS と `.map` が同梱される場合、GUI Builder や engine 周辺の増加が VSIX に反映される。

runtime dependency の whitelist は良い設計だが、lockfile がないため install 時点の semver 解決で VSIX 内容が揺れる。

### 推奨

- 配布 VSIX で source map が不要なら `.vscodeignore` に `out/**/*.map` を追加する。
- source map を含める場合は、VSIX budget に明示する。
- `npm ci` 運用のため `package-lock.json` を追加する。
- `vsce ls` を CI artifact に残し、`src/**`、`test/**`、`*.ts`、`out/**/*.map` の有無をチェックする。

## 5. モジュール分割

### 現状の分割

大きく見ると、以下の層に分けられている。

- VS Code entry: `extension.ts`, `extensionWithAuthoring.ts`
- registration/service: `workflowRegisterService.ts`, `workflowRegistrationService.ts`, `workflowDefinitionLoader.ts`, `workflowDiscovery.ts`
- Bob adapter: `bobApi.ts`, `bobWorkflowRunner.ts`, `bobWorkflowFactory.ts`, `bobWorkflowMessages.ts`, `bobTaskInputs.ts`, `bobStepRuntime.ts`
- core runtime: `core/engine.ts`, `core/engine/*`, `core/runStateStore.ts`, `core/runControlStore.ts`, `core/resultSinkRegistry.ts`
- parser/schema/validator: `core/parser/*`, `core/workflowSchema.ts`, `core/workflowValidator.ts`
- authoring: `core/workflowAuthoring*`, `webview/*`, `commands/*`

この分割は全体として良い。特に `core/README.md` で parser -> CoreWorkflowDefinition -> WorkflowAuthoringModel -> serializer の流れが説明されている点は、保守性に効いている。

### 分割上の課題

- `core` が「純粋 runtime」「schema/parser」「GUI authoring」「AI provider」「snapshot/store」まで含んでおり、いずれ過密になる。
- `core/parser.ts` と `core/parser/index.ts` がどちらも `parseWorkflowMarkdown` を re-export している。互換 shim としては軽いが、import 経路が増える。
- `extensionWithAuthoring.ts` は command registration が多く、command が増えるほど entry が肥大化する。

### 推奨ディレクトリ案

```text
src/
  extension.ts
  extensionWithAuthoring.ts
  service/
    workflowRegisterService.ts
    workflowRegistrationService.ts
    workflowDefinitionLoader.ts
    workflowDiscovery.ts
  bob/
    bobApi.ts
    bobWorkflowRunner.ts
    bobWorkflowFactory.ts
    bobWorkflowMessages.ts
    bobTaskInputs.ts
    bobStepRuntime.ts
  core/
    engine/
    schema/
    parser/
    runtime/
    resultSinks/
    snapshots/
  authoring/
    model.ts
    loader.ts
    serializer.ts
    defaults.ts
    repair.ts
  commands/
  webview/
```

短期では大移動せず、まず `model.ts` と `core` の意味を分割するだけで十分効果がある。

## 6. 依存パッケージ・bundle サイズ

### runtime dependencies

- `ajv`: workflow v1 schema validation に使用。
- `js-yaml`: `WORKFLOW.md` front matter の YAML parse / authoring serializer 周辺で使用。

この2つは機能に対して妥当であり、依存は軽い部類である。`bob-code-consistency-review` のような重い document parser 依存はない。

### dev dependencies

- `@types/js-yaml`
- `@types/node`
- `@types/vscode`
- `typescript`
- `@vscode/vsce`

標準的で妥当。

### bundle/VSIX 観点

`.vscodeignore` の whitelist 方針により、runtime に必要な `ajv` / `js-yaml` と transitive だけを同梱する意図がある。これは良い。問題は次の3点。

1. lockfile 不在により dependency resolution が揺れる。
2. `sourceMap: true` により `out/**/*.map` が含まれる可能性がある。
3. `vsce package` は script としてあるが、サイズ上限・含有ファイル検査が見えない。

### 推奨 CI

```bash
cd extensions/workflow-register
npm ci
npm run compile
npm test
npx vsce package --no-yarn
npx vsce ls > vsce-files.txt
```

追加 gate:

- VSIX サイズ上限: 例 2MB warning、5MB fail から開始。
- 禁止ファイル: `src/**`, `test/**`, `*.ts`, `*.tsbuildinfo`。
- 方針次第で `out/**/*.map` を禁止。
- `node_modules` に whitelist 外 package が含まれないこと。

## 7. 未使用コード

### 現状評価

`tsconfig.json` は `strict: true` だが、`noUnusedLocals` と `noUnusedParameters` は確認できない。`npm test` は `npm run compile && node --test test/*.test.js` であり、compile とテストは走るが、未使用 export や未使用依存の検出までは行わない。

検索上、`export *` は見当たらず、barrel 経由で大量に未使用 export が隠れるリスクは低い。ただし public API と他拡張連携を持つため、`knip` / `ts-prune` 導入時には false positive の baseline が必要になる。

### 気になる箇所

- `src/type-fixes.d.ts` が global `Object` に `title: string` を追加している。これは全 object に `title` があるかのように見せるため、型安全性を下げる。未使用コードというより「型エラー抑制の暗黙依存」であり、早めに撤去・局所型化したい。
- `core/parser.ts` と `core/parser/index.ts` の二重 shim は小さいが、片方だけに寄せたい。
- `bobWorkflowRunner.ts` は re-export と import が近接しており、公開 API 境界と実装の混在がある。

### 推奨

- `noUnusedLocals: true` と `noUnusedParameters: true` を段階導入する。最初は warning/report-only でもよい。
- `knip --production` を report-only で導入する。
- `ts-prune` で unused export を確認する。
- `depcheck` で package dependency と実 import の差異を確認する。
- `type-fixes.d.ts` は局所 interface で置き換える。

## 8. 循環依存

### 現状評価

機械検出は未実行。静的に見る限り、依存方向は概ね以下のように保たれている。

```text
extension / commands
  -> service / registration / runtime factory
    -> bob adapter
    -> core engine / parser / stores
      -> core model / helpers
```

`core/engine.ts` は facade として `core/engine/*` を import している。`core/engine/*` 側が facade を import しない限り循環は起きにくい。現時点で `stepExecutor.ts` は `engineTypes` と `model` を import しており、`engine.ts` そのものへの依存は見えないため、構造は悪くない。

### 循環が入りやすい箇所

- `core/engine.ts` と `core/engineTypes.ts` と `core/engine/*` の三角関係。
- `bobWorkflowRunner.ts` と `core/engine.ts` と snapshot/result handoff 周辺。
- `commands/*` が service や core helper を直接使い始めると、UI -> core の一方向が崩れる可能性。
- authoring loader/serializer/validator が parser/schema を再利用しているため、GUI から parser への依存はよいが、parser から GUI model を参照し始めると循環化する。

### 推奨

```bash
npx madge --extensions ts --circular src
npx dependency-cruiser src --output-type err
```

dependency-cruiser ルール例:

- `src/core/**` は `src/commands/**` と `src/webview/**` を import しない。
- `src/core/parser/**` は `src/core/workflowAuthoring*` を import しない。
- `src/core/engine/**` は `src/core/engine.ts` を import しない。
- `src/extension*.ts` は composition root とし、下位 module から import しない。
- `src/type-fixes.d.ts` のような global patch を禁止する。

## 9. 暗黙依存

`workflow-register` は基盤拡張なので、bundle や package metadata だけでは見えない暗黙依存が多い。

### 主な暗黙依存

1. **IBM Bob API**
   - README では IBM Bob 拡張 `IBM.bob-code` が前提とされる。
   - 実装は `loadBobApi("IBM.bob-code")` し、`registerSource` / `registerWorkflow` に依存する。

2. **Bob task API**
   - `BobWorkflowEngineRunner` は `task.startSubagent`、`task.sendMessage`、`task.setStepComplete`、`task.getMessages`、`task.getAllMetadata`、`task.toSerializable` などの optional API に依存する。
   - optional なので壊れにくいが、期待する shape がドキュメント化されていないと保守者が追いにくい。

3. **VS Code command 実行**
   - default action provider は `vscode.executeCommand` を provider として公開し、args の先頭を実 command ID として実行する。
   - guardrails は provider ID を見るため、`vscode.executeCommand` を許すと実 command ID の制御が粗くなりやすい。

4. **ファイル配置規約**
   - workflow discovery は `.bob/workflows/*/WORKFLOW.md` を前提にしている。
   - run state と task snapshot は `.bob/workflows/runs/<runId>` 配下を使う。

5. **他拡張との result sink 連携**
   - command result sink の default allowlist は `bobBazaar.captureReviewResult` であり、`bob-bazaar-review` との連携前提が入っている。

6. **Workspace Trust 前提**
   - workflow は workspace 内の Markdown/YAML で command、file write、Bob task 連携を定義できる。実質的に trusted workspace 前提である。

### 推奨

- README に「trusted workspace 前提」を明記する。
- Workspace Trust API に対応し、untrusted workspace では workflow 実行・command step・result sink を disable する。
- `vscode.executeCommand` は provider allowlist だけでなく、実 command ID allowlist/denylist を持つ。
- Bob task API の期待 shape を `bobWorkflowTypes.ts` または docs に明記する。
- `.bob/workflows/runs` と snapshot の機密情報リスクを README に書く。

## 10. union / mapped type など型定義の量やサイズ

### 良い点

- `WorkflowStepType`、`RunStatus`、`StepRunStatus`、`WorkflowStepExecutionMode`、`WorkflowFailurePolicy` など、状態や選択肢は string union で明確に表現されている。
- `EngineStep` は `CommandEngineStep | AgentEngineStep | ManualEngineStep | ResultEngineStep` の discriminated union で、step type ごとの required field を表現できている。
- `ResultSourceDefinition` と `ResultSinkDefinition` も discriminated union で、`source` / `type` ごとの分岐が分かりやすい。
- mapped type の過度な濫用は見えず、型の読みやすさは保たれている。

### 懸念

- `model.ts` に union と interface が集中し、schema model、runtime model、provider API、sink API が一枚岩になっている。
- `workflowAuthoringModel.ts` は `model.ts` の型を多く再利用しているため、runtime 型の変更が GUI authoring に伝播しやすい。
- `workflowV1Schema` の TS object と `schema/workflow-register.v1.schema.json` の JSON schema が二重管理になっている。将来的に drift しやすい。
- `type-fixes.d.ts` の global `Object` 拡張は型安全性を大きく下げる。

### 推奨

- `schemaTypes.ts`: `WorkflowInputDefinition`, `WorkflowRequiresDefinition`, `WorkflowGuardrailsDefinition`, `WorkflowArtifactDefinition`, `WorkflowCompletionDefinition` など。
- `engineStepTypes.ts`: `EngineStep`, `CommandEngineStep`, `AgentEngineStep`, `ManualEngineStep`, `ResultEngineStep`。
- `runStateTypes.ts`: `RunStatus`, `StepRunStatus`, `RunStepAttempt`, `RunStepState`, `WorkflowRunState`。
- `providerTypes.ts`: `AgentProvider`, `ActionExecutionInput`, `ActionExecutionResult`, `ResultSinkWriteInput`, `ResultSinkWriteResult`。
- schema は TS object から JSON を生成するか、JSON schema を source of truth にして TS 側に import/generate する。
- global type patch を撤去する。

## 11. barrel export の集中度

### 現状評価

`export * from` は確認できず、barrel export の集中度は低い。これは非常に良い。巨大 barrel がないため、依存が暗黙化しにくく、tree shaking 以前に人間が追いやすい。

確認できた re-export は小規模である。

- `src/core/parser.ts`: `parseWorkflowMarkdown` の明示 re-export。
- `src/core/parser/index.ts`: 同じく `parseWorkflowMarkdown` の明示 re-export。
- `src/bobWorkflowRunner.ts`: `createBobWorkflow`、`extractTaskWorkflowInputs`、`StepRuntime`、`recoverResultTextFromSnapshots` の re-export。
- `src/extensionWithAuthoring.ts`: `deactivate` の re-export。

### 懸念

- `core/parser.ts` と `core/parser/index.ts` が二重の入口になっており、import 経路が割れる。
- `bobWorkflowRunner.ts` は実装クラスと re-export が同居している。公開 API と実装 module の境界が少し曖昧になる。

### 推奨

- parser の public import path を1つに決める。例: `core/parser` に寄せ、`core/parser/index.ts` は撤去または逆に統一。
- re-export は public API 境界だけに限定する。
- `export *` を禁止する lint/dependency rule を入れる。

## 12. 自動テスト密度

### 現状評価

テスト密度は高い。確認できた test/helper は約40あり、以下の領域を広くカバーしている。

- action registry
- agent step
- Bob workflow factory/messages
- command workflow AI provider
- input collector/resolver
- registration wiring
- result handoff
- result sink registry
- runtime wiring
- task snapshots
- workflow authoring / serializer / loader / reference analysis / advanced sections
- workflow builder webview modules / step draft script
- workflow definition loader
- workflow engine core / command agent / review steps / single step / preflight defaults
- workflow parser v1
- workflow replacement preview
- workflow run recovery
- workflow samples

`package.json` の test script は `npm run compile && node --test test/*.test.js` で、compile と unit test を一体で走らせる設計になっている。これは良い。

### 足りないテスト・CI

- `madge` による循環依存検査。
- `knip` / `ts-prune` による未使用 export/import 検査。
- `depcheck` による unused dependency 検査。
- `vsce package` のサイズ budget。
- `vsce ls` による同梱ファイル snapshot。
- `out/**/*.map` が入る/入らない方針の検査。
- `type-fixes.d.ts` のような global augmentation 禁止検査。
- `vscode.executeCommand` の実 command ID allowlist/denylist regression test。

### 推奨テスト追加

```bash
npx madge --extensions ts --circular src
npx knip --production
npx depcheck
npx vsce package --no-yarn
npx vsce ls
```

最初は report-only にして baseline を作り、その後 fail gate 化する。

## 13. 優先度付き改善バックログ

### High

1. `src/core/model.ts` を schema/runtime/provider/sink に分割する方針を決める。
2. `out/**/*.map` を VSIX に含めるかどうかを決め、`.vscodeignore` または package tsconfig に反映する。
3. `madge --circular` を CI に追加する。
4. `vscode.executeCommand` の guardrail を provider ID ではなく実 command ID まで見る形に強化する。
5. `type-fixes.d.ts` の global `Object.title` を撤去する。

### Medium

1. `package-lock.json` を追加し、CI を `npm ci` に揃える。
2. `knip` / `ts-prune` / `depcheck` を report-only で導入する。
3. `WorkflowRegisterService` と `BobWorkflowEngineRunner` の責務を adapter/service/helper にさらに分ける。
4. `core/parser.ts` と `core/parser/index.ts` の二重 re-export を整理する。
5. `vsce ls` snapshot と VSIX budget を CI に追加する。

### Low

1. `core` 配下を `schema`、`runtime`、`engine`、`authoring`、`snapshots` に段階分割する。
2. README に trusted workspace、生成物、snapshot privacy、implicit dependencies の節を追加する。
3. 最大ファイル行数、test/source ratio、dependency count を PR コメントに出す。
4. schema TS object と schema JSON の drift 検出を追加する。

## 14. 実測用コマンド

対象 ref を checkout できるローカル環境で、以下を実行すると本レビューの「要実測」部分を埋められる。

```bash
git checkout 14afe83c2218d881a9cd7b17b68b837c53507114
cd extensions/workflow-register

# install / build / test
npm ci
npm run compile
npm test

# code size
find src test schema -type f \
  \( -name '*.ts' -o -name '*.js' -o -name '*.json' -o -name '*.md' \) \
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
```

## 15. 結論

`workflow-register` は、基盤拡張としての複雑さに対してモジュール分割とテスト密度がかなり良い。runtime dependency も軽く、VSIX を小さく保ちやすい設計である。

ただし、中心型 `model.ts`、engine/runner/service の orchestration、Bob/VS Code/task snapshot まわりの暗黙依存は、今後の機能追加で急速に重くなる。まずは `model.ts` 分割、循環依存 CI、VSIX contents/budget CI、source map 方針決定、global type patch 撤去を優先するとよい。

現時点の評価は「よく整理された大きめの基盤拡張。ただし型と暗黙依存の境界を今のうちに固めるべき」である。
