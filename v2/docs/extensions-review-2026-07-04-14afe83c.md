# extensions 配下 3 拡張機能レビュー

- 対象リポジトリ: `katamor1/bob_builtin_analyze`
- 対象 ref: `14afe83c2218d881a9cd7b17b68b837c53507114`
- レビュー日: 2026-07-04
- 対象拡張:
  - `extensions/workflow-register`
  - `extensions/bob-bazaar-review`
  - `extensions/bob-code-consistency-review`

## 0. レビュー方法と前提

本レビューは GitHub 上のソース、README、`package.json`、主要実装、テスト配置を対象にした静的レビューである。VS Code Extension Host 上での実行、IBM Bob 本体との実接続、`npm install` / `npm test` / `npm audit` はこのレビュー内では実行していない。

重点観点は以下。

- アーキテクチャと責務分離
- ワークフロー登録・拡張間連携
- コマンド実行・MCP・外部プロセス呼び出しの安全性
- 入力検証、パス境界、ワークスペース外アクセス
- Webview CSP と postMessage 境界
- Bob/AI 出力の検証と永続化
- 生成物・スナップショットに含まれる機密情報
- テスト容易性、保守性、運用性

## 1. 総評

3 拡張は、README と実装の対応が比較的明確で、機能ごとの分割も進んでいる。特に `workflow-register` の core/VS Code bridge 分離、`bob-bazaar-review` の Bazaar CLI ラッパー、`bob-code-consistency-review` の review package pipeline は読みやすく、テスト対象も多い。

一方で、3 拡張すべてが「ローカル workspace 上のワークフロー」「Bob/AI が扱う文脈」「外部コマンド」「生成物ファイル」をまたぐため、通常の VS Code 拡張よりも信頼境界が多い。現在の実装は、基本的な `execFile` 利用や Webview CSP、workspace 内 file sink など良い対策が入っている反面、以下は優先して締めるべき。

1. `workflow-register` の command guardrail が provider ID だけを見ており、`vscode.executeCommand` の実コマンド ID を制御できない。
2. `workflow-register` の task snapshot が Bob の message / metadata / export / last assistant text をデフォルト保存し得る。
3. `bob-bazaar-review` の MCP server が任意 `cwd` を受け取り、server 側で allowed workspace root を持たない。
4. `bob-code-consistency-review` の入力/出力パス解決が複数箇所で absolute path を許容し、ワークスペース境界が一貫しない。
5. `bob-code-consistency-review` の Git/Bazaar revision 入力は `execFile` で shell injection は避けているが、CLI option injection / revision validation がまだ弱い。

## 2. 優先度付き指摘一覧

Severity は次の意味で使う。

- High: セキュリティ、機密情報、任意コマンド/任意パスへの影響がある。
- Medium: 事故・誤用・DoS・誤結果につながる可能性がある。
- Low: 保守性・再現性・開発者体験の改善。

| ID | Severity | 対象 | 指摘 | 影響 | 推奨対応 |
|---|---:|---|---|---|---|
| WR-01 | High | workflow-register | command guardrail が `providerId` だけを検証し、`vscode.executeCommand` の実 command ID を見ない | workflow が `vscode.executeCommand` を許すと、想定外の VS Code command を実行できる | guardrail に effective command ID を渡す。`vscode.executeCommand` は exact command allowlist を必須にする |
| WR-02 | High | workflow-register | task snapshot が message / metadata / task export / last assistant text をデフォルト保存する | Bob 会話、コード断片、社内文書、secret が `.bob/workflows/runs` に残る | `includeMessages` を default false。redaction hook、secret scan、明示 opt-in、`.gitignore` / docs を追加 |
| BBR-01 | High | bob-bazaar-review | MCP tools が任意 `cwd` を受け取り、allowed workspace root を server 側で検証しない | Bob/LLM 経由で任意のアクセス可能な Bazaar repo や `.bob/review` を読める/一部書ける | MCP config に allowed roots を渡し、server 側で `cwd` を検証。`project_rules_init` も制限 |
| CCR-01 | High | bob-code-consistency-review | Git/Bazaar revision 値が十分に検証されず、そのまま CLI args に入る | shell injection ではないが、Git option injection や異常 revision 指定で予期せぬ動作が起きる | Git rev は `rev-parse --verify --end-of-options` で SHA に解決してから使う。Bazaar rev は `validateRevision` 相当を共有 |
| CCR-02 | High | bob-code-consistency-review | absolute path を許容する path resolver が多く、読み書きの workspace 境界が一貫しない | workflow args/config/hand-written input から workspace 外のファイルを読んだり書いたりできる | shared `resolveWorkspacePathStrict` を導入し、外部 path は explicit opt-in にする |
| CCR-03 | Medium | bob-code-consistency-review | `.docx` / `.xlsx` 抽出と raw diff / excerpts にサイズ・行数上限が薄い | 大きな文書や spreadsheet で処理時間・メモリ・Bob prompt サイズが膨らむ | file size、sheet count、row count、chunk bytes、raw diff bytes の上限と truncation warning を追加 |
| BBR-02 | Medium | bob-bazaar-review | `maxDiffBytes` / `maxAddedFileContentBytes` を runtime clamp していない | workspace settings などで極端値を入れると memory pressure や空 packet の原因になる | config getter で min/max/finite を強制し、UI 設定だけに頼らない |
| BBR-03 | Medium | bob-bazaar-review | `collectReviewContext` が開いている全 document から marker 文字列一致で packet を拾う | 複数 packet が開いていると古い/別対象の packet を workflow に渡す可能性 | 生成時 URI/runId を保持する、または workflow state で packet artifact path を明示する |
| WR-03 | Medium | workflow-register | workflow builder の edit mode が `editingFilePath` をそのまま保存対象にする | 呼び出し側バグや将来変更で `.bob/workflows/*/WORKFLOW.md` 以外に書ける余地 | edit mode でも workflow root / file pattern を再検証 |
| BBR-04 | Low | bob-bazaar-review | Webview nonce が `Date.now()` | CSP はあるが nonce 予測性が高い | `workflow-register` / code consistency と同じランダム nonce にする |
| WR-04 | Low | workflow-register | workflow name 正規化が Windows 予約名や trailing dot 等を考慮しない | 一部 OS で扱いづらい folder/file 名になる | reserved name / trailing dot / trailing space を除外 |
| ALL-01 | Low | all | lockfile / audit / SBOM の運用が見えない | VSIX build の再現性と supply-chain 監査が弱い | lockfile を導入し、CI で `npm audit` / license check / VSIX build を行う |

## 3. 拡張別レビュー

## 3.1 `workflow-register`

### 役割

`.bob/workflows/*/WORKFLOW.md` を検出・検証し、IBM Bob の source/workflow として登録する基盤拡張。workflow 実行、ステップ状態、manual/review gate、AI/command/result step、result sink、GUI authoring、diagnostics を担当する。

### 良い点

- `src/core` と VS Code 依存層の分離が進んでいる。`WorkflowEngine`、`ActionRegistry`、`ResultSinkRegistry`、`RunStateStore`、`TaskSnapshotStore` が個別にテストしやすい。
- `WorkflowRegisterService` が `.bob/workflows/*/WORKFLOW.md` を watcher で追跡し、reload / register をまとめている。
- Public API として `registerActionProvider` / `registerAgentProvider` / `registerResultSink` を提供し、他拡張から workflow step を拡張できる。
- `ResultSinkRegistry` の file sink は `path.relative(root, target)` で workspace escape を検出しており、result file 書き込みの基本線は安全。
- command result sink は default allowlist が `bobBazaar.captureReviewResult` のみで、result handoff 側はかなり限定的。
- `FileRunStateStore` は `.bob/workflows/runs/<runId>/run.json` に atomic write しており、中途半端な run state を残しにくい。
- Webview builder は `default-src 'none'`、nonce 付き script、`JSON.stringify` による model 注入で、基本的な CSP が入っている。
- テスト数が多い。parser、engine、result sink、snapshot、builder、recovery、registration などの周辺が対象になっている。

### WR-01: command guardrail が実コマンド ID を見ない

`createDefaultActionRegistry` は provider ID `vscode.executeCommand` を登録し、`input.args` の先頭要素を VS Code command ID として `executeCommand(command, ...args)` に渡す。ところが `validateCommandGuardrails` は `allowedCommands` / `deniedCommands` を `providerId` に対してだけ照合する。`executeCommandStep` も `step.action.provider` のみで guardrail を判定し、その後に render 済み args を provider に渡す。

つまり、workflow 側で `vscode.executeCommand` provider が許可されている、または guardrails が未設定の場合、実際にどの VS Code command を実行するかは YAML の args 次第になる。

影響:

- `.bob/workflows/*/WORKFLOW.md` が repository 由来である場合、workspace を開くだけで登録される workflow が command step を持てる。
- `vscode.executeCommand` を一度許可すると、`workbench.action.*`、他拡張 command、設定変更系 command など、意図しない command も呼べる可能性がある。
- shell injection ではないが、VS Code extension command は「ローカル権限を持つ拡張 API」として扱うべきで、provider ID 単位の許可では粗すぎる。

推奨:

1. `validateCommandGuardrails(workflow, step)` のように step 全体、または `providerId + renderedArgs` を受け取れる形に変更する。
2. `guardrails.allowedCommands` は provider ID 用として残しつつ、`allowedCommandIds` / `deniedCommandIds` を追加する。
3. `vscode.executeCommand` は default deny に近づける。少なくとも `args[0]` の exact match allowlist がない場合は失敗させる。
4. `workflow-register/test/actionRegistry.test.js` と `workflow-register/test/workflowEngineCommandAgent.test.js` へ、`vscode.executeCommand` の allow/deny テストを追加する。
5. README に「workflow はローカル自動化として扱い、trusted workspace 前提で使う」旨を明記する。

### WR-02: task snapshot の privacy risk

`FileTaskSnapshotStore` の snapshot payload は `messages`、`taskMetadata`、`taskExport`、`lastAssistantText`、handoff 情報を含められる。`createBobTaskSnapshotProvider` は Bob task から `getMessages()`、`getAllMetadata()`、`toSerializable()` を取り、デフォルト設定では `taskSnapshots.includeMessages = true` である。

影響:

- Bob 会話には、社内コード、diff、レビュー観点、設計書抜粋、認証情報、顧客情報が混ざる可能性がある。
- snapshot は workspace 配下 `.bob/workflows/runs/<runId>/task-snapshots` に保存されるため、誤コミット、バックアップ、共有ディレクトリ経由で露出し得る。
- `maxBytes` と `maxPerRun` はあるが、保存前の redaction は見当たらない。

推奨:

1. `taskSnapshots.includeMessages` の default を `false` にする。
2. 初回有効化時、または workflow run 開始時に「会話内容が workspace に保存される」警告を出す。
3. secret pattern redaction を保存直前に入れる。例: token / key / password / certificate block / private key / `.env` 風 key-value。
4. snapshot 保存先を workspace ではなく extension global storage にする option を検討する。
5. `.bob/workflows/runs` を ignore するテンプレート、または init command を用意する。
6. `taskSnapshots.test.js` に redaction / includeMessages=false / size truncation の regression test を追加する。

### WR-03: workflow builder edit mode の保存先再検証

`WorkflowBuilderPanel.targetUri()` は edit mode かつ `editingFilePath` がある場合、その file path をそのまま返す。通常は既存 `WORKFLOW.md` から開く想定なので問題化しにくいが、将来の呼び出し経路追加や不正な引数混入時に `.bob/workflows/*/WORKFLOW.md` 以外へ書ける余地がある。

推奨:

- edit mode でも `workflowRoot` 配下かつ `.bob/workflows/<name>/WORKFLOW.md` 形式であることを `save()` 前に検証する。
- 既存 file と serializer が生成する logical path が違う場合の warning は既にあるため、その手前に hard validation を追加する。

### WR-04: workflow 名の OS 互換性

`normalizeWorkflowName` は空白や特殊文字を `-` にし、先頭の `.` / `_` / `-` を落としている。path traversal は避けられているが、Windows 予約名、trailing dot / trailing space までは見ていない。

推奨:

- `CON`, `PRN`, `AUX`, `NUL`, `COM1` ... などの予約名を避ける。
- trailing dot / space を除去する。
- `workflowAuthoringSerializer.test.js` に追加する。

## 3.2 `bob-bazaar-review`

### 役割

Bazaar repository の revision / range / working tree 差分を Bob に渡す review packet として生成し、project rules、review result schema、result capture、MCP tools を提供する拡張。

### 良い点

- Bazaar CLI 呼び出しは `execFile` + `shell: false` で、shell injection を避けている。
- `--no-aliases` を常に付与し、Bazaar alias 経由のコマンド置換を抑止している。
- revision は `validateRevision`、file path は `validateRelativePath` で基本的な unsafe 文字や `..` を拒否している。
- `projectRules/io.ts` は project rule path の workspace escape を基本拒否し、外部 path は `BOB_BAZAAR_ALLOW_EXTERNAL_REVIEW_RULES=1` で明示 opt-in にしている。
- review-result JSON は validator で構造・semantic rules を確認し、`checklist_results` の完了数も workflow state から検証できる。
- Webview は CSP を持ち、表示値は `textContent` / DOM append を使っており、基本的な XSS 耐性はある。
- `workflow-register` との連携は optional にしており、未導入時も manual flow に落ちる。

### BBR-01: MCP server が任意 `cwd` を信頼する

MCP server の各 tool は `cwd` を input として受け取り、`bazaar_root` / `bazaar_diff_*` / `bazaar_cat_revision` などでそのまま BazaarClient へ渡す。`project_rules_init` は `cwd` 配下に `.bob/review` を作成できる。`configureWorkspaceMcpServer` は `BZR_PATH` と `BZR_TEXT_ENCODING` は渡すが、allowed workspace root は server に渡していない。

影響:

- Bob/LLM が tool call を作れる前提では、ユーザーが意図した workspace 以外の Bazaar repository も `cwd` に指定できる。
- 読み取り系であっても、アクセス可能な別 repository の log/diff/file content を取得できる。
- `project_rules_init` は read-only ではなく、任意 `cwd` 配下への `.bob/review` 作成を試みる。

推奨:

1. `.bob/mcp.json` 生成時に `BOB_BAZAAR_ALLOWED_ROOTS` または `BOB_BAZAAR_WORKSPACE_ROOT` を env に設定する。
2. MCP server 起動時に allowed root を `realpath` で正規化し、すべての `cwd` を `path.relative` で内側確認する。
3. Bazaar tools は `.bzr` marker または `bzr root` 結果が allowed root 配下であることを確認する。
4. project rules tools は `.bob` marker / allowed root 配下でのみ実行する。
5. `mcpServerVersion.test.js` だけでなく、MCP tool path boundary の unit test を追加する。

### BBR-02: diff size 設定の runtime clamp

`getMaxDiffBytes()` と `getMaxAddedFileContentBytes()` は VS Code configuration の数値をそのまま返す。`package.json` の contributes.configuration で minimum はあるが、workspace settings や programmatic 呼び出しで異常値が来た場合の防御は runtime 側にも置くべき。

推奨:

- `readBoundedNumber(config, key, default, min, max)` を導入する。
- `Number.isFinite`、integer 化、下限/上限 clamp を行う。
- `maxBuffer = Math.max(maxDiffBytes * 2, ...)` の overflow / 過大値を防ぐ。

### BBR-03: `collectReviewContext` の packet 選択が曖昧

`findReviewPacketText()` は active editor、visible editors、workspace.textDocuments を走査し、`# Bazaar Revision Review Request` と `## Bazaar diff` を含む最初の document を packet とみなす。複数 packet が開いている場合、古い packet や別 repository の packet を拾う可能性がある。

推奨:

- review packet 生成時に URI を extension state に保持する。
- workflow 連携では packet text を state / artifact path / run context に明示的に渡す。
- 複数候補がある場合は QuickPick で revision / repository / timestamp を表示する。

### BBR-04: Webview nonce の予測性

`reviewGuiHtml.ts` は nonce に `String(Date.now())` を使っている。CSP 自体は `default-src 'none'` と nonce script で良いが、nonce はランダムにする方がよい。

推奨:

- `workflow-register` / traceability prep と同じ 32 文字ランダム nonce にする。
- 可能なら `crypto.getRandomValues` 相当または Node `crypto.randomBytes` を使う。

## 3.3 `bob-code-consistency-review`

### 役割

要求・設計・テスト仕様などの文書と Git/Bazaar 差分から deterministic review package を生成し、Bob に渡す入力、Bob 出力 YAML の capture/validation、人間向け triage、traceability sidecar を提供する拡張。

### 良い点

- `extensionDependencies` で `IBM.bob-code` と `local.workflow-register` を明示しており、ワークフロー連携の前提が分かりやすい。
- review pipeline が `validateReviewInput` -> `collectGitDiff` -> `extractDocuments` -> `analyzeCppChanges` -> `buildTraceability` -> `buildReviewPackage` に分かれている。
- `review-input.schema.json`、`bob-output` schema、traceability validation により、AI 出力をそのまま信用せず検証する思想がある。
- `buildReviewInputFromDraft` では artifact path が workspace 外へ出ないか確認し、strict path mode で存在確認も行っている。
- traceability prep Webview は CSP と nonce を持ち、human approval gate の考え方が入っている。
- Bob 出力の evidence reference を `evidence-index.json` と照合しており、根拠 ID の幻覚を検出できる。

### CCR-01: Git/Bazaar revision の CLI option injection 余地

`collectStandardGitDiff` は `reviewInput.review.base` と `reviewInput.review.head` をそのまま `git diff --name-status base head`、`git diff --numstat base head`、`git diff --unified=80 base head` に渡す。`execFile` なので shell injection ではないが、Git は `-` で始まる引数を option として解釈する可能性がある。

また、Bazaar 側も `base..head` を組み立てて `bzr --no-aliases diff -r <range>` に渡しており、`bob-bazaar-review` にある `validateRevision` 相当の検証は見当たらない。`review-input.schema.json` の `base` / `head` は `minLength: 1` のみで、revision format は縛っていない。

推奨:

1. Git は `base` / `head` を直接 `git diff` に渡さず、まず `git rev-parse --verify --end-of-options <rev>^{commit}` で commit SHA に解決する。
2. `git diff` には解決済み SHA のみを渡す。
3. Bazaar は `bob-bazaar-review/src/bazaar.ts` の `validateRevision` を共有 package 化するか、同等の allowlist validation を入れる。
4. `review-input.schema.json` にも revision pattern を追加する。ただし Git rev syntax は広いので、schema は軽い防御、実検証は CLI 呼び出し前に行う。
5. `reviewPipeline.test.js` に `base: --output=/tmp/x` のような option injection regression を追加する。

### CCR-02: path 境界が一貫しない

`extensionCommandOptions.absolute()` と `core/fileSystem.resolveWorkspacePath()` は absolute path をそのまま返す。これにより、以下のような経路で workspace 外読み書きが可能になる。

- `runPreprocess` の `reviewInputPath` / `reviewPackagePath` / `diffFixturePath`
- `runCaptureBobOutput` の `bobOutputPath` / `packageDir`
- `runTriage` の `triagePath`
- `traceabilityCatalogStore.resolveCatalogPath`
- hand-written `review-input.yaml` の artifact path

一方で、`buildReviewInputFromDraft` では artifact path の workspace escape を防いでいる。この差が「GUI/AI draft から作った input は安全寄りだが、手書き input や workflow args は外へ出られる」という不一致を生む。

推奨:

1. `resolveWorkspacePathStrict(workspaceRoot, value, { allowExternal?: boolean })` を共通化する。
2. default は workspace 内のみ許可する。
3. external path を使う場合は、config と env の両方で明示 opt-in にする。例: `BOB_CODE_CONSISTENCY_ALLOW_EXTERNAL_PATHS=1`。
4. 出力系 path は特に厳格にする。`reviewPackagePath`、`bobOutputPath`、`triagePath`、`traceabilityCatalogPath` は workspace 配下 default に固定する。
5. `validateReviewInput` の `missingArtifactPaths` で、存在確認だけでなく workspace 内確認も行う。
6. path boundary unit test を `reviewInputValidator.test.js` / `traceabilityCatalogStore.test.js` / `reviewExecutionCommands` 周辺に追加する。

### CCR-03: 文書抽出と package 生成のサイズ制御

`documentExtractor` は Markdown を全読み、DOCX は `mammoth.convertToHtml({ path })`、XLSX は `XLSX.readFile()` で workbook 全体を読み、指定 sheets がない場合は全 sheet を処理する。`reviewPackageBuilder` は raw unified diff、document excerpts、code slices、Bob input を package に書き出す。

影響:

- 大きい `.xlsx` や `.docx` で VS Code Extension Host のメモリを圧迫する。
- `bob-input.md` が非常に大きくなり、Bob への投入に失敗しやすくなる。
- 生成物に設計書抜粋・コード全文・diff が含まれるため、target workspace の `.gitignore` が不十分だと誤コミットリスクがある。

推奨:

1. `maxDocumentBytes`、`maxWorkbookSheets`、`maxRowsPerSheet`、`maxExcerptBytes`、`maxRawDiffBytes` を設定化する。
2. truncation 時は `deterministic-checks.md` と manifest に warning を残す。
3. `.bob-review/` を target project の `.gitignore` に追加する init helper を用意する。
4. ZIP/XML 系 parser dependency は定期的に audit し、CI で dependency scan を行う。

### CCR-04: review package の機密情報取り扱い

`reviewPackageBuilder` は以下を生成する。

- `diff-context.md`: raw unified diff と code slices
- `document-excerpts.md`: 要求・設計・テスト仕様などの抜粋
- `bob-input.md`: Bob に渡す統合 prompt
- `input-normalized.json` / `changed-symbols.json` / `evidence-index.json` など

この repo の `.gitignore` には `/.bob-review/` があるが、拡張が使われる target project で同じ ignore が入っているとは限らない。

推奨:

- `initializeWorkspace` 時に `.gitignore` を確認し、`.bob-review/`、`.bob/workflows/runs/`、必要なら `.bob/review/results/` を追加する option を提供する。
- 生成完了 notification に「機密情報を含む可能性」を出す。
- README の運用節に、review package / Bob output / triage の取り扱いを明記する。

## 4. Cross-extension / architecture review

### 4.1 拡張間連携

`workflow-register` が action provider registry を提供し、`bob-bazaar-review` と `bob-code-consistency-review` が `registerActionProvider` で自拡張 command を workflow step として公開する構成は良い。特に `bob-code-consistency-review` は `extensionDependencies` で依存を明示しているため、activation ordering の不確実性が小さい。

`bob-bazaar-review` は workflow-register を optional にしており、未導入でも単体利用できる。この設計は実用的だが、optional integration の場合は workflow-register が後から導入/再起動された際の provider 再登録動線が弱くなりがちなので、`onDidChangeExtensions` 相当や retry/backoff を検討してもよい。

### 4.2 trusted workspace 前提の明文化

3 拡張とも workspace 内の Markdown/YAML から workflow や review input を読み、ローカル command / file read/write / Bob context 連携を行う。これは実質的に trusted workspace 前提の機能である。

推奨:

- README 冒頭に「信頼できる workspace でのみ workflow を実行する」注意を追加する。
- VS Code の Workspace Trust API に対応し、untrusted workspace では workflow 実行や external command を disable する。
- Workflow 実行前に、command step / MCP / file write を含む workflow の summary を表示する option を用意する。

### 4.3 生成物の ignore 方針

この repository では root `.gitignore` に `/.bob/*`、`!/.bob/workflows/*/WORKFLOW.md`、`/.bob-review/` が入っており、良い方針である。ただし拡張が他 project で使われる場合、この ignore 設定は自動では入らない。

推奨:

- `workflow-register` と `bob-code-consistency-review` の initializer で `.gitignore` 追記を提案する。
- 追記は自動ではなく、preview + confirmation にする。
- README に推奨 `.gitignore` snippet を載せる。

### 4.4 テストの状況と追加したいテスト

現状、3 拡張とも test directory があり、以下のような良い coverage が見える。

- `workflow-register`: parser、runtime、result sink、snapshot、webview builder、authoring、recovery、review steps
- `bob-bazaar-review`: Bazaar client、project rules path、workflow provider registration、MCP version、result capture、GUI initial target
- `bob-code-consistency-review`: review pipeline、document extraction、traceability catalog/store/webview、Bob output capture/triage、workflow provider registration

追加したい regression test:

- `workflow-register`: `vscode.executeCommand` の exact command allowlist / denylist。
- `workflow-register`: snapshot redaction と `includeMessages=false`。
- `bob-bazaar-review`: MCP allowed root 外 `cwd` の拒否。
- `bob-bazaar-review`: `maxDiffBytes` 異常値 clamp。
- `bob-bazaar-review`: 複数 review packet document が開いている時の選択。
- `bob-code-consistency-review`: Git revision option injection を拒否。
- `bob-code-consistency-review`: absolute artifact path / output path を default 拒否。
- `bob-code-consistency-review`: oversized `.xlsx` / `.docx` / diff truncation。

## 5. 推奨対応順

### まず 1 PR 目で入れたい High 対応

1. `workflow-register` の `vscode.executeCommand` guardrail 強化。
2. `workflow-register` の task snapshot default を privacy-safe に変更。
3. `bob-bazaar-review` MCP server の allowed root 制限。
4. `bob-code-consistency-review` の Git/Bazaar revision validation。
5. `bob-code-consistency-review` の strict workspace path resolver 導入。

### 2 PR 目で入れたい Medium 対応

1. Bazaar diff/added file size の runtime clamp。
2. Code consistency document extraction / raw diff / excerpt のサイズ上限。
3. review packet 選択の明示化。
4. `.gitignore` helper / generated artifacts privacy notice。

### 3 PR 目以降

1. Workspace Trust 対応。
2. dependency lockfile / audit / SBOM CI。
3. workflow execution preview UI。
4. 各 README の threat model / generated files / trusted workspace 節の追加。

## 6. 主要確認ファイル

### `workflow-register`

- `package.json`
- `README.md`
- `src/extension.ts`
- `src/extensionWithAuthoring.ts`
- `src/workflowRegisterService.ts`
- `src/workflowRegistrationService.ts`
- `src/workflowDefinitionLoader.ts`
- `src/workflowDiscovery.ts`
- `src/core/actionRegistry.ts`
- `src/core/guardrails.ts`
- `src/core/engine/stepExecutor.ts`
- `src/core/resultSinkRegistry.ts`
- `src/core/runStateStore.ts`
- `src/core/taskSnapshots.ts`
- `src/bobStepRuntime.ts`
- `src/workflowRuntimeFactory.ts`
- `src/webview/workflowBuilderPanel.ts`
- `src/webview/workflowBuilderHtml.ts`

### `bob-bazaar-review`

- `package.json`
- `README.md`
- `src/extension.ts`
- `src/bazaar.ts`
- `src/bazaarReviewCommands.ts`
- `src/workflowRegisterBridge.ts`
- `src/workspaceResolver.ts`
- `src/reviewGui.ts`
- `src/reviewGuiHtml.ts`
- `src/mcpConfig.ts`
- `src/mcp/server.ts`
- `src/projectRules/io.ts`
- `src/projectRules/resultCapture.ts`
- `src/projectRules/resultCaptureCore.ts`
- `src/projectRules/validator.ts`

### `bob-code-consistency-review`

- `package.json`
- `README.md`
- `src/extension.ts`
- `src/workflowProviderRegistration.ts`
- `src/reviewExecutionCommands.ts`
- `src/extensionCommandOptions.ts`
- `src/workspaceResolver.ts`
- `src/core/fileSystem.ts`
- `src/core/gitDiffCollector.ts`
- `src/core/reviewInputBuilder.ts`
- `src/core/reviewInputValidator.ts`
- `src/core/pipeline.ts`
- `src/core/reviewPackageBuilder.ts`
- `src/core/bobOutputCapture.ts`
- `src/core/bobOutputValidator.ts`
- `src/core/traceabilityCatalogStore.ts`
- `src/core/traceabilityValidation.ts`
- `src/analyzers/documentExtractor.ts`
- `src/analyzers/cCppChangeAnalyzer.ts`
- `src/webview/traceabilityPrepWebview.ts`
- `resources/schemas/review-input.schema.json`

## 7. 結論

現状の実装は、3 拡張とも「実用機能としての骨格」と「テストしやすい分割」はかなり良い。特に Bazaar の `execFile` + `--no-aliases`、result sink の workspace escape 防止、Bob 出力の evidence validation、Webview CSP は評価できる。

ただし、このプロジェクトは Bob/AI とローカル workspace 自動化をつなぐため、通常のアプリよりも「安全な初期値」と「境界の二重チェック」が重要になる。上記 High 5 件を先に潰せば、信頼できる workspace での運用安全性はかなり上がる。次にサイズ上限、生成物の ignore、Workspace Trust、CI audit を入れると、チーム利用に耐える堅さになる。
