# workflow-register 深掘りレビュー

- 対象リポジトリ: `katamor1/bob_builtin_analyze`
- 対象 ref: `14afe83c2218d881a9cd7b17b68b837c53507114`
- 対象拡張: `extensions/workflow-register`
- レビュー日: 2026-07-04

## 0. レビュー方法と前提

本レビューは `workflow-register` 拡張機能の静的コードレビューである。VS Code Extension Host 上での手動実行、IBM Bob 実拡張との接続、`npm install`、`npm test`、`npm audit` は実行していない。

確認した主な範囲は以下。

- `package.json`
- `README.md`
- workflow discovery / registration
- parser / schema / validator
- workflow engine / run state / retry / pause / review gate
- Bob UI runner / task snapshot / result handoff
- action provider / agent provider / result sink
- workflow builder Webview
- AI design / repair / diagnostics helper
- tests directory の配置

## 1. 総評

`workflow-register` は、Bob 用 workflow を `.bob/workflows/*/WORKFLOW.md` から読み込み、Bob UI と standalone engine の両方で実行できる基盤拡張として、かなり多機能である。責務分割は前回レビュー時点よりも進んでおり、`core` 側の engine / parser / validator / state store と VS Code 依存層の分離は評価できる。

一方で、この拡張は「ローカル workspace に置かれた Markdown/YAML を、Bob/AI/VS Code command/file write に接続する」ため、通常の VS Code 拡張より信頼境界が多い。現状の主なリスクは以下に集中している。

1. workflow YAML から呼ばれる command の実体制御。
2. step review / retry / resume の状態遷移の厳密性。
3. Bob chat / task snapshot / workflow state に含まれる機密情報。
4. AI/command result を後続 prompt に渡す際の prompt injection 境界。
5. GUI Builder / AI repair が編集対象ファイルを上書きする境界。

特に、`vscode.executeCommand` の実 command ID を guardrail が見ていない点、`guardrails.requireApproval` が schema/GUI に存在するのに実行時 enforcement が見当たらない点、singleStep 実行時に前段 `reviewing` step を暗黙に completed 扱いにする点は、優先して直したい。

## 2. 優先度付き指摘一覧

Severity は次の意味で使う。

- High: 任意 command、レビューゲート bypass、機密情報、重大な誤結果につながる。
- Medium: 誤用、情報漏えい、再現性低下、DoS、運用事故につながる。
- Low: 保守性、DX、将来拡張時の安全余白。

| ID | Severity | 領域 | 指摘 | 影響 | 推奨対応 |
|---|---:|---|---|---|---|
| WFR-01 | High | command guardrail | `vscode.executeCommand` の実 command ID が guardrail 対象外 | workflow が `vscode.executeCommand` provider を使えると、任意の VS Code command を呼べる余地 | `allowedCommandIds` / `deniedCommandIds` を導入し、`args[0]` を検証する |
| WFR-02 | High | guardrails | `guardrails.requireApproval` が schema/GUI にあるが engine enforcement がない | ユーザーは承認必須だと誤認するが、実行時には止まらない | approval evaluator を engine に追加し、該当時は `held` / `reviewing` にする |
| WFR-03 | High | step review | singleStep 実行時、前段 `reviewing` step が暗黙に accepted/completed になる | 人間承認ゲートを明示操作なしに通過する可能性 | `reviewing` は常に block し、`acceptCurrentStep` のみで完了させる |
| WFR-04 | High | retry / recovery | retry した agent step が過去 assistant 出力を再利用する可能性 | 「再試行」なのに古い結果を再利用し、誤レビュー・誤成果物につながる | recovery reason / attempt / messageStartIndex を使い分け、retry では再実行を優先 |
| WFR-05 | High | task snapshot | Bob messages / metadata / task export / lastAssistantText を workspace に保存し得る | コード、設計書、secret、会話履歴が `.bob/workflows/runs` に残る | `includeMessages` default false、redaction、opt-in、ignore helper |
| WFR-06 | Medium | preflight | `requires.files` / `preflight.files` が `../` で workspace 外の存在確認をできる | 外部ファイルの存在有無を workflow 結果に漏らせる | workspace 内 path に限定し、escape は validation error にする |
| WFR-07 | Medium | prompt boundary | state / command result を XML 風タグへ raw 挿入する | 前段 AI/command 出力が後続 agent prompt を注入しやすい | text escaping、data-only fence、instruction/data 分離を強化 |
| WFR-08 | Medium | template renderer | `{{key}}` が全 state JSON を探索し暗黙解決する | 同名 key 衝突や意図しない置換で command args/file path が変わる | `{{state.foo.bar}}` など explicit path だけに寄せる |
| WFR-09 | Medium | GUI / AI repair | edit/AI repair が active/opened Markdown を上書きできる余地 | `WORKFLOW.md` 以外のファイルを workflow Markdown で置換し得る | edit/apply 前に `.bob/workflows/*/WORKFLOW.md` を hard validate |
| WFR-10 | Medium | legacy workflow | legacy schema には `definitionHash` がなく変更検出が弱い | 実行中/失敗 run の recovery/retry で古い定義との差分に気づきにくい | legacy でも full text hash を入れる、または recovery 対象外にする |
| WFR-11 | Medium | schema | top-level `additionalProperties: true` と step-specific field 制約の緩さ | typo や不要 field が warning 止まり、GUI round-trip で意図が失われる | strict mode を registration path に導入、step type ごとの unevaluated field を制限 |
| WFR-12 | Medium | result size | `maxResultBytes` が byte ではなく文字数で truncate される | 日本語や絵文字で実 byte 上限と乖離する | `Buffer.byteLength` ベースに変更 |
| WFR-13 | Low | activation/dependency | README 前提に IBM Bob があるが `extensionDependencies` はない | activation race / optional dependency の意図が読み手に曖昧 | optional dependency なら明記、必須なら package に依存を追加 |
| WFR-14 | Low | Workspace Trust | untrusted workspace での command/file write 抑止がない | untrusted repository の workflow を実行しやすい | VS Code Workspace Trust API で run/command/result sink を disable |
| WFR-15 | Low | run id race | run id 採番が exists-check 後 write で競合し得る | 同時実行時に run directory が衝突する可能性 | UUID suffix または mkdir exclusive を使う |

## 3. 良い点

### 3.1 core と VS Code 層の分離

`WorkflowEngine`、`ActionRegistry`、`ResultSinkRegistry`、`RunStateStore`、`TaskSnapshotStore` などが core 側に分かれており、unit test を書きやすい。`WorkflowRegisterService` は VS Code command 登録と service orchestration に寄せられている。

### 3.2 result file sink の workspace escape 防止

`ResultSinkRegistry` の file sink は `workspaceRoot` と `path.relative` で workspace 外書き込みを拒否している。workflow の result output は特に事故りやすいため、この防御は良い。

### 3.3 Bob UI / standalone engine の二重経路を抽象化

Bob UI 実行は `BobWorkflowEngineRunner`、standalone 実行は `WorkflowRegisterService.runWorkflow()` 経由で、どちらも `WorkflowEngine` に寄せている。二重実装になっていない点は保守上よい。

### 3.4 Webview CSP と escaping

Workflow Builder は `default-src 'none'` と nonce script を使っている。Webview 内では大きな `innerHTML` 文字列を多用しているが、ユーザー入力や preview text の多くに `escapeHtml` を通している。

### 3.5 run state / control state の atomic write

`FileRunStateStore` と `FileRunControlStore` は temp file + rename の atomic write を使っており、VS Code host 中断時の JSON 破損リスクをある程度抑えている。

## 4. 詳細指摘

## WFR-01: `vscode.executeCommand` の実 command ID が guardrail 対象外

### 根拠

- `ActionRegistry` の default provider は `id: "vscode.executeCommand"` として登録され、`input.args` の先頭を実 command ID として `executeCommand(command, ...args)` に渡す。
- `validateCommandGuardrails` は `providerId` に対してだけ `allowedCommands` / `deniedCommands` を検証する。
- `executeCommandStep` は `step.action.provider` を guardrail に渡してから action を実行する。

### 問題

workflow author が `action.provider: vscode.executeCommand` を使える場合、実際に呼ばれる command は `args[0]` で決まる。ところが guardrail は provider ID しか見ないため、`vscode.executeCommand` を許した時点で、実 command ID の制御が効かない。

これは shell injection ではないが、VS Code command は拡張 API 上の強い操作であり、file write、Git 操作、他拡張 command、設定変更 command などにつながり得る。

### 推奨修正

```ts
export interface WorkflowGuardrailsDefinition {
  allowedProviders?: string[]
  deniedProviders?: string[]
  allowedCommandIds?: string[]
  deniedCommandIds?: string[]
}
```

- provider allowlist と actual command ID allowlist を分ける。
- `vscode.executeCommand` provider では `args[0]` が string かつ `allowedCommandIds` に含まれることを必須にする。
- `workflow-register` 自身の安全 command だけを template default にする。
- `ActionRegistry.execute()` の前に effective action descriptor を作る。

### 追加テスト

- `guardrails.allowedCommandIds` にない command ID は失敗する。
- `guardrails.deniedCommandIds` にある command ID は失敗する。
- provider allowlist が `vscode.executeCommand` でも command ID allowlist なしなら失敗する。
- custom action provider は provider ID allowlist だけで動く。

## WFR-02: `guardrails.requireApproval` が実行時に使われていない

### 根拠

- schema/model/normalizer/GUI に `guardrails.requireApproval` がある。
- 実行時に参照される guardrail 実装は `allowedCommands` / `deniedCommands` の衝突・許可判定のみ。
- `requireApproval` を評価して run を `held` / `reviewing` にする処理は見当たらない。

### 問題

ユーザーは GUI や YAML で `requireApproval` を設定できるが、実行時には何も止まらない。これは「安全装置があるように見えるが効いていない」状態で、通常の missing feature より危険である。

### 推奨修正

- `WorkflowApprovalRuleDefinition.when` を最小 DSL として正式化する。
- まずは `provider == '...'`、`commandId == '...'`、`sink.type == 'file'`、`path matches '...'` 程度に限定する。
- approval required 時は `run.status = "held"`、step status = `held` とし、明示 command で解除する。
- GUI では「現在は enforcement される/されない」を明示する。

### 追加テスト

- approval rule に該当する command step が `held` になる。
- approval 解除後のみ step が進む。
- unknown approval expression は validation warning ではなく error にする。

## WFR-03: singleStep 実行時に前段 `reviewing` step が暗黙 accepted される

### 根拠

`blockedPreviousStep()` は singleStep で target より前の step を見る。前段 step が `reviewing` の場合、`acceptReviewedStep(step)` を呼んで `completed` にしてから continue する。

### 問題

`stepReview.requireAcceptBeforeNext` があるにもかかわらず、ユーザーが後続 step を singleStep 実行すると、前段 reviewing step が明示的な `acceptCurrentStep` なしに accepted/completed 扱いになる。

これは step review の主目的である「人間が確認してから次へ進める」を破る。

### 推奨修正

- `blockedPreviousStep()` は `reviewing` を常に block として返す。
- `requireAcceptBeforeNext === false` の workflow でだけ auto-complete を許す場合でも、明示的に option 名を `autoAcceptReviewedPreviousStep` のように危険さが分かる形にする。
- `runNextStep` / `runWorkflowStep` の UI message に「current step is waiting for review」を出す。

### 追加テスト

- `stepReview.enabled=true` で step 1 reviewing の時、step 2 singleStep は blocked になる。
- `acceptCurrentStep` 後のみ step 2 が実行できる。
- `allowOutOfOrder=true` でも reviewing を bypass しない、または仕様として明示する。

## WFR-04: retry/recovery が古い assistant 出力を再利用する可能性

### 根拠

- `retryCurrentStep()` は `resultKey` を削除し、step を pending に戻す。
- `executeAgentStep()` は `resultKey` が undefined の場合、まず `recoverResultText` を呼び、復旧できれば agent provider を呼ばない。
- Bob UI runner の `recoverResultText` は `extractLastAssistantText(task.getMessages() ?? [], 0)` を使い、現在 task の全 message から最後の assistant text を取る。見つからなければ snapshot からも復旧する。
- snapshot recovery は runId/workflowId/stepId/hash を見るが、attempt 番号は見ない。

### 問題

「retry」は再実行の意味に見えるが、実際には過去の assistant 出力を拾って `agentProvider.run()` を skip する可能性がある。さらに `extractLastAssistantText(..., 0)` は step の `messageStartIndex` を使わないため、別 step の assistant output を拾う余地もある。

影響例:

- 失敗した agent step を retry しても、古い誤出力を再利用してしまう。
- step A の assistant output が、step B の retry/recovery に混入する。
- human review で reject した内容が retry 後に再利用される。

### 推奨修正

- `RecoverResultTextInput.reason` を `handoff-failed` / `retry-agent-result` / `resume-after-host-restart` のように意味別に扱う。
- retry 時は recovery を default disable にする。
- recovery する場合も `run.currentStep`、`step.id`、`attempt`、`messageStartIndex` を使う。
- snapshot payload に attempt number を保存する。
- `extractLastAssistantText` は step 開始時の message index 以降に限定する。

### 追加テスト

- retry agent step は agent provider を再度呼ぶ。
- snapshot に古い agent-output があっても retry では使わない。
- step B recovery が step A assistant output を拾わない。

## WFR-05: task snapshot の機密情報リスク

### 根拠

- snapshot payload は `taskMetadata`、`messages`、`taskExport`、`lastAssistantText` を持つ。
- `package.json` の `workflowRegister.taskSnapshots.includeMessages` default は `true`。
- 保存先は workspace 配下 `.bob/workflows/runs/<runId>/task-snapshots`。

### 問題

Bob chat messages には、コード、diff、設計書、レビュー対象、API key、社内固有パスなどが含まれ得る。snapshot はトラブルシュートに有用だが、デフォルト保存は privacy-safe とは言いづらい。

### 推奨修正

- `includeMessages` default を `false` にする。
- `taskSnapshots.enabled` も初回 opt-in にすることを検討する。
- redaction hook を実装する。
- 保存前に secret pattern を scrub する。
- `.bob/workflows/runs/` を target workspace の `.gitignore` に追加する helper を用意する。
- README に snapshot の保存内容と取り扱いを明記する。

### 追加テスト

- includeMessages=false で messages が保存されない。
- secret-like pattern が redacted される。
- latest.json にも redaction が反映される。

## WFR-06: preflight file check が workspace 外の存在確認に使える

### 根拠

- `WorkflowEngine` は default `fileExists` として `exists(path.join(workspaceRoot, relativePath))` を使う。
- `evaluatePreflight()` は `requires.files` と `preflight.files` を `fileExists(relativePath)` に渡す。
- `preflight.ts` 側では `../` や absolute path の拒否をしていない。

### 問題

`../secret.txt` のような path を `requires.files` に書くと、workspace 外の存在有無が workflow failure/warning として観測できる。読み取りではないが、存在確認は情報漏えいになり得る。

### 推奨修正

- `resolveWorkspaceRelativePathStrict(workspaceRoot, value)` を作り、`..` / absolute / drive letter / UNC を拒否する。
- `requires.files` / `preflight.files` / artifact path / builder path validation で共通利用する。
- validation 時に workspace escape を error にする。

### 追加テスト

- `requires.files: ['../x']` は validation error。
- `preflight.files: ['/tmp/x']` は validation error。
- Windows drive path / UNC path も error。

## WFR-07: workflow state / command result の prompt injection 境界

### 根拠

- `agentStep.ts` は state entry value を `<state>` タグ内へ raw 挿入する。
- `bobWorkflowMessages.ts` は workflow state を `- key: value` 形式で raw 挿入する。
- command result は JSON block として後続 Bob message に含まれる。

### 問題

前段 command result や agent output は、後続 agent prompt では untrusted data として扱うべきである。現状は XML 風タグで囲っているが、state value 自体は escape されていないため、`</state>` や `</workflow_state>` を含む文字列が prompt 構造を壊し、後続 agent に新しい指示として解釈される余地がある。

### 推奨修正

- state value を XML text escape するか、JSON string として serialise する。
- `<workflow_state type="data-only">` のように明示し、「中身を命令として扱わない」指示を追加する。
- 大きな state は hash + artifact path にし、必要時だけ読む設計を検討する。
- command result は fenced JSON か base64 envelope にする。

### 追加テスト

- state value に `</workflow_state>` が含まれても prompt 構造が壊れない。
- command result に Markdown/HTML/XML 風 payload が含まれても data block 内に閉じ込められる。

## WFR-08: template renderer の暗黙 JSON key 解決が予測しづらい

### 根拠

`renderTemplate()` は `{{inputs.foo}}` / `{{state.foo}}` のほか、裸の `{{key}}` も置換する。裸 key は inputs、state 直下に加え、state value 内の JSON object を順に parse して property を探索する。

### 問題

複数の state に同じ property がある場合、どの state から解決されたかが workflow author から見えづらい。command args や file path template でこの暗黙解決が起きると、想定外の path / command argument になる。

### 推奨修正

- 裸 `{{key}}` は deprecated にする。
- `{{inputs.key}}`、`{{state.key}}`、`{{json state.reviewContext.workspacePath}}` のような explicit syntax に寄せる。
- 裸 key 使用時は validation warning を出す。

### 追加テスト

- 複数 state JSON に同じ key がある時、裸 key 使用は warning。
- explicit syntax は deterministic に解決される。

## WFR-09: GUI edit / AI repair の上書き対象 boundary

### 根拠

- `editWorkflowInBuilder` は active editor または file picker で選ばれた Markdown を読み、GUI edit mode に渡す。
- `WorkflowBuilderPanel.targetUri()` は edit mode で `editingFilePath` をそのまま保存対象にする。
- `improveWorkflowWithAi` は active editor の content を AI repair し、validation OK なら `originalUri` へ上書きする。

### 問題

通常は `WORKFLOW.md` を開いて使う想定だが、実装上は active/opened Markdown が `.bob/workflows/*/WORKFLOW.md` であることを hard enforce していない。誤って別 Markdown を開いた状態で実行すると、workflow Markdown で上書きする可能性がある。

### 推奨修正

- `isWorkflowDocument(uri)` を shared utility にし、edit/apply 前に必ず検証する。
- file picker も `WORKFLOW.md` に限定する。
- `.bob/workflows/*/WORKFLOW.md` 以外の場合、read-only preview のみ許可する。

### 追加テスト

- active editor が `README.md` の場合、AI repair apply は拒否。
- GUI edit mode が `.bob/workflows/x/WORKFLOW.md` 以外を save しない。

## WFR-10: legacy workflow に definition hash がない

### 根拠

- `parseV1Workflow` は `definitionHash: sha256:<fullText>` を設定する。
- `parseLegacyWorkflow` には definition hash 設定がない。
- `workflowDefinitionMatches()` は run と workflow の両方に hash がある場合だけ mismatch を検出する。

### 問題

legacy workflow では実行途中/失敗 run を再開・retry する際、workflow 本文が変わっていても hash mismatch を検出できない。`workflowFile` は見ているが、内容変更は分からない。

### 推奨修正

- legacy でも full text hash を持つ。
- または legacy workflow の recover/retry は「定義変更未検出」を warning にする。
- 新規 workflow では v1 schema を必須化する方針も検討する。

## WFR-11: schema の permissiveness と step-specific field 制約

### 根拠

- `workflowV1Schema` の top-level は `additionalProperties: true`。
- unknown top-level field は parser warning になるが、通常 validation では warning 止まり。
- `steps[].properties` は `action` や `result` を全 step type の property として許しており、`allOf` は command に action 必須、result に result 必須を課すだけで、agent/manual から action を禁止するわけではない。

### 問題

typo や step type に合わない field が error にならず、実行時には normalize で無視されることがある。GUI round-trip で未知 field を保存できる設計は互換性のためには便利だが、workflow author が「効いている」と誤解するリスクがある。

### 推奨修正

- registration path では warning 止まりでも、`validateWorkspaceWorkflows --strict` 的 command を標準導線にする。
- step type ごとに `if/then/not` で不要 field を warning/error にする。
- unknown top-level は `x-` prefix だけ許すなど、将来拡張用の namespace を作る。

## WFR-12: `maxResultBytes` が byte ではなく文字数

### 根拠

`buildCommandResultBlock()` は `maxResultBytes` を `truncate()` に渡すが、`truncate()` は `value.length` と `slice()` で判定している。

### 問題

日本語・絵文字・サロゲートペアを含む場合、文字数と UTF-8 byte 数は一致しない。設定名が bytes なので、実際の payload size 制御としてはズレる。

### 推奨修正

- `Buffer.byteLength(value, "utf8")` ベースで truncate する。
- `truncateUtf8(value, maxBytes)` を共通 utility 化する。
- truncation 後も JSON と Unicode が壊れないようにする。

## WFR-13: IBM Bob dependency の扱いが曖昧

### 根拠

- README では IBM Bob 拡張を前提としている。
- `package.json` に `extensionDependencies` はなく、`workflowRegistrationService` が `IBM.bob-code` を動的に探す。
- activation 時に reload と retry timer を使っている。

### 評価

これは「Bob がなくても workflow authoring/validation は使える」という設計なら妥当である。ただし README の前提と package の optional behavior が読み手に伝わりにくい。

### 推奨修正

- README に「Bob 連携は optional / authoring は単体可 / Bob UI 登録には IBM.bob-code が必要」と明記する。
- 本当に必須なら `extensionDependencies` に追加する。

## WFR-14: Workspace Trust gating がない

### 問題

この拡張は workspace 内の workflow から VS Code command と file write を実行できる。VS Code の Workspace Trust に連動していない場合、untrusted repository を開いたユーザーが workflow を実行してしまうリスクがある。

### 推奨修正

- `vscode.workspace.isTrusted` を確認し、untrusted では `runWorkflow` / `runWorkflowStep` / `reload registration` / `vscode.executeCommand` provider / file sink を disable または confirm する。
- Workspace Trust が false のときは builder/validator だけ許可する。

## WFR-15: run id 採番の競合余地

### 根拠

`FileRunStateStore.nextRunId()` は timestamp + workflowName を作り、`exists()` で空きを確認して返す。その後 `saveRun()` が file を作る。

### 問題

同一 workflow を同時に開始すると、exists-check と write の間で同じ run id を選ぶ競合余地がある。頻度は低いが、Bob UI と command が並列に動く場合は避けたい。

### 推奨修正

- run id に random suffix / UUID を入れる。
- または run directory を exclusive mkdir で確保する。

## 5. テスト追加案

### 5.1 guardrail / action provider

- `vscode.executeCommand` の command ID allowlist がない場合に失敗する。
- `allowedProviders` と `allowedCommandIds` が両方正しい場合だけ成功する。
- denied command ID が provider allow より優先される。
- `guardrails.requireApproval` 該当時に run が held になる。

### 5.2 step review / retry

- reviewing step がある状態で後続 singleStep 実行しても auto-accept されない。
- `acceptCurrentStep` だけが reviewing -> completed にできる。
- retry agent step は stale snapshot / previous assistant text を使わず、agent provider を再呼び出しする。
- retry attempt number が snapshot と紐づく。

### 5.3 path boundary

- `requires.files: ['../secret']` は validation error。
- `preflight.files` の absolute path は validation error。
- result file sink は既存通り workspace escape を拒否する。
- GUI/AI repair は `.bob/workflows/*/WORKFLOW.md` 以外を上書きしない。

### 5.4 prompt / serialization

- state value に `</workflow_state>` が含まれても prompt 構造が壊れない。
- command result に XML/Markdown/HTML を含めても data block として扱われる。
- `maxResultBytes` が UTF-8 byte 数で制限される。

### 5.5 privacy

- `taskSnapshots.includeMessages=false` で messages/taskExport が保存されない。
- secret-like token が redacted される。
- `.bob/workflows/runs` ignore helper が idempotent に動く。

## 6. 推奨修正順

### PR 1: 実行安全性

1. `vscode.executeCommand` の actual command ID allowlist。
2. `guardrails.requireApproval` enforcement、または未実装なら GUI/README/schema から一旦外す。
3. singleStep の reviewing auto-accept 廃止。
4. retry/recovery の stale assistant output 防止。

### PR 2: privacy / artifact safety

1. task snapshot default を privacy-safe に変更。
2. redaction hook。
3. `.bob/workflows/runs/` ignore helper。
4. run diagnostics で snapshot 内容を直接表示しない方針の明文化。

### PR 3: path / trust boundary

1. strict workspace path resolver。
2. preflight file path validation。
3. GUI/AI repair target validation。
4. Workspace Trust 対応。

### PR 4: schema / DX

1. schema strictness 改善。
2. template renderer の explicit syntax 化。
3. legacy workflow hash。
4. byte-based truncation。

## 7. 確認した主要ファイル

- `extensions/workflow-register/package.json`
- `extensions/workflow-register/README.md`
- `extensions/workflow-register/src/extension.ts`
- `extensions/workflow-register/src/extensionWithAuthoring.ts`
- `extensions/workflow-register/src/workflowRegisterService.ts`
- `extensions/workflow-register/src/workflowRegistrationService.ts`
- `extensions/workflow-register/src/workflowDefinitionLoader.ts`
- `extensions/workflow-register/src/workflowDiscovery.ts`
- `extensions/workflow-register/src/workflowAdapter.ts`
- `extensions/workflow-register/src/bobApi.ts`
- `extensions/workflow-register/src/bobWorkflowFactory.ts`
- `extensions/workflow-register/src/bobWorkflowRunner.ts`
- `extensions/workflow-register/src/bobWorkflowMessages.ts`
- `extensions/workflow-register/src/bobStepRuntime.ts`
- `extensions/workflow-register/src/resultHandoff.ts`
- `extensions/workflow-register/src/taskSnapshotRecovery.ts`
- `extensions/workflow-register/src/workflowInputPrompt.ts`
- `extensions/workflow-register/src/workflowPromptContext.ts`
- `extensions/workflow-register/src/core/model.ts`
- `extensions/workflow-register/src/core/engine.ts`
- `extensions/workflow-register/src/core/engine/runState.ts`
- `extensions/workflow-register/src/core/engine/stepExecutor.ts`
- `extensions/workflow-register/src/core/engine/resultWriters.ts`
- `extensions/workflow-register/src/core/engine/preflight.ts`
- `extensions/workflow-register/src/core/engine/runPause.ts`
- `extensions/workflow-register/src/core/actionRegistry.ts`
- `extensions/workflow-register/src/core/guardrails.ts`
- `extensions/workflow-register/src/core/resultSinkRegistry.ts`
- `extensions/workflow-register/src/core/runStateStore.ts`
- `extensions/workflow-register/src/core/runControlStore.ts`
- `extensions/workflow-register/src/core/taskSnapshots.ts`
- `extensions/workflow-register/src/core/inputResolver.ts`
- `extensions/workflow-register/src/core/inputCollector.ts`
- `extensions/workflow-register/src/core/parser/parseWorkflowMarkdown.ts`
- `extensions/workflow-register/src/core/parser/parseV1Workflow.ts`
- `extensions/workflow-register/src/core/parser/parseLegacyWorkflow.ts`
- `extensions/workflow-register/src/core/parser/normalizers.ts`
- `extensions/workflow-register/src/core/workflowSchema.ts`
- `extensions/workflow-register/src/core/workflowValidator.ts`
- `extensions/workflow-register/src/core/workflowAuthoringLoader.ts`
- `extensions/workflow-register/src/core/workflowAuthoringSerializer.ts`
- `extensions/workflow-register/src/core/workflowReplacementPreview.ts`
- `extensions/workflow-register/src/core/commandWorkflowAiProvider.ts`
- `extensions/workflow-register/src/core/workflowAiProviderFactory.ts`
- `extensions/workflow-register/src/commands/createWorkflow.ts`
- `extensions/workflow-register/src/commands/editWorkflowInBuilder.ts`
- `extensions/workflow-register/src/commands/improveWorkflowWithAi.ts`
- `extensions/workflow-register/src/commands/runControl.ts`
- `extensions/workflow-register/src/commands/stepReview.ts`
- `extensions/workflow-register/src/commands/inspectRunDiagnostics.ts`
- `extensions/workflow-register/src/commands/workspaceRootPicker.ts`
- `extensions/workflow-register/src/webview/workflowBuilderPanel.ts`
- `extensions/workflow-register/src/webview/workflowBuilderHtml.ts`
- `extensions/workflow-register/src/webview/workflowBuilderClientStateScript.ts`
- `extensions/workflow-register/src/webview/workflowBuilderCoreRendererScript.ts`
- `extensions/workflow-register/src/webview/workflowBuilderStepRendererScript.ts`
- `extensions/workflow-register/src/webview/workflowBuilderTabRenderersScript.ts`
- `extensions/workflow-register/src/webview/workflowBuilderFieldEventsScript.ts`

## 8. 結論

`workflow-register` は、Bob workflow authoring と execution をかなり実用的な形にまとめている。特に core engine の分離、run state 永続化、result sink の workspace escape 防止、Webview CSP、validation/diagnostics はよくできている。

ただし、基盤拡張として使われるほど、workflow YAML の権限境界は重要になる。現状は command guardrail、review gate、retry/recovery、snapshot privacy が最も危ない。ここを先に締めれば、後続の `bob-bazaar-review` や `bob-code-consistency-review` から使う workflow 基盤として、かなり安心して育てられる。
