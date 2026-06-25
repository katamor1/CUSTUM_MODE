# Bob 向け専用 VSCode 拡張機能 基盤分析

調査日: 2026-06-26  
対象リポジトリ: `katamor1/bob_builtin_analyze`  
主な確認コミット:

- `ca23a93bf98c55daa068d9f7b8c76ddda4e2cf60` - Initial commit
- `428e948025ef58793c87d0e4536d907efb0ff63e` - base
- `e522936b51815c4cf54cfb3839cc5584bb1d12f1` - リサーチ
- `09f31bb6903f8d5aa82fc8cee632724e20e928d5` - 直前の調査メモ追加

## 1. 目的

`bob2/deep-research-report.md` の IBM Bob 2.0.0 調査結果と、base コミットに含まれる `bob2/bob-code` の VSCode 拡張マニフェスト等を読み、Bob 向け専用拡張機能を作るための基盤を分析する。

前回の調査メモでは `bob_builtin_analyze` を「空リポジトリ」と扱っていたが、これは誤りである。正しくは、`bob2/bob-code` 配下に IBM Bob 拡張のマニフェスト、ライセンス、アイコン、テーマ、ローカライズ等が存在する。ただし、調査時点で `package.json` が指す実行本体 `bob2/bob-code/dist/extension.js` は空ファイルとして取得され、実際の extension host 側 JS 実装は確認できなかった。

したがって、本分析は次の 2 層に分ける。

1. **確認済み事実**: `package.json`、`package.nls.json`、`package.nls.ja.json`、`deep-research-report.md` から読める拡張の構造と機能。
2. **基盤設計案**: IBM Bob の実装をコピーせず、Bob 向け専用拡張を clean-room で作る場合の構成。

## 2. `deep-research-report.md` から読む Bob 2.0.0 の方向性

`bob2/deep-research-report.md` は Bob 2.0.0 を、単なる機能追加ではなく、日常的な開発体験を以下の 4 方向で再設計した版として整理している。

- 並列化
- 管理容易化
- ガバナンス強化
- モダナイゼーション特化

特に重要な新機能・改善は次の通り。

| 分類 | 内容 | 専用拡張への示唆 |
| --- | --- | --- |
| サブエージェント | 独立コンテキストで探索・処理し、結果を要約で親へ戻す | task / subtask / result summary を分ける内部モデルが必要 |
| メッセージキュー | 実行中の agent を止めずに追加指示をキューできる | VSCode 側で task queue と pending input を管理する必要 |
| MCP 管理 UI | global/project の `mcp.json` と tool enable/disable を UI 管理 | `.bob/mcp.json` と UI の双方向同期が必要 |
| Review workflow | `/review` または panel から差分レビューを行う | SCM API、diff 取得、Findings panel、issue coverage の基盤が必要 |
| Workspace mode 管理 | global/project の custom mode を管理 | `.bob/custom_modes.yaml` と mode registry が必要 |
| Skills settings | Skills を UI で管理 | skill manifest / supporting files の一覧・有効化 UI が必要 |
| 3 モード再編 | Agent / Plan / Ask に集約 | 拡張 UI は mode を前提に prompt / permission を切替えるべき |
| 270k context | 長い作業を扱いやすくする | ただし拡張側は raw file 丸投げではなく context pack 化が必要 |
| 並列ツール実行 | file read/search 等を同時実行 | command runner / search runner の非同期化が必要 |
| 承認 UX 強化 | コマンド編集、逐次承認、preview 折りたたみ | approval gate を UI コンポーネントとして分離する必要 |
| `.docx` / `.pdf` / `.xlsx` 対応 | 設計書を直接扱う | document reader / artifact summary が基盤機能になる |
| command security | コマンド実行前の検査 | 実行前ポリシー、deny/allow、LLM security check が必要 |

このレポートから見ると、Bob 専用拡張は「LLM に質問するだけのチャット拡張」では足りない。必要なのは、タスク、モード、承認、MCP、レビュー、成果物、履歴を VSCode 上で統合する **agent runtime shell** である。

## 3. base コミットの `bob2/bob-code` 構造

### 3.1 コミット履歴上の位置づけ

`428e948025ef58793c87d0e4536d907efb0ff63e` は `ca23a93bf98c55daa068d9f7b8c76ddda4e2cf60` の 1 つ後のコミットで、`bob2/bob-code` 配下に多数のファイルを追加している。

確認できた代表ファイル:

- `bob2/bob-code/LICENSE.txt`
- `bob2/bob-code/package.json`
- `bob2/bob-code/package.nls.json`
- `bob2/bob-code/package.nls.ja.json`
- `bob2/bob-code/dist/extension.js`
- `bob2/bob-code/dist/extension.js.map`
- `bob2/bob-code/assets/icons/*`
- `bob2/bob-code/assets/codicons/*`
- `bob2/bob-code/assets/themes/bob-theme.json`
- `bob2/bob-code/assets/vscode-material-icons/**`

### 3.2 実行本体についての確認結果

`package.json` の `main` は `./dist/extension.js` である。

しかし、GitHub から `bob2/bob-code/dist/extension.js` と `bob2/bob-code/dist/extension.js.map` を取得した結果、どちらも空ファイルとして返ってきた。

このため、現時点のリポジトリだけでは、以下の実装詳細は確認できない。

- `activate(context)` の中身
- command handler の登録処理
- webview provider 実装
- authentication provider 実装
- API client 実装
- task queue 実装
- MCP / mode / skills 管理 UI の実装
- review workflow の実行ロジック
- findings panel の state 管理

一方、`package.json` とローカライズファイルから、拡張機能として VSCode にどう見えるか、どの機能を提供しようとしているかはかなり読める。

## 4. `package.json` から読む実際の拡張機能構造

### 4.1 基本情報

`bob2/bob-code/package.json` の主要項目は次の通り。

| 項目 | 値 |
| --- | --- |
| `name` | `bob-code` |
| `publisher` | `IBM` |
| `displayName` | `IBM Bob` |
| `version` | `2.0.0` |
| `engines.vscode` | `^1.106.1` |
| `activationEvents` | `onStartupFinished` |
| `main` | `./dist/extension.js` |
| repository | `https://github.com/ibm/bob.git`, directory `bob-extension` |

ここから、Bob はユーザーが明示コマンドを実行するまで遅延ロードする拡張ではなく、VSCode 起動完了時に常駐を開始する設計と読める。チャット、履歴、認証状態、キュー、レビュー通知などを常時管理する必要があるため、この設計は自然である。

### 4.2 Authentication contribution

`contributes.authentication` に次が定義されている。

```json
{
  "id": "bobLogin",
  "label": "Bob"
}
```

これは VSCode の Authentication Provider として Bob ログインを扱う構成である。Bob 専用拡張でも、外部 Bob API / 社内 API / GitHub / MCP などに接続するなら、認証を command handler 内に散らさず、`AuthenticationProvider` 相当の層に集約するのがよい。

### 4.3 Views / Containers

`viewsContainers` と `views` から、UI は次の 3 面で構成されている。

| 場所 | View ID | 内容 |
| --- | --- | --- |
| secondary sidebar | `bobChatView` | Chat webview |
| panel | `bobFindingsView` | Bob Findings webview |
| SCM view | `bobReviewView` | Review webview |

つまり Bob は単一チャットではなく、少なくとも次の 3 ペインを持つ。

1. **Chat**: task 実行、会話、context、workflow 起動。
2. **Findings**: review / scan / tips / issue の一覧。
3. **Review**: SCM と連動したレビュー実行・設定。

Bob 専用拡張を作るなら、最小構成でも Chat と Findings を分けるべきである。レビュー結果を chat text に混ぜるだけにすると、Bob 2.0.0 の review workflow / findings 管理と相性が悪い。

### 4.4 Commands

`package.json` で確認できる command は次の通り。

| command | 用途 |
| --- | --- |
| `bob-code.task.history` | task history 表示 |
| `bob-code.task.historyWithNotification` | 未処理通知付き task history |
| `bob-code.openSettings` | Settings を開く |
| `bob-code.task.export` | Task History export |
| `bob-code.task.import` | Task History import |
| `bob-code.task.wipe` | Chat History clear |
| `bob-code.task.pickWorkspace` | New Task |
| `bob-code.task.pickWorkspaceInEditor` | editor 内 New Task |
| `bob-code.task.exportCurrent` | Current Task export |
| `bob-code.task.workflow` | Start Workflow |
| `bob-code.explainFile` | Explorer file 説明 |
| `bob-code.explainFolder` | Explorer folder 説明 |
| `bob-code.explainCode` | 選択コード説明 |
| `bob-code.improveCode` | 選択コード改善 |
| `bob-code.addToContext` | 選択コードを context 追加 |
| `bob-code.generateCommitMessage` | SCM commit message 生成 |
| `bob-code.cancelCommitGeneration` | commit message 生成 cancel |
| `bob-code.createPullRequest` | Pull Request 作成 |
| `bob-code.reviewView.openSettings` | review view settings |
| `bob-code.reportIssue` | Issue report |

ここから、実際の拡張は次のユースケースを中心にしていると読める。

- task 単位の chat / workflow 実行
- editor selection 起点のコード説明・改善・context 追加
- explorer file/folder 起点の説明
- SCM 起点の commit message 生成と PR 作成
- review panel / findings panel 起点のレビュー管理
- settings / import / export / wipe など運用管理

### 4.5 Menus

menus は VSCode の複数 UI 面に散っている。

| menu | 役割 |
| --- | --- |
| `view/title` | Chat view 上部の Workflow / Settings / Tasks / New Task |
| `bob-code.moreOptions` | task picker / current task export |
| `editor/context` | 選択コード右クリックから Bob submenu |
| `bob-code.editorActions` | Explain / Improve / Add to Context |
| `explorer/context` | file/folder 右クリックから Explain |
| `scm/title` | Commit Message / Cancel / Create Pull Request |
| `commandPalette` | workflow などの表示制御 |

専用拡張でも、入口は command palette だけにせず、**ユーザーがいる場所に Bob 操作を出す** べきである。特に C/C++ 保守開発では、Explorer のファイル単位、Editor の選択範囲、SCM の差分単位が主要な入口になる。

### 4.6 Context keys

`when` 条件から、少なくとも次の context key が使われる。

- `bob-code.hasWorkflows`
- `bob-code.hasRequestsWaiting`
- `bob-code.commitGenerationInProgress`

このことから、extension host 側には VSCode の `setContext` を使った UI 状態同期があるはずである。

Bob 専用拡張では、少なくとも次の context key が必要になる。

- `bobBuiltin.hasActiveTask`
- `bobBuiltin.hasQueuedMessages`
- `bobBuiltin.hasFindings`
- `bobBuiltin.reviewInProgress`
- `bobBuiltin.commitGenerationInProgress`
- `bobBuiltin.modeSelected`
- `bobBuiltin.workspaceTrusted`
- `bobBuiltin.mcpConfigured`

## 5. `package.nls.ja.json` から読む追加・潜在機能

`package.nls.ja.json` には、`package.json` の command 一覧より広い機能名・設定名が含まれている。ローカライズ文字列だけでは command が実際に登録されている証拠にはならないが、設計意図や関連モジュールの存在を推測する材料になる。

確認できる代表要素:

| 分類 | 文字列から読める機能 |
| --- | --- |
| 基本 UI | New Task、MCP servers、Modes、History、Marketplace、Cloud、Settings、Documentation |
| Editor 操作 | Explain Code、Fix Code、Improve Code、Add to Context |
| Terminal 操作 | terminal content add to context、command fix、command explain |
| 入力操作 | focus input、accept input / suggestion |
| Auto approve | auto approve toggle、allowed / denied commands、timeout allowlist |
| Storage | custom storage path、settings import、reset state |
| File search | indexed files upper limit |
| Agent rules | `AGENTS.md` 読み込み |
| Review | review code changes、review exclusions、review issue commands、mark resolved/open/ignored、fix/investigate issue |
| Security scan | Semgrep toggle、Secrets scan toggle |
| Findings | Semgrep、secrets、Bob Tips |
| Shell security | `ibm-bob-config.commandSecurityMode` |
| Code completion | autocomplete / next edit / off |
| Logging | log level |
| Bob Shell | `command.runBobshell.title` |
| `.bobignore` | add to `.bobignore` |

この文字列群は、Bob 2.0.0 deep research report の内容とよく対応している。

- MCP 管理
- Modes 管理
- command security
- review workflow
- findings / scans
- code completion
- `.bobignore`
- AGENTS.md
- auto approval

Bob 専用拡張の基盤では、これらを一度に実装するのではなく、**設定モデルだけ先に設計** しておくのが重要である。UI 実装を後回しにしても、設定キーと policy 判定を先に固めると後続が安定する。

## 6. 既存 Bob 拡張の動作モデル推定

実行 JS が空のため実装コードの確証はないが、VSCode contribution から動作モデルは次のように推定できる。

```text
VSCode startup
  -> activate extension onStartupFinished
  -> register authentication provider: bobLogin
  -> create webview providers
       - bobChatView
       - bobFindingsView
       - bobReviewView
  -> register commands
       - task/history/import/export/workflow/new task
       - editor explain/improve/add context
       - explorer explain file/folder
       - scm commit message / PR
       - settings / report issue
  -> set VSCode context keys
       - hasWorkflows
       - hasRequestsWaiting
       - commitGenerationInProgress
  -> webview <-> extension host message bridge
       - user input
       - task state
       - context refs
       - approval requests
       - findings updates
  -> service layer
       - auth/session
       - task queue
       - context collector
       - command executor
       - review runner
       - SCM integration
       - settings/mode/MCP manager
```

## 7. Bob 専用拡張の clean-room 基盤設計

IBM Bob の製品コードはライセンス対象であり、実行本体もこのリポジトリからは確認できない。そのため、専用拡張は IBM のコードをコピー・逆コンパイルするのではなく、VSCode の extension contribution と Bob 2.0.0 の公開機能要件を参考に clean-room で作るべきである。

### 7.1 推奨パッケージ構成

```text
bob_builtin_analyze/
  package.json
  tsconfig.json
  src/
    extension.ts
    activation/
      registerCommands.ts
      registerViews.ts
      registerContextKeys.ts
    auth/
      BobAuthProvider.ts
      SessionService.ts
    ui/
      ChatViewProvider.ts
      FindingsViewProvider.ts
      ReviewViewProvider.ts
      WebviewMessageRouter.ts
    tasks/
      TaskStore.ts
      TaskQueue.ts
      AgentSession.ts
      MessageQueue.ts
    context/
      WorkspaceContextCollector.ts
      SelectionContextCollector.ts
      FileContextCollector.ts
      BobIgnore.ts
      ContextPack.ts
    modes/
      ModeRegistry.ts
      CustomModesYaml.ts
      AgentRulesLoader.ts
    mcp/
      McpConfigService.ts
      McpToolRegistry.ts
      McpApprovalPolicy.ts
    approvals/
      ApprovalGate.ts
      CommandPolicy.ts
      CommandSecurityChecker.ts
    review/
      ReviewWorkflow.ts
      GitDiffService.ts
      FindingsStore.ts
      IssueCoverageService.ts
    scm/
      CommitMessageService.ts
      PullRequestService.ts
    llm/
      MessageBuilder.ts
      ResponseParser.ts
      ProviderAdapter.ts
    storage/
      ExtensionStorage.ts
      ImportExportService.ts
    logging/
      Logger.ts
  webview/
    chat/
    findings/
    review/
  docs/
```

### 7.2 最小 manifest 案

最初から IBM Bob と同じ機能量を目指すと重すぎるため、最小 manifest は次でよい。

- activation: `onStartupFinished`
- views:
  - `bobBuiltinChatView`
  - `bobBuiltinFindingsView`
- commands:
  - `bobBuiltin.newTask`
  - `bobBuiltin.openSettings`
  - `bobBuiltin.explainCode`
  - `bobBuiltin.improveCode`
  - `bobBuiltin.addToContext`
  - `bobBuiltin.reviewChanges`
  - `bobBuiltin.generateCommitMessage`
- menus:
  - editor/context
  - explorer/context
  - scm/title
  - view/title
- configuration:
  - allowedCommands
  - deniedCommands
  - commandSecurityMode
  - customModesPath
  - mcpConfigPath
  - useAgentRules
  - maximumIndexedFilesForFileSearch

### 7.3 MessageBuilder の責務

Bob 2.0.0 の deep research と前回の mode-pack 調査を合わせると、MessageBuilder は自然文を直接 LLM へ投げる部品ではなく、次の構造化 packet を作る部品にするのがよい。

```text
User action
  -> EntryRouteDecision
  -> EntryRequestPacket
  -> SessionScopeGate
  -> EntryDispatchPacket
  -> Agent/Tool execution
  -> EntryResponse
```

VSCode では user action が複数ある。

| 入口 | request type | context |
| --- | --- | --- |
| chat input | generation / review / diff / eval | conversation + workspace |
| editor selection | explain / improve / add_context | selected text + file ref |
| explorer file | explain_file | file ref + summary |
| explorer folder | explain_folder | file tree summary |
| SCM title | commit_message / pr | git diff summary |
| review view | review | branch diff / issue |

MessageBuilder は、入口差を吸収して同じ packet model に正規化する。

### 7.4 ContextPack の方針

Bob 2.0.0 は大きな context window を持つが、専用拡張では raw file を無制限に詰め込まない。

ContextPack は次だけを基本とする。

- workspace root logical id
- relative path
- file hash
- language id
- selected range
- symbol name
- summary
- allowed / denied reason
- source kind: `editor_selection`, `file`, `folder`, `git_diff`, `terminal`, `docx`, `pdf`, `xlsx`

禁止するもの:

- 絶対パスの無制限投入
- secret らしき値
- binary body
- DOCX/PDF/XLSX の全文丸投げ
- 大きな raw patch

### 7.5 ApprovalGate の方針

Bob 2.0.0 の特徴は自動化と承認制御の両立である。専用拡張でも command 実行は必ず ApprovalGate を通す。

判定順序:

1. denied prefix match
2. allowed prefix match
3. commandSecurityMode
4. task-level approval setting
5. user confirmation
6. execution
7. audit log

`commandSecurityMode` は少なくとも次の 3 値を持つ。

- `off`
- `autoApprovalOnly`
- `allCommands`

### 7.6 Review / Findings の方針

Bob 2.0.0 の review workflow は専用 panel と Findings を持つ。専用拡張でも review 結果は chat の自然文ではなく structured finding にする。

Finding model の例:

```json
{
  "id": "BF-0001",
  "source": "review",
  "severity": "warning",
  "status": "open",
  "file": "src/foo.c",
  "range": { "startLine": 120, "endLine": 128 },
  "title": "境界条件の未確認",
  "evidenceRef": "git-diff:...",
  "suggestedAction": "入力値が上限一致するケースを追加する"
}
```

Findings view では次を提供する。

- open / resolved / ignored
- fix issue
- investigate issue
- refresh
- filter by source/severity/status

### 7.7 Modes / Skills / MCP の方針

Bob 専用拡張では、最初から完全 UI を作らなくても、次の config files を正本にできるようにする。

| 対象 | 既定候補 |
| --- | --- |
| modes | `.bob/custom_modes.yaml` |
| MCP | `.bob/mcp.json` |
| ignore | `.bobignore` |
| agent rules | `AGENTS.md` |
| skills | `.bob/skills/` または `.bob/skills.json` |

UI はこの正本を編集する薄い wrapper にする。

## 8. 実装ロードマップ

### Phase 0: 現状リポジトリ修正

- 前回の「空リポジトリ」記述を修正する。
- `bob2/bob-code/dist/extension.js` が空であることを明記する。
- IBM 製品コードの clean-room 方針を明記する。

### Phase 1: VSCode 拡張の最小骨格

- `package.json`
- `src/extension.ts`
- `ChatViewProvider`
- `FindingsViewProvider`
- `registerCommands`
- `registerContextKeys`

ゴール:

- VSCode に Chat view が出る。
- editor selection から Explain command が呼べる。
- message packet preview を webview に表示できる。

### Phase 2: Context / Message 基盤

- `ContextPack`
- `.bobignore` reader
- `MessageBuilder`
- `EntryRouteDecision`
- `EntryRequestPacket`
- `EntryDispatchPacket`

ゴール:

- raw text ではなく structured packet を生成する。
- file / selection / git diff を同じ形式で扱える。

### Phase 3: Task / Queue 基盤

- `TaskStore`
- `TaskQueue`
- `AgentSession`
- `MessageQueue`
- import/export/wipe

ゴール:

- Bob 2.0.0 的な「実行中に追加指示を受ける」構造を再現できる。

### Phase 4: Approval / Command Security

- allowed / denied commands
- command timeout
- command security mode
- approval UI
- audit log

ゴール:

- コマンド実行前の承認と検査を必ず通せる。

### Phase 5: Review / Findings

- Git diff service
- Review workflow command
- Findings store
- Findings webview
- SCM title integration

ゴール:

- `/review` 相当の差分レビューを専用 panel に出せる。

### Phase 6: Modes / MCP / Skills

- `.bob/custom_modes.yaml` reader/writer
- `.bob/mcp.json` reader/writer
- `AGENTS.md` loader
- skills registry

ゴール:

- Bob 2.0.0 の workspace governance を再現する。

## 9. 重要な注意点

### 9.1 IBM Bob 実装コードはコピーしない

`bob2/bob-code/LICENSE.txt` は IBM Bob のライセンス文書である。専用拡張を作る場合は、IBM の実装をコピー・逆コンパイル・移植するのではなく、VSCode extension API と公開仕様・観察可能な manifest をもとに clean-room 実装にする。

### 9.2 現リポジトリだけでは実装ロジックの確認は不完全

`package.json` から拡張の contribution は確認できるが、`dist/extension.js` が空であるため、実際の実装ロジックは確認できない。

したがって「実際の拡張機能としてどう動くか」は、次の粒度までが確認済みである。

- VSCode でどの view / command / menu / auth provider を提供するか
- どの UI 面から Bob 操作を起動するか
- どの設定・レビュー・セキュリティ機能が設計対象になっているか

未確認であるもの:

- command handler の中身
- webview message protocol
- API request schema
- task queue persistence
- MCP server execution code
- review finding generation logic
- command security LLM call の実装

### 9.3 `package.nls.ja.json` は補助証拠として扱う

`package.nls.ja.json` には多くの機能名・設定名があるが、ローカライズ文字列だけでは実装済み・有効化済みとは断定できない。manifest に載る command / view / menu を優先し、nls は潜在設計範囲として扱う。

## 10. 基盤分析の結論

Bob 向け専用拡張の中核は、LLM 呼び出しそのものではなく、次の 6 つの基盤である。

1. **VSCode UI 統合**: Chat / Findings / Review の 3 面構成。
2. **Task runtime**: task history、message queue、subtask、session state。
3. **Context management**: editor / explorer / SCM / terminal / documents を安全な ContextPack にする。
4. **Governance**: modes、MCP、skills、`.bobignore`、AGENTS.md、approval policy。
5. **Review workflow**: diff、findings、issue coverage、fix / investigate。
6. **Message pipeline**: user action を structured packet に正規化して agent / tool に渡す。

この基盤を先に作れば、後から Bob 2.0.0 的なサブエージェント、MCP 管理、Review workflow、Premium Package 的なドメイン特化処理を追加しやすい。
