# workflow-register 拡張機能 サイズ・依存・構造レビュー

- 対象リポジトリ: `katamor1/bob_builtin_analyze`
- 対象 ref: `350010e766d99ad19a0bba5bf11e2cbd0ee04e62`
- 対象拡張: `extensions/workflow-register`
- レビュー日: 2026-07-05
- レビュー種別: GitHub 上の source / config / package metadata / CI / 代表的実装ファイルに基づく静的レビュー
- 観点: コードサイズ、ファイルサイズ、モジュール分割、依存パッケージ・bundle サイズ、未使用コード、循環依存、暗黙依存、型定義量、barrel export、自動テスト密度

## 0. 前提と制約

本レビューでは、対象 ref の GitHub 上のファイルを静的に確認した。以下はこの場では未実行である。

- `npm ci`
- `npm run compile`
- `npm test`
- `npm run package`
- `npm run package:policy`
- 実 VSIX の生成・展開・実サイズ計測
- 実 Node 環境での `knip` / `ts-prune` / `depcheck` の出力確認

ただし、対象 ref では CI と package scripts に、依存再現性、循環依存、barrel export、未使用コード report、production audit、VSIX policy が追加されているため、それらの設計内容もレビュー対象に含める。

前回レビュー `docs/workflow-register-maintainability-review-2026-07-04-14afe83c.md` から見ると、主要な改善が入っている。特に、`package-lock.json` の追加、`out/**/*.map` の VSIX 除外、VSIX size policy、循環依存 policy、export-star policy、unused report、global `Object` augmentation 禁止、README の保守・配布ポリシー追加は、前回の High / Medium 指摘をかなり潰している。

## 1. 総評

`workflow-register` は、もはや単なる `.bob/workflows/*/WORKFLOW.md` の登録拡張ではなく、workflow authoring、standalone runtime、Bob UI adapter、manual step webview、run recovery、diagnostics、AI assisted design / repair、process command、template customization studio を含む基盤拡張になっている。

現時点の状態は、次のように評価できる。

- **配布サイズ・依存管理はかなり良い。** runtime dependency は `ajv` と `js-yaml` の2つに抑えられ、`.vscodeignore` と VSIX policy で source、test、source map、lockfile、不要な node_modules を除外している。
- **前回最大懸念だった `src/core/model.ts` の中心型肥大化は大きく改善済み。** 現在は `modelSchema.ts`、`modelRuntime.ts`、`modelProviders.ts`、`modelSinks.ts` へ分割され、`model.ts` は互換用 barrel に近い。
- **自動テスト・品質ゲートは強い。** `npm test` だけでなく、CI で dependency policy、architecture policy、source policy、schema policy、unused report、audit、package policy が走る。
- **残る最大リスクは「機能スコープ拡大」と「composition root / runtime orchestrator の肥大化」。** `WorkflowEngine`、`WorkflowRunCommandService`、`extensionWithAuthoring.ts`、`TemplateCustomizationStudioPanel` は、現時点では理解可能だが、追加機能を吸収し続けると再び巨大 module 化しやすい。

## 2. スコアカード

| 観点 | 評価 | 所見 |
|---|---:|---|
| コードサイズ | B | 単一ファイル 500 行超は確認範囲では見えないが、`src/core/engine.ts` が 495 行、`src/workflowRunCommands.ts` が 383 行まで伸びている。 |
| ファイルサイズ | A- | source、test、source map、lockfile は VSIX から除外。VSIX 1.2MB policy もある。実 VSIX の継続的な size history はまだ薄い。 |
| モジュール分割 | B+ | core model 分割は良い。runtime / command / webview / process / template の境界は見えているが、feature scope が広がりつつある。 |
| 依存パッケージ・bundle サイズ | A- | runtime dependency は `ajv` / `js-yaml` のみ。dev dependency と lockfile は大きいが配布対象外。 |
| 未使用コード | B | `knip` / `ts-prune` / `depcheck` の report-only gate がある。fail gate ではなく、`noUnusedLocals` / `noUnusedParameters` も未設定。 |
| 循環依存 | A- | 独自 `check-import-cycles.js` を CI で実行。循環検知は良いが、layer boundary rule まではない。 |
| 暗黙依存 | B- | README はかなり改善。Bob API、VS Code command、workspace trust、`.bob` 配置、task snapshot、template/process 規約など、実行時前提はまだ多い。 |
| 型定義量・型サイズ | B | 型分割により改善。`CoreWorkflowDefinition` はまだ schema と loader/runtime metadata が混在。webview message や command result の catch-all 型は緩い。 |
| barrel export 集中度 | B+ | `export *` は policy で原則禁止され、`src/core/model.ts` のみ例外。互換 façade として妥当だが、内部 import が集中し続けると暗黙依存化する。 |
| 自動テスト密度 | A- | parser / engine / runtime / authoring / snapshots / branching / policy まで広い。VS Code integration / webview DOM / schema drift / coverage gate は追加余地あり。 |

## 3. コードサイズ

### 3.1 確認した大きめファイル

今回確認した範囲で、サイズ上注意したいファイルは次の通り。

| ファイル | 取得時の行数 | コメント |
|---|---:|---|
| `src/core/engine.ts` | 495 | workflow execution の中心。preflight、pause、retry、review、branch checkpoint、artifact write を束ねる。500 行閾値目前。 |
| `src/workflowRunCommands.ts` | 383 | standalone run / step / next / resume / retry / branch inspect など VS Code command 側の orchestration が集中。 |
| `schema/workflow-register.v1.schema.json` | 338 | 公開 JSON schema。TS schema と重複管理。 |
| `src/core/schema/workflowSchema.ts` | 312 | runtime validation 用 schema object。JSON schema と drift しやすい。 |
| `src/core/modelSchema.ts` | 260 | schema 型、step 型、workflow definition 型の中心。前回よりは大幅改善。 |
| `src/webview/templateCustomizationStudioPanel.ts` | 255 | webview lifecycle、message router、VS Code UI、file/diff/open 操作が同居。 |
| `src/commands/templateCommands.ts` | 227 | template validate / generate / readiness command が集約。 |
| `src/workflowRegisterService.ts` | 220 | registration service。以前より委譲が進んでいるが、composition と state holder の中心。 |
| `src/process/processCatalogValidator.ts` | 192 | process catalog validation の手続きがまとまっている。 |
| `src/commands/processCommands.ts` | 171 | process command 群を集約。 |
| `src/extensionWithAuthoring.ts` | 170 | authoring、diagnostics、run control、process、template command の composition root。 |
| `src/webview/templateCustomizationStudioHtml.ts` | 168 | HTML / inline script / template rendering が集約。 |
| `src/extension.ts` | 159 | public API と core command registration。 |

500 行を超える巨大ファイルは確認範囲では出ていないが、`WorkflowEngine` は 500 行目前であり、今後の runtime 機能追加を直接入れるとすぐに危険域へ入る。

### 3.2 良い点

- 前回の中心型 `src/core/model.ts` は実質 4 module の re-export に縮小されている。
- `WorkflowRegisterService` は `WorkflowRunCommandService`、`WorkflowRuntimeFactory`、`ManualStepPanelController` へ委譲しており、以前より composition layer として整理されている。
- workflow builder client script は複数 renderer / event script に分割され、1つの巨大 script 文字列にならないようにしている。
- process / template / webview / command / core がディレクトリ上は分離されている。

### 3.3 懸念

1. **runtime orchestrator が太い**
   - `WorkflowEngine` は workflow 実行の中核なのである程度大きくなるのは自然だが、preflight、pause、review、branching、retry、artifact、manual completion、hook emit を扱う。
   - 既に helper は多いが、facade が「全分岐を知っている」状態は続いている。

2. **command service が UI flow と domain flow を両方持つ**
   - `WorkflowRunCommandService` は VS Code UI、workspace root selection、run selection、engine invocation、reporting をまとめている。
   - 今後 run 操作が増えると、service が command router + use-case + UI presenter になりやすい。

3. **template customization studio が panel に集まりやすい**
   - `TemplateCustomizationStudioPanel` は webview panel lifecycle、message dispatch、domain service 呼び出し、VS Code diff/open、diagnostic postMessage を持つ。
   - GUI が増えるほど、webview panel class が UI controller と application service の混合物になる。

4. **workflow-register の責務が拡張され続けている**
   - `bobProcess.*` と `bobTemplate.*` command が同じ extension に入ったため、workflow registration / runtime 以外の process/template platform も含む形になっている。
   - 拡張名と実体の乖離が進むと、新規保守者が入口を掴みにくい。

### 3.4 推奨

- `src/core/engine.ts` は 500 行を超えたら即分割ではなく、先に責務単位の private method / helper の配置を点検する。次の分割候補は `reviewGateController`、`branchCheckpointController`、`artifactCompletionController`。
- `WorkflowRunCommandService` は UI selection / use-case invocation / report formatting を分ける。特に `selectRun`、`pickCoreWorkflow`、`pickWorkflowRoot` 系は `runCommandUi.ts` に寄せられる。
- `TemplateCustomizationStudioPanel` は `TemplateStudioMessageRouter`、`TemplateStudioVsCodeAdapter`、`TemplateStudioSessionState` に薄く分ける。
- `process` と `template` がさらに増えるなら、少なくとも `src/features/process/*`、`src/features/template/*` のように feature root を切る。将来的には別 extension 化も検討する。
- CI の extension metrics comment に「最大単一ファイル行数 top 10」も出す。閾値例: 350 行 warning、500 行 fail。

## 4. ファイルサイズ

### 4.1 良い点

`.vscodeignore` は配布サイズ観点でかなり整理されている。

- `src/**`、`*.ts`、`out/**/*.map`、`*.tsbuildinfo`、`tsconfig.json` を除外している。
- `node_modules/**` を一度除外し、production runtime に必要な `ajv`、`fast-deep-equal`、`fast-uri`、`json-schema-traverse`、`require-from-string`、`js-yaml`、`argparse` だけを whitelist している。
- `package-lock.json`、test、coverage、tmp、`.git`、`.vscode` も除外している。
- `tsconfig.json` では `sourceMap: true` だが、生成された `out/**/*.map` は VSIX に入らない。
- `package:policy` は VSIX を ZIP として読み、size budget と forbidden entries を検査する。

前回レビューで指摘されていた `out/**/*.map` 除外と lockfile 不在は、今回 ref では解消済みである。

### 4.2 懸念

- `package-lock.json` は取得時 7,359 行で、dev dependency の transitive も多い。これは配布物には入らないが、review diff と dependency audit のノイズは増える。
- `vsce ls` のような同梱ファイル一覧 snapshot は、CI artifact として明示保存されていない。`check-vsix-policy.js` が entry を見るので安全性は高いが、人間が diff で追うには一覧 artifact があると便利。
- 1.2MB budget は良いが、履歴グラフや PR comment の増減値はまだない。小さいうちは問題になりにくいが、webview / schema / template assets が増えると急に効く。

### 4.3 推奨

- `npm run package` 後に `npx vsce ls > vsce-files.txt` 相当を CI artifact へ保存する。
- `check-vsix-policy.js` の出力に、最大 entry top 10 と `node_modules` package 一覧を追加する。
- package size の前回比を PR comment に出す。例: `+42 KB` 以上で warning。
- `.vscodeignore` の whitelist に新 package を追加する場合は、必ず `dependencyPolicy.test.js` に production license / package policy の期待値を追加する。

## 5. モジュール分割

### 5.1 改善済みの点

最も大きい改善は、`src/core/model.ts` の分割である。現在の `model.ts` は次の4つを re-export する互換 façade になっている。

- `modelSchema.ts`
- `modelProviders.ts`
- `modelSinks.ts`
- `modelRuntime.ts`

これにより、前回の「schema / runtime / provider / sink API が一枚岩」という状態はかなり改善している。

また、`WorkflowRegisterService` は、実行系 command の多くを `WorkflowRunCommandService` に委譲しており、registration service 自体の肥大化もある程度抑えられている。

### 5.2 現在の主要レイヤー

現在の構造は、おおむね次のように見える。

```text
src/
  extension.ts                    # core activation / public API
  extensionWithAuthoring.ts        # authoring, diagnostics, run-control, process, template command registration
  workflowRegisterService.ts       # registration service / watcher / runtime factory wiring
  workflowRunCommands.ts           # standalone run command use cases
  workflowRuntimeFactory.ts        # engine / store / Bob runner construction
  bob*.ts                          # Bob adapter / task runtime / messages / factory
  core/
    model*.ts                      # schema/runtime/provider/sink types
    engine.ts                      # workflow runtime facade
    engine/*                       # run state, step execution, branching, pause, preflight, result writers
    parser/*                       # markdown / YAML parser
    schema/*                       # runtime schema object
    runtime/*, snapshots/*         # stores / snapshots
  commands/
    *.ts                           # command entry implementations
  process/
    *.ts                           # process catalog/input/evidence/record validation and storage
  template/
    *.ts                           # template generation/readiness/studio model/validation
  webview/
    *.ts                           # manual step, workflow builder, template customization studio
```

この分割は悪くない。特に `core` から `commands` / `webview` へ依存しない方向を保てている限り、循環依存は入りにくい。

### 5.3 残リスク

- `extensionWithAuthoring.ts` は、多数の command registration を直接持つ。新 command を入れるたびに composition root が読みづらくなる。
- `commands/processCommands.ts` と `commands/templateCommands.ts` は、複数 command の application logic を1ファイルに集約している。数が増えると command router 化する。
- `template` は `parseWorkflowMarkdown` に依存しており、template -> parser は自然だが、parser 側が template / authoring / webview を参照し始めると循環化する。
- `webview/templateCustomizationStudioPanel.ts` は webview lifecycle と domain operation を同時に持つ。

### 5.4 推奨

- `extensionWithAuthoring.ts` の command registration を次の関数へ分ける。
  - `registerWorkflowAuthoringCommands(context, deps)`
  - `registerRunControlCommands(context, deps)`
  - `registerProcessCommands(context, deps)`
  - `registerTemplateCommands(context, deps)`
  - `registerWorkflowDiagnostics(context, deps)`
- `commands/processCommands.ts` は `processCommandHandlers.ts` と `processCommandIo.ts` に分離する。
- `commands/templateCommands.ts` は `templateValidationCommands.ts`、`templateGenerationCommands.ts`、`templateReadinessCommands.ts` に分離する。
- `templateCustomizationStudioPanel.ts` は message handling と VS Code side effects を分ける。
- `check-import-cycles.js` に加えて、layer rule を持つ architecture policy を追加する。例:

```text
src/core/**         -> src/commands/**, src/webview/** を import 禁止
src/core/parser/**  -> src/core/workflowAuthoring*, src/template/** を import 禁止
src/process/**      -> src/commands/**, src/webview/** を import 禁止
src/template/**     -> src/commands/**, src/webview/** を import 禁止
src/webview/**      -> src/extension*.ts を import 禁止
```

## 6. 依存パッケージ・bundle サイズ

### 6.1 runtime dependencies

`package.json` の runtime dependency は次の2つだけである。

- `ajv`: workflow schema validation
- `js-yaml`: `WORKFLOW.md` front matter、process/template YAML 読み込み

この依存数はかなり良い。ワークフロー登録・YAML parse・JSON schema validation という機能範囲に対して妥当である。

### 6.2 dev dependencies

主な dev dependency は TypeScript、VS Code 型、VSCE、未使用検出系である。

- `typescript`
- `@types/node`
- `@types/vscode`
- `@types/js-yaml`
- `@vscode/vsce`
- `knip`
- `ts-prune`
- `depcheck`

`package-lock.json` には dev transitive が多く含まれるが、`.vscodeignore` と VSIX policy により配布物からは除外される設計である。

### 6.3 bundle / VSIX 観点

この extension は bundler で単一 JS bundle に固める設計ではなく、`tsc` で CommonJS output を作り、必要な production `node_modules` を VSIX に含める設計である。

良い点:

- `out/**/*.map` は除外済み。
- `package-lock.json` は repository には commit されるが、VSIX から除外済み。
- production dependency whitelist が明示されている。
- `package:policy` が `workflow-register-0.1.0.vsix` の size と forbidden entries を検査する。
- budget は `1200000` bytes に設定されている。

懸念:

- bundler を使わないため、runtime dependency の whitelist 漏れや package の内部 file 増加に注意が必要。
- `js-yaml` と `ajv` は妥当だが、今後 webview UI library や schema utility を runtime dependency に追加すると VSIX size が跳ねやすい。
- `audit:prod` は production dependency に限定されており、dev dependency の脆弱性は別途 Dependabot / GitHub alerts に寄せる前提になる。

### 6.4 推奨

- runtime dependency を追加する PR では、追加理由、VSIX size 差分、license、代替案を PR template に書く。
- `check-vsix-policy.js` に production `node_modules` package whitelist の検証を入れる。
- `package:policy` は `npm run package` の直後だけでなく、release job でも必ず実行する。

## 7. 未使用コード

### 7.1 現状

未使用コード対策は、前回から大きく改善されている。

- `unused:report` script が追加されている。
- `knip --production --include dependencies,devDependencies,unlisted,unresolved,exports,types` を実行する。
- `ts-prune` を実行する。
- `depcheck . --ignore-bin-package --skip-missing` を実行する。
- CI の workflow-register job で `npm run unused:report` が走る。

ただし、この gate は intentionally report-only であり、非ゼロ exit や tool error があっても最終的には 0 で終わる設計である。

### 7.2 良い点

- いきなり fail gate にせず report-only にしているため、public command / extension API / dynamic command registration の false positive を吸収しやすい。
- `dependencyPolicy.test.js` が `unused:report` script と CI 組み込みを検査しており、品質ゲート自体が消えにくい。
- global `Object.title` augmentation の禁止テストがあり、型エラー抑制による死角が減っている。

### 7.3 懸念

- `tsconfig.json` に `noUnusedLocals` と `noUnusedParameters` は見えない。local dead code は compile で落ちない。
- `knip` / `ts-prune` / `depcheck` の結果が report-only のため、実際の unused export / unused dependency が積み上がっても CI は green になりうる。
- `workflowRegister.*`、`bobProcess.*`、`bobTemplate.*` の command ID は VS Code から動的に呼ばれるため、未使用検出では false positive になりやすい。baseline 管理が必要。
- webview client script は文字列として埋め込まれるため、通常の static analysis が効きにくい。

### 7.4 推奨

- `noUnusedLocals: true` をまず導入し、必要なら test helper だけ個別対応する。
- `noUnusedParameters: true` は public callback や VS Code command handler で負荷が高ければ後回しでよい。
- `unused:report` の結果を CI artifact / PR comment に残し、件数が増えたら警告する。
- `knip` の ignore / entry を明示し、false positive baseline を作った後、依存だけでも fail gate 化する。
- webview client script は、可能なら純粋関数部分を `.ts` として test できる形へ寄せる。

## 8. 循環依存

### 8.1 現状

循環依存対策は強い。`architecture:policy` は `node ../../scripts/check-import-cycles.js src` であり、CI でも実行される。

`check-import-cycles.js` は、TypeScript source を走査し、relative import / export / dynamic import / require を解決して graph を作り、DFS で cycle を検出する。cycle があれば exit 1 になる。

### 8.2 良い点

- `madge` 等の外部 tool に依存せず、repository 内 script で deterministic に検査できる。
- `import` だけでなく `export ... from` も見るため、barrel 経由の cycle もある程度検出できる。
- dynamic import / require の string literal も見る。
- CI に組み込まれているため、循環依存は回帰しにくい。

### 8.3 限界

- relative import のみを対象にしているため、npm package 経由の cycle や path alias は対象外。ただし現状は path alias が見えないため問題は小さい。
- `.d.ts` は除外される。
- cycle は検出できるが、layer 逸脱は検出しない。たとえば `core -> webview` のような依存は cycle にならなければ通る。
- `src/core/model.ts` の `export *` 例外は互換上妥当だが、依存を集約する入口として cycle の温床になりうる。

### 8.4 推奨

- 現在の cycle policy は維持する。
- 追加で layer policy を導入する。最初は report-only でもよい。
- `src/core/model.ts` 以外の `export *` は引き続き禁止する。
- 新規 internal code は可能なら `src/core/model` ではなく、`modelSchema` / `modelRuntime` / `modelProviders` / `modelSinks` を直接 import する。

## 9. 暗黙依存

### 9.1 主な暗黙依存

`workflow-register` には、package dependency としては見えない実行時前提が多い。

| 暗黙依存 | 現状 | リスク |
|---|---|---|
| VS Code / Bob IDE | `engines.vscode` は `^1.106.1`。VS Code API と Webview API に依存。 | API 変更、host 差分。 |
| IBM Bob extension | Bob UI 登録時は `IBM.bob-code` が必要。README では standalone authoring / validation / execution は Bob なしでも可能と説明。 | Bob API shape の変更。 |
| VS Code command | `workflowRegister.agentCommand`、`workflowRegister.aiProviderCommand`、`vscode.executeCommand` provider。 | 任意 command 実行、引数 shape、戻り値 shape。 |
| Trusted Workspace | workflow 実行、reload、manual step completion、run command で trust check がある。 | untrusted workspace での command / file write / sink 実行。 |
| `.bob/workflows` | workflow discovery は `.bob/workflows/*/WORKFLOW.md` 前提。 | 配置規約変更に弱い。 |
| `.bob/workflows/runs` | run state と task snapshot 保存先。`.gitignore` mutation もある。 | 機密情報、repository 汚染、保存形式互換。 |
| Bob task API | task snapshot、message、subagent、handoff など Bob task object の optional shape に依存。 | Bob 側 API の互換性。 |
| process/template conventions | `.bob/process/*`、`.bob/template-library/*`、`.bob/template-readiness/*`、Bazaar `bzr --no-aliases` など。 | workflow-register 本体から見ると別 domain の前提が増える。 |
| JSON/YAML schema | TS schema object と公開 JSON schema。 | drift、schemaVersion 互換。 |

### 9.2 良い点

- README に `IBM.bob-code`、生成物、VSIX サイズ、必要 CLI、Trusted Workspace が明記されている。
- task snapshot は既定で Bob chat messages を含めず、secret らしい文字列を best-effort redaction する説明がある。
- `WorkflowRegisterService` と `WorkflowRunCommandService` には `requireTrustedWorkspace` が入っている。
- guardrails に `allowedCommandIds` / `deniedCommandIds` が追加されており、provider ID だけでなく command ID 単位で制御する方向になっている。

### 9.3 残リスク

- Bob task API の期待 shape は README の利用者向け説明だけでは追いにくい。developer 向け contract として `docs/` または `bobWorkflowTypes.ts` にまとめたい。
- AI provider command と agent command の request / response shape は設定説明にあるが、versioned contract としては弱い。
- `vscode.executeCommand` は便利だが、拡張間 command ID の変更に弱い。guardrail と regression test が必要。
- process / template domain の暗黙規約が workflow-register に同居し始めているため、README だけでなく architecture doc で境界を示したい。

### 9.4 推奨

- `docs/workflow-register-runtime-contracts.md` を追加し、Bob API、Bob task API、ActionProvider、AgentProvider、ResultSink、AI provider command の shape を versioned contract として整理する。
- `vscode.executeCommand` provider の command ID allowlist / denylist regression test を増やす。
- `.bob/workflows/runs` の schema migration 方針を決める。
- process / template の配置規約は、workflow-register README では概要に留め、詳細は process/template 専用 doc へ分離する。

## 10. union / mapped type など型定義の量やサイズ

### 10.1 現状

型定義は前回よりかなり改善している。

- `modelSchema.ts`: workflow schema、step、transition、manual form、artifact、completion、`CoreWorkflowDefinition`。
- `modelRuntime.ts`: run status、step run status、attempt、branching state、run state。
- `modelProviders.ts`: agent provider、parse result、action execution input/result。
- `modelSinks.ts`: result sink definition/write input/result。
- `model.ts`: 上記4つの互換 re-export。

string union と discriminated union は適切に使われている。

代表例:

- `WorkflowStepType = "command" | "agent" | "manual" | "result"`
- `WorkflowStepExecutionMode = "full" | "todo" | "engineSteps"`
- `RunStatus = "running" | "paused" | "checkpoint" | "reviewing" | "held" | "completed" | "failed"`
- `EngineStep = CommandEngineStep | AgentEngineStep | ManualEngineStep | ResultEngineStep`
- `ResultSinkDefinition = { type: "command" ... } | { type: "file" ... }`

mapped type の過度な濫用は確認範囲では見えず、読みやすさは比較的保たれている。

### 10.2 良い点

- runtime state と schema type が別ファイルに分かれた。
- provider / sink API が別ファイルになり、外部 extension との contract を追いやすくなった。
- global `Object` augmentation 禁止テストが追加され、型安全性を崩す逃げ道が塞がれている。
- discriminated union により step type ごとの required field を表現できている。

### 10.3 懸念

1. **`CoreWorkflowDefinition` がまだやや広い**
   - `id`、`name`、`description`、`engineSteps` のような workflow domain だけでなく、`definitionHash`、`filePath`、`workflowRoot`、`workflowFile`、`workflowFolderName` など loader/runtime metadata も持つ。
   - `ParsedWorkflowDefinition` と `LoadedWorkflowDefinition` に分けると、parser と runtime の責務境界が明確になる。

2. **catch-all 型がいくつかある**
   - `ProcessCommandResult` / `TemplateCommandResult` は `[key: string]: unknown` を持つ。
   - webview message type も `{ type: string; model?: ...; [key: string]: unknown }` の catch-all を含む。
   - 拡張性はあるが、exhaustiveness check が弱くなる。

3. **schema が二重管理**
   - `src/core/schema/workflowSchema.ts` と `schema/workflow-register.v1.schema.json` が並立している。
   - `schema:policy` は compile と authoring test を実行するが、TS schema と JSON schema の byte-level / semantic drift 検出ではない。

### 10.4 推奨

- `CoreWorkflowDefinition` を次のように分ける。

```ts
interface ParsedWorkflowDefinition { ...schema由来の情報... }
interface LoadedWorkflowDefinition extends ParsedWorkflowDefinition { filePath; workflowRoot; definitionHash; ... }
interface RuntimeWorkflowDefinition extends LoadedWorkflowDefinition { ...runtime補助情報... }
```

- webview message は catch-all を最後の escape hatch にせず、known message union + unknown handler に分ける。
- command result は `status` ごとの result type を command ごとに定義し、共通 `[key: string]: unknown` は boundary だけに閉じ込める。
- schema は TS object から JSON schema を生成するか、JSON schema を source of truth にして TS 側の import/generation を検討する。
- 少なくとも CI に `schema/workflow-register.v1.schema.json` と `workflowV1Schema` の normalized diff test を追加する。

## 11. barrel export の集中度

### 11.1 現状

barrel export は管理されている。

- `source:policy` は `node ../../scripts/check-export-star-policy.js src --allow src/core/model.ts`。
- `check-export-star-policy.js` は TypeScript source から `export * from` を検出し、allowed path 以外で失敗する。
- 現在 `src/core/model.ts` は compatibility façade として `modelSchema`、`modelProviders`、`modelSinks`、`modelRuntime` を `export *` している。

これは、前回の「巨大 barrel は見えないが中心型が重い」という状態から、「型 module は分割済みだが互換 import path を残す」状態になっている。

### 11.2 良い点

- `export *` が policy で増殖しない。
- exception が1ファイルに限定されている。
- `model.ts` は4行で、実装 logic を持たない。

### 11.3 懸念

- 内部 code が引き続き `./core/model` に集中すると、どの型カテゴリに依存しているか見えにくい。
- `model.ts` が例外として許可されているため、今後さらに `export *` が追加されると、再び巨大型ハブになりうる。

### 11.4 推奨

- 新規 internal import は、原則 direct module import にする。例: `./modelRuntime`、`./modelSchema`。
- `src/core/model.ts` は external compatibility API として扱う。
- `source:policy` の allow は1ファイルのまま維持する。
- `model.ts` に re-export を追加する場合は、public API 互換理由を PR に書く。

## 12. 自動テスト密度

### 12.1 現状

自動テスト密度は高い。

`package.json` の `test` script は `npm run compile && node --test test/*.test.js` であり、TypeScript compile 後に Node test runner で test file をまとめて実行する。

確認できた test file 例は次の通り。

- `workflowRegister.test.js`
- `dependencyPolicy.test.js`
- `workflowAiProvider.test.js`
- `runtimeWiring.test.js`
- `workflowDesignBuilder.test.js`
- `workflowAuthoringLoader.test.js`
- `workflowEnginePreflightDefaults.test.js`
- `workflowAuthoring.test.js`
- `workflowParserV1.test.js`
- `agentStep.test.js`
- `workflowEngineCore.test.js`
- `workflowAuthoringSerializer.test.js`
- `workflowUserActionSchema.test.js`
- `workflowAuthoringUserAction.test.js`
- `workflowBranchingDefinition.test.js`
- `workflowSamples.test.js`
- `workflowReplacementPreview.test.js`
- `workflowEngineReviewSteps.test.js`
- `taskSnapshots.test.js`
- `workflowAgentProvider.test.js`
- `workflowRunRecovery.test.js`
- `workflowEngineSingleStep.test.js`
- `resultSinkRegistry.test.js`
- `bobWorkflowFactory.test.js`
- `commandWorkflowAiProvider.test.js`
- `workflowEngineCommandAgent.test.js`
- `bobWorkflowMessages.test.js`
- `workflowBranchingEngine.test.js`
- `manualStepPanel.test.js`

加えて、`dependencyPolicy.test.js` は品質ゲートそのものをテストしている。

- committed lockfile があること。
- policy scripts が `package.json` に存在すること。
- `package-lock.json` が `.gitignore` されないこと。
- `.vscodeignore` が `out/**/*.map` を除外すること。
- production dependency package に license metadata があること。
- CI が `npm ci`、dependency policy、architecture policy、source policy、schema policy、unused report、audit、test、package、VSIX policy を実行すること。
- README が生成物、依存、CLI、Trusted Workspace を記述すること。
- global `Object` augmentation がないこと。

これはかなり良い。

### 12.2 良い点

- parser、engine、runtime、authoring、serializer、replacement preview、branching、snapshot、Bob adapter、policy まで広い。
- `dependencyPolicy.test.js` により、品質ゲートが accidental に消えにくい。
- CI で compile、schema policy、unit test、package、VSIX policy が繋がっている。
- PR 用 extension metrics job があり、source/test LOC と dependency count をコメントできる。

### 12.3 足りない・追加したいテスト

- VS Code integration test: command registration、webview creation、workspace trust behavior。
- webview DOM / message integration test: workflow builder と template customization studio の postMessage contract。
- schema drift test: TS schema と JSON schema の normalized equivalence。
- unused report の件数 snapshot。
- VSIX entry snapshot。
- source size threshold test: max file LOC、src/test ratio、webview generated script size。
- `vscode.executeCommand` guardrail の command ID allowlist / denylist regression。
- migration test: old run state / snapshot / workflow definition を新 code が読めること。

### 12.4 推奨

- まず `schemaDrift.test.js` を追加する。これは低コストで効果が高い。
- `dependencyPolicy.test.js` に `check-vsix-policy.js` の forbidden entry rule が増減したときの期待値を入れる。
- `report-extension-metrics.js` の出力に最大ファイル行数 top 10 と test/source LOC ratio を足す。
- template customization studio の message contract を pure function に切り出し、Node test で検証する。

## 13. 優先度付き改善バックログ

### High

1. **`WorkflowEngine` の 500 行突破前に責務境界を固定する。** まずは review / branch / artifact completion の helper 境界を明文化する。
2. **schema drift test を追加する。** `workflowSchema.ts` と `schema/workflow-register.v1.schema.json` が同じ意味を持つことを CI で検査する。
3. **layer policy を追加する。** cycle detection だけでなく、`core -> webview` などの方向違反を防ぐ。
4. **`TemplateCustomizationStudioPanel` を薄くする。** message routing と VS Code side effects を分ける。
5. **`vscode.executeCommand` guardrail の regression test を増やす。** provider ID だけでなく command ID 単位で確認する。

### Medium

1. `WorkflowRunCommandService` の UI selection / use-case / reporting 分離。
2. `processCommands.ts` と `templateCommands.ts` の command 単位分割。
3. `CoreWorkflowDefinition` の Parsed / Loaded / Runtime 分割。
4. `unused:report` の結果を PR comment または artifact に保存し、依存系だけ fail gate 化。
5. VSIX entry list と size diff を CI artifact / PR comment に出す。
6. 新規 internal code では `src/core/model` ではなく direct type module import を推奨する方針を README または `src/core/README.md` に追記。

### Low

1. `noUnusedLocals` を段階導入。
2. template/process 機能がさらに増えたら feature root または別 extension 化を検討。
3. webview script を pure function と DOM adapter に分ける。
4. run state / snapshot schema migration policy を docs 化。
5. package-lock diff の reviewer 向け見方を docs 化。

## 14. ローカル実測コマンド

対象 ref を checkout できる環境では、次を実行して本レビューの静的評価を実測で補完する。

```bash
git checkout 350010e766d99ad19a0bba5bf11e2cbd0ee04e62
cd extensions/workflow-register

npm ci
npm run dependency:policy
npm run architecture:policy
npm run source:policy
npm run schema:policy
npm run unused:report
npm run audit:prod
npm test
npm run package
npm run package:policy

# 追加で人間レビュー用
find src test schema -type f \
  \( -name '*.ts' -o -name '*.js' -o -name '*.json' -o -name '*.md' \) \
  -print0 | xargs -0 wc -l | sort -n

npx vsce ls > vsce-files.txt
du -sh out node_modules workflow-register-0.1.0.vsix 2>/dev/null || true
```

## 15. 結論

今回の `workflow-register` は、前回レビュー時点と比べて明確に良くなっている。特に、lockfile、VSIX policy、source map 除外、循環依存検査、export-star 検査、unused report、README の trust / package policy 記述、global type patch 禁止は、保守性と配布安全性を大きく上げている。

一方で、機能スコープはさらに広がっている。`workflow-register` は workflow registration の枠を超えて、runtime platform、process automation、template customization UI まで持ち始めている。ここから先は、依存や VSIX size よりも、**feature boundary と orchestration file の肥大化**が主なリスクになる。

現時点の最優先は、`WorkflowEngine`、`WorkflowRunCommandService`、`extensionWithAuthoring.ts`、`TemplateCustomizationStudioPanel` に対して、これ以上何を入れないかを決めること。そのうえで、schema drift test と layer policy を追加すれば、現在の良い状態をかなり長く維持できる。
