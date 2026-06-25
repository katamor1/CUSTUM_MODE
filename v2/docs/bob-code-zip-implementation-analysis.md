# bob-code ZIP 実装分析: Bob 専用拡張基盤の再検討

調査日: 2026-06-26  
入力: ユーザー提供 `bob-code.zip`  
対象: `bob-code` VSCode 拡張 bundle / webview build / schema / localization

## 1. この更新で分かったこと

前回の `docs/bob-dedicated-extension-foundation-analysis.md` は、GitHub 上の `bob2/bob-code/dist/extension.js` が空に見えたため、主に `package.json` と localization からの推定に寄っていた。

今回ユーザー提供 ZIP を直接展開したところ、実際には次の実体が含まれていた。

| 項目 | ZIP 内での確認結果 |
| --- | --- |
| extension host bundle | `dist/extension.js` 約 14.9 MB |
| source map | `dist/extension.js.map` 約 21.9 MB。`sources` はあるが `sourcesContent` は無い |
| webview build | `webview-ui/build/assets/**` に Chat / Findings / Review / browser panel 系 build と source map |
| webview source map | Findings / Review panel の source map は `sourcesContent` あり |
| tokenizer / parser | `dist/cl100k_base.json`、`tiktoken_bg.wasm`、多数の `tree-sitter-*.wasm` |
| MCP schema | `schemas/mcp-config.schema.json` と README |
| localization | `package.nls.*.json`、`dist/i18n/locales/**`、`dist/translations/**` |
| assets | codicons、material icons、Bob icon、theme |

したがって、Bob は単なる Webview チャットではなく、**extension host 側に agent runtime、tool runtime、MCP hub、task store、review/findings service、command security、Tree-sitter、tokenizer、認証、feature flag、marketplace/add-on 管理を持つ統合拡張** として動いている。

## 2. 静的構成の実態

### 2.1 VSCode manifest

`package.json` の主要値は次の通り。

| 項目 | 値 |
| --- | --- |
| `name` | `bob-code` |
| `publisher` | `IBM` |
| `displayName` | `IBM Bob` |
| `version` | `2.0.0` |
| `engines.vscode` | `^1.106.1` |
| `activationEvents` | `onStartupFinished` |
| `main` | `./dist/extension.js` |
| `contributes.authentication[0].id` | `bobLogin` |

起動は `onStartupFinished` であり、ユーザーが初回コマンドを打つまで何もしない構造ではない。認証、履歴、キュー、feature flag、MCP 監視、Findings、Review などを常時同期する前提の設計である。

### 2.2 UI 面

manifest の views は次の 3 面構成である。

| container | view id | 役割 |
| --- | --- | --- |
| secondary sidebar | `bobChatView` | Chat / task / workflow |
| panel | `bobFindingsView` | Findings 一覧・詳細・操作 |
| SCM | `bobReviewView` | branch / issue 起点の review |

実装 bundle でも、`newChatPanel()`、`newFindingsPanel()`、`newReviewPanel()` を作り、それぞれ `registerProvider()` で `window.registerWebviewViewProvider(..., { retainContextWhenHidden: true })` に登録している。

## 3. activation の実際の流れ

`dist/extension.js` 内では、activation 相当の関数で概ね次の初期化を行っている。

```text
activate(context)
  -> package detail を読み込み
  -> Bob config を初期化
  -> VSCode log level / file logger / translations を初期化
  -> Webview manager を生成
  -> BobHarness runtime を初期化
  -> runtime.managers.mcpHub を global registry へ登録
  -> unhandledRejection handler を登録
  -> TreeSitterService(dist) を初期化
  -> persistent task store を作成
  -> legacy tasks dir を含む task store migration / setup
  -> Chat / Findings / Review webview provider を作成
  -> AuthenticationProvider bobLogin を登録
  -> AddonManager / feature flags を初期化
  -> Terminal buffer fetcher を作成
  -> Task manager を作成し webview / runtime / FS と接続
  -> common webview handlers を登録
  -> task/history/workflow/new task/import/export/wipe 等の command を登録
  -> code actions / editor commands / explorer commands を登録
  -> findings service を初期化
  -> Git API 利用可能後に commit generation / review / attribution / PR workflow を初期化
  -> workspace trust grant 後に Git dependent features を再初期化
  -> chat view に focus
  -> 初期 task を open
```

この構造から、Bob 専用拡張を作る場合も、単一 `extension.ts` に command を並べるのではなく、**activation coordinator** を置いて、config / runtime / registry / webview / task / git / findings を順に起動する構造にすべきである。

## 4. グローバル Registry の存在

bundle には `SourceRegistry` に相当する singleton があり、実体名は minified されているが `Ai.Instance` として読める。

保持している主な state:

- modes
- tools
- findings
- workflows
- groups
- skills
- mcpHub
- init hooks
- workspaces

`register` は tool / mode / finding / workflow / group / skill などを追加し、source change event を発火する。つまり Bob の拡張点は VSCode command ではなく、**source registry に tool / workflow / finding source を差し込む plugin-like architecture** になっている。

Bob 専用拡張では、この registry を clean-room で次のように再現するのがよい。

```ts
interface BobSourceRegistry {
  registerTool(sourceId: string, tool: BobTool): void
  registerWorkflow(sourceId: string, workflow: BobWorkflow): void
  registerFindingSource(source: FindingSource): void
  registerMode(mode: BobMode): void
  registerSkill(skill: BobSkill): void
  setMcpHub(hub: McpHub): void
  onSourceChange(listener: () => void): Disposable
}
```

## 5. Webview 基底クラスと message bridge

bundle には共通 Webview 基底クラスがあり、Chat / Findings / Review / Settings / Feedback がこれを継承している。

確認できる主な機能:

- `registerProvider()` で `registerWebviewViewProvider`
- `createPanel()` で standalone Webview panel を作成
- `resolveWebviewView()` で view を解決
- `retainContextWhenHidden: true`
- `enableScripts: true`
- `enableCommandUris: true`
- `localResourceRoots` に web root と assets を指定
- `onDidReceiveMessage` で webview message を受信
- `handlers[type]` による type-based dispatch
- `idHandlers[requestId]` による request / response callback
- hot reload path と production web asset の切替

このため Bob 専用拡張では、Webview ごとに個別 postMessage 処理を書くのではなく、`BaseWebviewProvider` と `WebviewMessageRouter` を共通化するのが必須である。

## 6. Chat / Task runtime

### 6.1 Task manager

bundle では persistent task store を作った後、Task manager を生成し、Chat webview、runtime、filesystem、terminal buffer fetcher と接続している。

確認できる task 操作:

- `openTask({ useWorkspace, location, workflow, defaultMode, onReady })`
- `newTask()`
- `createHarnessTask(workspaceFolder)`
- `getTopLevelChatManager()`
- `getChatManagerByTaskId(taskId)`
- `getHistory(workspaces)`
- `exportCurrent`
- `import / export / wipe`
- task metadata / status / cost / message count / pinned / waiting request

`createHarnessTask` は workspace 情報を runtime に渡すとき、次を含む env を作っている。

- workspace path
- scheme
- query
- workspaceName
- UI language
- playground flag
- costEffective flag
- `_meta.getCommandSecurityEnabled()`
- `_meta.commandSecurityModel`
- `_meta.getIgnorePatterns(workspace)`
- `_meta.getApprovedCommands(toolId)`

ここが重要で、command security や `.bobignore` / approved command は LLM prompt 後段ではなく、task env の meta として runtime に入っている。

### 6.2 Message queue

Chat webview への session history push では、task history 内の `requestsWaiting` を見て `setContext("bob-code.hasRequestsWaiting", true/false)` を更新し、webview へ `setSessionHistory` を送っている。

これは deep research report の「実行中の Bob に追加メッセージを送れる / キューされる」という機能が、少なくとも UI 状態として task history に統合されていることを示す。

専用拡張では `MessageQueue` を task に持たせ、以下を state として保存すべきである。

```ts
interface TaskSummary {
  id: string
  title: string
  mode: string
  status: string
  updatedAt: number
  messageCount: number
  isBusy: boolean
  requestsWaiting: boolean
  isOpen: boolean
  cost?: number
  firstMessage?: string
  isPinned?: boolean
  lastError?: string | null
  workspace?: string
}
```

## 7. Mode / Subagent / Skill の実装寄り理解

### 7.1 Built-in modes

bundle 内には built-in mode として `agent`、`plan`、`ask` が読み取れる。

| mode | groups | 特徴 |
| --- | --- | --- |
| `agent` | read / edit / execute / mcp / skill / todo / artifact / subagent / mode | 実装・修正・refactor 向け |
| `plan` | read / edit / mcp / skill / subagent / mode | `create-plan` skill を最初に使う。edit は md/txt に制限 |
| `ask` | read / mcp / skill / subagent / mode | 説明・調査向け。実装へ勝手に移らない |

`plan` と `ask` は `allowedSubagents: ["explore"]` を持つ。`agent` は general も含めた広い tool set を扱う。

### 7.2 Subagent tool

bundle には `spawn_subagent` の system/tool 説明があり、重要な制約が明記されている。

- subagent は独立 context で動く
- 結果は summary として返す
- `fork_context=true` で親会話履歴を渡せる
- 単純な file read / search / quick lookup には使わない
- 複数 spawn は並列実行される
- subagent は subagent を spawn できない
- `explore` preset は read-only で `update_todo_list` / `use_skill` を deny

専用拡張で subagent を再現する場合、まずは OS process や worker ではなく、**同一 extension host 内の別 AgentSession + isolated message history** として実装すればよい。

### 7.3 Skills

bundle には Skills registry があり、同名 skill の二重登録を拒否する。system prompt 生成時には、mode の group と skill の group を照合し、利用可能 skill の name / description / location を `<available_skills>` として system prompt に入れる。モデルには `use_skill` tool で明示的に skill を activate させる。

専用拡張では、skill は prompt fragment の常時注入ではなく、**必要時に tool 経由で詳細 instruction をロードする遅延注入** として扱うべきである。

## 8. Tool runtime / command security

### 8.1 Tool permission

bundle の tool handling では、tool call 受信時に `BobTask.getToolPermission(tool)` を見て permission を算出し、現在 mode の allowed tools に含まれない tool は拒否している。

また file path usage を解析し、outside workspace、Bob home 書き込み、command usage などを見ている。

### 8.2 Command security

`execute_command` には command security 評価がある。特に次が確認できる。

1. まず shell 構文・危険パターンをローカルに検査する。
2. security が無効なら safe 扱い。
3. provider がある場合、LLM に command を渡して `<verdict>safe</verdict>` / `<verdict>dangerous</verdict>` を要求する。
4. threat categories には secrets/credentials、data exfiltration、remote code execution、destructive operations、privilege escalation、resource exhaustion、obfuscation がある。
5. `.bobignore` 等の ignored file pattern がある場合、ignored file access も危険カテゴリに追加される。
6. LLM 判定が取れない場合は dangerous 側に倒す。

この設計は、専用拡張にそのまま採用すべき重要点である。つまり、command 実行は以下の gate を通る。

```text
tool call
  -> mode allowed tool check
  -> command/file/path usage extraction
  -> denied/allowed command policy
  -> command security local heuristic
  -> command security LLM verifier, if enabled
  -> user approval / auto approval
  -> execute
  -> audit / attribution
```

## 9. MCP 実装

### 9.1 McpConfigManager

MCP config は次のファイル名で扱われている。

| 定数 | 値 |
| --- | --- |
| `MCP_WORKSPACE_FILENAME` | `mcp.json` |
| `MCP_GLOBAL_FILENAME` | `mcp.json` |
| `MCP_LEGACY_GLOBAL_FILENAME` | `mcp_settings.json` |

workspace 側は `.bob/**/mcp.json` を監視する。global 側は global settings directory 配下の `mcp.json` を扱う。`parseServerConfigs` は `mcpServers` object を読み取り、parse error を config result として返す。

MCP config update API として次が確認できる。

- `updateServerDisabled(configPath, serverName, disabled)`
- `updateToolDisabled(configPath, serverName, toolName, disabled)`
- `updateToolAlwaysAllow(configPath, serverName, toolName, alwaysAllow)`
- `updateServerTimeout(configPath, serverName, timeout)`
- `deleteServerConfig(configPath, serverName)`
- `restart()`
- `restartServerByConfig(configPath, serverName)`

### 9.2 BobMcpTool

MCP tool は Bob tool として wrap され、tool id は `mcp__<server>__<tool>` 形式に正規化される。長すぎる server/tool 名は truncate される。tool description は `MCP tool <tool> from server <server>. <description>` の形になる。

専用拡張では MCP を単なる外部 config として扱うのではなく、**tool registry に動的登録される BobTool** として扱うべきである。

## 10. Settings / Marketplace / Add-on

Settings webview は `bobSettingsView` / `settings.html` として panel 生成される。webview ready 時に以下を送る。

- tool groups
- workspace folders
- all modes
- all skills

Settings webview が受ける message には次がある。

- `requestMcpServers`
- `requestMarketplaceItems`
- `retryMarketplaceFetch`
- `updateSetting`
- `openLogDir`
- `openSettingsFile`
- `openFile`
- `updateMcpServerDisabled`
- `updateMcpToolDisabled`
- `updateMcpToolAlwaysAllow`
- `updateMcpServerTimeout`
- `deleteMcpServer`
- `installMarketplaceItem`
- `uninstallMarketplaceItem`
- `refreshAllMcpServers`
- `restartMcpServer`

Premium Package / add-on は `AddonManager` が profile entitlement を見て source を enable し、足りない VSCode extension を installation check する構造である。bundle 内で確認できる package 例:

| add-on | source | extension |
| --- | --- | --- |
| Premium Package for i | `ibmi` | `IBM.vscode-ibmi-bob` |
| Premium Package for Java | `java-modernization` | `IBM.bob-java` |
| Premium Package for Z | IBM Z 系 source | `IBM.bob-z-extension`、`IBM.zopeneditor`、`IBM.compiledcodecoverage`、`IBM.zopendebug`、`zowe.vscode-extension-for-zowe` 等 |

この仕組みは、専用拡張で plugin / package を増やす場合の参考になる。source id を enable/disable し、extension dependency を確認し、足りなければ導入案内する。

## 11. Findings 実装

### 11.1 Findings manager

bundle には Findings manager があり、source registry と連動して次を扱う。

- finding source 登録
- source findings の set / remove
- hidden finding の除外
- dismissed state
- findings change event
- source change event
- per-source actions
- branch change 時の handling
- save/delete/rename/tab change に応じた queue handling

Findings は chat の一部ではなく、専用 manager と Webview を持つ独立サブシステムである。

### 11.2 Findings webview

`webview-ui/build/assets/bobFindingsPanel.js.map` には sourcesContent があり、React 側の構造が読める。

主要 component:

- `BobFindingsApp`
- `GenericFindingsView`
- `FindingDetailPanel`
- `SimpleMarkdown`
- `useFindingsFilter`
- `findingHelpers`

webview message:

- extension -> webview
  - `availableSources`
  - `setFindings`
  - actions for finding
- webview -> extension
  - finding action request
  - selection/open action 等

UI では finding を file / type / severity で group 化し、detail panel に Markdown content と action button を出す。

専用拡張では、Review 結果や静的解析結果を chat message として流すのではなく、Finding model に正規化して Findings panel に集約すべきである。

## 12. Review 実装

### 12.1 Review webview provider

Review webview provider は `bobReviewView` / `review.html` を扱う。確認できる message handler:

- `ready`
- `requestBranches`
- `requestFileChanges`
- `startReview`
- `openFile`
- GitHub issue 関連 request

provider は repository list、branch list、file changes、GitHub issues を webview に送り、branch 変更も監視する。

### 12.2 Review panel React

`BobReviewApp.tsx` の source map から、UI は次を持つ。

- review mode: `branch` / `issue`
- branch selector
- GitHub issue selector
- include uncommitted checkbox
- file change tree
- start review button
- selected branch / issue / changes state

webview -> extension message:

```ts
{ type: "ready" }
{ type: "requestFileChanges", branch, includeUncommitted }
{ type: "startReview", mode: "branch", branch, includeUncommitted }
{ type: "startReview", mode: "issue", issueUrl }
{ type: "openFile", path, status }
```

extension -> webview message:

```ts
{ type: "branches", branches }
{ type: "fileChanges", changes }
{ type: "branchChanged", branch }
{ type: "githubIssues", githubIssues }
```

### 12.3 Review source / workflow

extension host 側では `review` source を register し、Code Review finding source、review tool、review workflow を登録している。`review-flow-enabled` feature flag により enable/disable され、無効時は findings を clear する。

Review 結果は `submit-review-findings` tool から Findings panel に送られる。tool は path / startLine / endLine / title / severity / category / suggestion などを VSCode URI と range に変換し、Bob Findings panel に focus する。

専用拡張では、Review workflow は次の 3 層で作るべきである。

1. SCM / GitHub issue から review target を作る。
2. Agent に diff / issue context を渡して finding JSON を生成する。
3. Findings manager に push し、Fix / Investigate action を用意する。

## 13. Git / SCM / Attribution

Git-dependent features は `vscode.git` API が利用可能になってから初期化される。確認できる要素:

- commit generation manager
- review source / workflow
- PR workflow / create pull request tool
- attribution source
- branch change listener
- push listener
- Git notes sync / push

Commit generation は SCM inputBox を spinner 表示にし、repository root ごとに token source / in-progress state を持つ。`bob-code.commitGenerationInProgress` context key を更新して、Generate / Cancel command の表示を切り替える。

Attribution は Bob の edit tool 実行結果を store し、commit / branch / push に反応して notes を扱う。

専用拡張の基盤としては、Git API unavailable を正常系として扱い、Git dependent feature を遅延初期化する設計が必要である。

## 14. Code actions / Editor / Explorer / Terminal

### 14.1 Code actions

bundle には CodeActionProvider があり、QuickFix として以下を作る。

- Fix with Bob
- Explain with Bob
- Improve with Bob

command handler は選択範囲または diagnostics から prompt を作り、`startTask({ content, mode, workspaceFolder })` を呼ぶ。

| command | mode | prompt 概要 |
| --- | --- | --- |
| `bob-code.explainCode` | `ask` | 選択コードを説明 |
| `bob-code.fixCode` | `agent` | diagnostics を含めて修正 |
| `bob-code.improveCode` | `agent` | readability / performance / best practices 改善 |

### 14.2 Add to Context

`bob-code.addToContext` は Chat view に focus し、active chat manager の `insertPastedText` へ選択文字列と file/range label を渡す。task が無い場合や chat view が無い場合は warning を出す。

### 14.3 Explorer commands

`bob-code.explainFile` / `bob-code.explainFolder` は、relative path から `Explain the file: <path>` / `Explain the folder: <path>` という task content を作り、mode `ask` で task を開始する。

### 14.4 Terminal buffer

Terminal listener は `onDidStartTerminalShellExecution` を使い、active terminal の直近 commandLine と output を最大 16KB 程度で保持する。これが task context や terminal action に使われる。

専用拡張では、terminal context は常時全ログを保持せず、active terminal の直近出力をサイズ上限付きで保持する方式が安全である。

## 15. Tree-sitter / tokenizer / document support

ZIP には多数の `tree-sitter-*.wasm` と `tiktoken` 関連ファイルが含まれる。activation では `TreeSitterService(dist)` を初期化して global に set している。

source map からも以下が見える。

- `services/tree-sitter/queries/**`
- `TreeSitterService`
- `core/context-tracking/FileContextTracker`
- `core/context-management/**`
- `single-file-read-models`
- `exceljs`
- `pdfjs-dist`
- `dist/workers/countTokens.js`

これは、Bob が file read/search だけでなく、symbol overview、token counting、PDF / XLSX / document context などを扱うための基盤を bundle 内に持っていることを示す。

専用拡張でも、C/C++ 大規模保守向けには Tree-sitter / symbol overview / token budget 管理を最初から考慮すべきである。

## 16. Bob 専用拡張への設計更新

前回の基盤案を、実装寄りに更新すると次になる。

```text
activation/
  activate.ts
  registerContextKeys.ts
  registerCommands.ts
  registerCodeActions.ts
  registerGitDependentFeatures.ts

runtime/
  BobRuntime.ts
  BobSourceRegistry.ts
  BobTaskManager.ts
  PersistentTaskStore.ts
  AgentSession.ts
  ToolRuntime.ts
  ModeRegistry.ts
  SkillRegistry.ts

webview/
  BaseWebviewProvider.ts
  CommonWebviewManager.ts
  ChatWebviewProvider.ts
  SettingsWebviewProvider.ts
  FindingsWebviewProvider.ts
  ReviewWebviewProvider.ts
  WebviewMessageRouter.ts

mcp/
  McpConfigManager.ts
  McpHub.ts
  BobMcpTool.ts
  McpServerSnapshot.ts

security/
  ApprovalPolicy.ts
  CommandSecurityVerifier.ts
  BobIgnore.ts
  PathUsageAnalyzer.ts

findings/
  FindingsManager.ts
  ReviewFindingSource.ts
  RefactorFindingSource.ts
  DevSecOpsFindingSource.ts
  FindingActions.ts

review/
  ReviewWorkflow.ts
  ReviewWebviewBridge.ts
  GitChangeService.ts
  GitHubIssueService.ts
  SubmitReviewFindingsTool.ts

scm/
  CommitGenerationManager.ts
  PullRequestWorkflow.ts
  AttributionStore.ts

context/
  TreeSitterService.ts
  ContextPack.ts
  FileContextTracker.ts
  TokenCounterWorker.ts
  DocumentReader.ts
```

## 17. 最小実装 MVP の見直し

ZIP 実装を踏まえると、MVP は単なる chat panel ではなく、次の順番が現実的である。

### MVP-1: activation / webview / task shell

- `onStartupFinished`
- Chat webview
- persistent task store
- `openTask` / `startTask`
- `bobBuiltin.hasRequestsWaiting` context key
- editor selection -> task start

### MVP-2: registry / mode / tool runtime

- source registry
- built-in modes: `agent`, `plan`, `ask`
- tool groups: read/edit/execute/mcp/skill/todo/subagent/mode
- mode-based tool allow/deny
- structured message builder

### MVP-3: command security / approval

- allowed/denied commands
- `.bobignore`
- command security local heuristic
- optional LLM verifier
- approval UI

### MVP-4: Findings / Review

- Findings manager + panel
- Review panel: branch/issue mode, include uncommitted, file tree
- submit review findings tool
- Fix / Investigate actions

### MVP-5: MCP / settings

- `.bob/mcp.json` + global `mcp.json`
- McpHub
- tool disabled / alwaysAllow / timeout
- settings webview

## 18. clean-room 上の注意

ZIP 内の webview sourcemap には IBM Confidential header が含まれる source content がある。したがって、専用拡張を作る場合は、実装コードや UI ソースをコピーしない。

今回の分析で使うべきものは次に限定する。

- VSCode contribution として観察可能な構造
- 実行時に確認できる動作上の分割
- 公開ドキュメントと deep research の機能要件
- 一般的な VSCode extension API で再実装可能な設計パターン

コピーしてはいけないもの:

- IBM の source code
- IBM Confidential header 付き webview source
- minified bundle の実装断片
- prompt 本文の長文移植
- UI component の JSX / CSS 実装

## 19. 結論

ZIP 実体を見たことで、Bob 専用拡張の基盤は次のように更新される。

1. **Chat だけでは不足**。Chat / Findings / Review / Settings を持つ multi-webview extension として設計する。
2. **中心は Registry + Runtime**。tool / workflow / finding / mode / skill / MCP を source registry に差し込む構造が中核。
3. **task は永続化される単位**。message queue、history、cost、status、workspace、approval config を task metadata として持つ。
4. **command security は task env に入る**。後付け UI ではなく runtime meta と tool gate の一部。
5. **MCP は動的 BobTool**。config UI だけでなく tool registry へ変換される。
6. **Review は Findings と一体**。review output は chat ではなく structured findings として panel に集約する。
7. **Tree-sitter / token budget が基盤**。大規模コード解析には最初から symbol / token / context 管理が必要。
8. **Git dependent features は遅延初期化**。vscode.git が無い状態を正常系として扱う。

このため、`bob_builtin_analyze` で Bob 向け専用拡張を作るなら、最初に作るべきは LLM 呼び出しではなく、`ActivationCoordinator`、`BobSourceRegistry`、`PersistentTaskStore`、`BaseWebviewProvider`、`MessageBuilder`、`ApprovalGate`、`FindingsManager` の 7 点である。
