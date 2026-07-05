# bob-bazaar-review 拡張機能レビュー（コード / ドキュメント / テスト整合性）

- 対象リポジトリ: `katamor1/bob_builtin_analyze`
- 対象コミット: `350010e766d99ad19a0bba5bf11e2cbd0ee04e62`
- 対象パス: `extensions/bob-bazaar-review`
- レビュー日: 2026-07-05
- レビュー方式: 指定コミット上の GitHub 静的レビュー。`npm test` / VS Code 実機操作 / Bazaar CLI 実行は本レビューでは未実施。

## 1. 総評

`bob-bazaar-review` は、Bazaar CLI 境界、Bob workflow 連携、project rules、MCP、review-result capture、review record 管理までを含む比較的大きな拡張である。設計上の重要な防御は多く、特に次の点は良い。

- Bazaar CLI は `execFile` + `shell: false` で実行し、全呼び出しで `--no-aliases` を挿入している。
- Bazaar revision / relative path / project rules path の入力検証が実装されている。
- `.bob/review/results` の JSON / Markdown / metadata 保存は validation と backup を伴う。
- workflow-register 連携は provider 登録、GUI step completion、workflow state 連携まで分離されている。
- packet fence、result capture、workspace root 探索、dependency policy などの回帰テストが存在する。

一方で、workflow で実際に Bob へ渡るコンテキストの欠落につながる実装不整合、README / 設計書 / テスト仕様と現行コードのズレが残っている。特に優先度が高いのは次である。

1. GUI が生成する日本語 metadata 見出しを `workflowBridge` が解析できず、workflow の `reviewContext.changedFiles` / `message` が空になり得る。
2. direct `reviewRange` command が、README / detailed design の記載に反して追加ファイル本文・target metadata・log を含めない。
3. Webview message の `mode` が whitelist 検証されず、未知値が `workingTreeSinceRevision` 扱いになる。
4. workflow input の `bazaarRoot` / `repositoryRoot` 由来の explicit root が marker 検証なしで採用される。
5. 単体テスト仕様書は 36 項目を掲げているが、実テストは一部の中核領域に偏っており、direct commands / workflowRegisterBridge / MCP call / review record 系の回帰網が薄い。

## 2. 主要 Findings

### BBR-REV-001: GUI 生成 packet の metadata 見出しを workflowBridge が解析できない

- 重要度: High
- 観点: コーディング / 仕様に対するテスト整合性
- 該当箇所:
  - `src/bazaar/reviewTarget.ts:136-165`
  - `src/workflow/workflowBridge.ts:56-75`
  - `test/workflowBridge.test.js:10-64`

#### 内容

GUI 経由の `reviewTarget()` は `buildTargetMetadataSection()` を extra section として packet に入れる。この関数は見出しを日本語で出力する。

```text
### メッセージ / status
### 変更ファイル
```

しかし `workflowBridge` 側の parser は英語見出しだけを検出している。

```text
### Message / status
### Changed files
```

そのため、実際の GUI 生成 packet を `collectReviewContext()` へ渡すと、`message` と `changedFiles` が取得できない可能性が高い。`test/workflowBridge.test.js` は英語見出しの手書き fixture を使っているため、この不整合を検出できていない。

#### 影響

workflow template は `collectReviewContext` を「リビジョンメタデータ、変更ファイル、重要な差分箇所を要約する」step として扱っている。ここで `changedFiles` が空になると、後続 agent step が packet 本文だけに依存し、workflow state 上の差分要約や guardrail 条件が弱くなる。

#### 推奨修正

- `workflowBridge` が日本語 / 英語の両見出しを解析できるようにする。
- さらに堅くするなら、packet 内に人間向け見出しとは別の machine-readable block を追加する。
- 例: `<!-- bob-bazaar-review-target-metadata-json ... -->` または fenced `json` metadata block。
- `test/workflowBridge.test.js` に、`buildTargetMetadataSection()` の出力をそのまま `buildReviewContextResult()` へ渡す round-trip test を追加する。

---

### BBR-REV-002: direct `reviewRange` が仕様どおりの追加ファイル本文・metadata・log を含めていない

- 重要度: High
- 観点: コーディング / ドキュメント整合性 / テスト整合性
- 該当箇所:
  - `README.md` の「追加ファイル本文」説明
  - `docs/detailed-design-ja.md` の direct command 詳細
  - `src/bazaar/bazaarReviewCommands.ts:52-95`
  - `src/bazaar/reviewTarget.ts:84-108`

#### 内容

README と detailed design は、1 revision と revision range の双方で、追加ファイル本文を packet に含める旨を説明している。しかし direct command の `reviewRange()` は次だけを行っている。

- `client.root()`
- `client.diffRange()`
- project rules section の追加
- `buildReviewPacket()` 呼び出し

`prepareTarget()` が range 向けに実装している `log` 取得、changed files 解析、added file content 生成、target metadata 生成を direct `reviewRange()` は使っていない。

#### 影響

- range 内で新規追加されたファイルがある場合、diff が大きい・binary / truncation があるケースでレビュー文脈が不足する。
- direct command で作った packet を workflow に渡すと、target metadata section がないため `collectReviewContext()` の `changedFiles` も取りにくい。
- README / detailed design の期待と実装がズレるため、ユーザーは「range でも追加ファイル本文が入る」と誤解する。

#### 推奨修正

- direct `reviewRange()` も `prepareTarget(..., includeAddedFiles: true)` と `buildTargetMetadataSection()` を使う。
- direct `reviewRevision()` と GUI `reviewTarget()` と direct `reviewRange()` の packet 組み立て経路を共通化する。
- 「range で追加ファイル本文が含まれる」こと、metadata が含まれること、diff truncation 後も warning が入ることを単体テスト化する。

---

### BBR-REV-003: Webview message の `mode` が whitelist 検証されず、未知値が working tree review になる

- 重要度: High
- 観点: コーディング / セキュリティ寄りの堅牢性
- 該当箇所:
  - `src/bazaar/reviewTarget.ts:45-60`
  - `src/bazaar/reviewTarget.ts:111-133`
  - `src/ui/reviewGui.ts:50-58`

#### 内容

`parseTargetRequest()` は `message.mode` を `TargetMode` に型キャストするだけで、実値の whitelist 検証をしない。`validateTargetRequest()` も `singleRevision` と `revisionRange` の必須項目しか見ない。結果として、未知の `mode` は `prepareTarget()` の最後の branch に流れ、`workingTreeSinceRevision` と同じ処理になる。

#### 影響

- typo や不正 Webview message が、意図せず working tree diff / status を取得する。
- GUI 側の `<select>` は限定されているが、Webview message は host 側で必ず検証するべき境界である。
- workflow input / future UI 変更時の regression になりやすい。

#### 推奨修正

- `parseTargetRequest()` か `validateTargetRequest()` で `mode` を `singleRevision | revisionRange | workingTreeSinceRevision` に限定し、未知値は error にする。
- invalid mode の単体テストを追加する。

---

### BBR-REV-004: explicit root が marker 検証なしで採用される

- 重要度: Medium
- 観点: コーディング / セキュリティ境界 / テスト整合性
- 該当箇所:
  - `src/workspace/workspaceResolver.ts:22-26`
  - `src/workflow/workflowRegisterBridge.ts:57-70`
  - `src/ui/reviewGui.ts:63-76`

#### 内容

`resolveMarkerWorkspaceFolder()` は `options.explicitRoot` があれば、`.bzr` / `.bob` marker を確認せず `folderFromRoot(path.resolve(options.explicitRoot))` を返す。`initialTargetFromWorkflowInputs()` は workflow input の `bazaarRoot` / `repositoryRoot` を explicit root として渡し得る。

#### 影響

- workflow input に由来する root が workspace 外や marker 不在のディレクトリでも採用される。
- Bazaar CLI 実行自体は `bzr root` などで失敗する可能性があるが、拡張の workspace 解決責務としては早期に拒否した方が安全である。
- MCP では allowed roots がある一方、GUI / command 側の explicit root 境界が緩い。

#### 推奨修正

- explicit root でも対象 marker を検証する。
- workspace 外 root を許す場合は Trusted Workspace + 明示承認を要求する。
- `explicitRoot` が marker 不在 / workspace 外 / symlink escape の場合の negative test を追加する。

---

### BBR-REV-005: MCP `project_rules_init` の公開状態が README / 設計書とコードでズレている

- 重要度: Medium
- 観点: ドキュメント整合性 / テスト整合性
- 該当箇所:
  - `README.md` の MCP tool 一覧
  - `docs/basic-design-ja.md` の MCP tool 一覧
  - `docs/detailed-design-ja.md` の MCP tool 一覧
  - `src/mcp/server.ts:18-21`
  - `src/mcp/tools.ts:38-43`
  - `src/mcp/projectRulesTools.ts:25-35`, `89-91`, `115-118`

#### 内容

設計書と README は `project_rules_init` を MCP tool 一覧に含めている。一方でコードは `BOB_BAZAAR_ENABLE_WRITE_TOOLS=1` がない限り write tool を `tools/list` から除外し、直接 call されても error にする。

これはセキュリティ上は良い制限だが、ドキュメントが「既定で使える tool」のように読める。

#### 影響

- Bob / MCP 利用者が `project_rules_init` を呼べる前提で workflow や手順を書くと失敗する。
- 実機テスト仕様に MCP tool list / disabled write tool の確認項目が不足している。

#### 推奨修正

- README / basic design / detailed design に「write tool は既定無効。`BOB_BAZAAR_ENABLE_WRITE_TOOLS=1` の明示設定時のみ公開」と明記する。
- MCP の `tools/list` で write tool が隠れること、env 有効時のみ出ること、env 無効時の call が `isError` になることをテストする。

---

### BBR-REV-006: review record 作成時の quality gate が実検証ではなく既定 true になっている

- 重要度: Medium
- 観点: コーディング / 仕様に対するテスト整合性
- 該当箇所:
  - `src/records/reviewRecordCommands.ts:65-115`
  - `src/records/reviewRecordStore.ts:80-115`

#### 内容

`createReviewRecord()` は review-result JSON を読み込むが、`quality_gate.schema_valid` は `input.schemaValid ?? true`、`checklist_count_matches` と `evidence_required_satisfied` も常に `true` として record を作る。`validateReviewRecord()` は record YAML の必須 field と artifact 可読性は確認するが、review-result JSON の schema / checklist completeness / evidence 条件までは再検証しない。

#### 影響

- capture 経由ではない JSON や、後から壊れた JSON を record 化しても、quality gate が true のままになる可能性がある。
- campaign summary が品質状態を過大評価する。
- review 実績を監査用途で使う場合、信頼性が落ちる。

#### 推奨修正

- `createReviewRecord()` で `validateReviewResultJson()` と project rules 由来の expected rule ids / schema を可能な範囲で再検証する。
- 少なくとも `schemaValid` 未指定時は `true` 固定ではなく、検証不能なら `false` または `unknown` 相当を表現する。
- invalid review-result から record を作った場合の negative test を追加する。

---

### BBR-REV-007: record / triage / summary 系 command が設計書・テスト仕様で薄い

- 重要度: Medium
- 観点: ドキュメント整合性 / テスト整合性
- 該当箇所:
  - `package.json:100-145`
  - `src/extension.ts:3-12`, `22-41`
  - `src/records/reviewRecordCommands.ts:45-53`
  - `docs/detailed-design-ja.md` command table
  - `docs/unit-test-spec-ja.md`
  - `docs/real-machine-test-spec-ja.md`

#### 内容

`package.json` と `extension.ts` は次の record 系 command を公開・登録している。

- `bobBazaar.records.initCampaign`
- `bobBazaar.records.createRecord`
- `bobBazaar.records.validateRecord`
- `bobBazaar.records.createTriage`
- `bobBazaar.records.validateTriage`
- `bobBazaar.records.generateSummary`

一方で detailed design の command table、unit-test-spec の BZR-UT 一覧、real-machine-test-spec の具体ケースには、record / triage / summary の仕様と検証観点が十分に展開されていない。

#### 影響

- 公開 command であるにもかかわらず、変更時にテスト仕様から漏れやすい。
- 実績管理機能は review-result artifact と結合しているため、保存先・path validation・品質ゲート・triage summary の regression が見逃されやすい。

#### 推奨修正

- basic / detailed design に Review Records サブシステムを追加する。
- unit-test-spec に record path validation、record 作成、invalid record、triage draft、triage validation、campaign summary を追加する。
- real-machine-test-spec に command palette からの record / triage / summary 操作を追加する。

---

### BBR-REV-008: docs 配下の設計書が現行 source layout と一致していない

- 重要度: Medium
- 観点: ドキュメント整合性
- 該当箇所:
  - `docs/README-ja.md`
  - `docs/basic-design-ja.md`
  - `docs/detailed-design-ja.md`
  - `src/extension.ts:3-12`
  - `README.md` の「現在の実装分割」

#### 内容

top-level `README.md` は現在の分割にかなり追従しているが、`docs/README-ja.md`、`basic-design-ja.md`、`detailed-design-ja.md` には旧 flat layout の file path が残っている。

例:

- `src/bazaar.ts`
- `src/textEncoding.ts`
- `src/bazaarReviewCommands.ts`
- `src/workflowRegisterBridge.ts`
- `src/reviewResultValidationCommand.ts`
- `src/bobCodeExtension.ts`
- `src/reviewGui.ts`
- `src/workspaceResolver.ts`

現行コードは `src/bazaar/`, `src/projectRules/`, `src/workflow/`, `src/bob/`, `src/ui/`, `src/workspace/`, `src/records/`, `src/mcp/` に分割済みである。

#### 影響

- 新規開発者やレビュー担当が設計書から実装へ辿れない。
- リファクタ後の責務境界が docs から読み取れない。
- 実装変更時に古い path を見て修正漏れが発生しやすい。

#### 推奨修正

- `docs/basic-design-ja.md` と `docs/detailed-design-ja.md` の architecture / component table を現行 tree に更新する。
- top-level README の「現在の実装分割」を正として docs に反映する。
- docs に path を書く場合は、CI で existence check するか、少なくとも unit test で主要 path を検証する。

---

### BBR-REV-009: unit-test-spec の項目と実テストの対応が不完全

- 重要度: Medium
- 観点: 仕様に対するテストの存在と整合性
- 該当箇所:
  - `docs/unit-test-spec-ja.md`
  - `test/*.test.js`

#### 内容

`unit-test-spec-ja.md` は BZR-UT-001 から BZR-UT-036 まで広いテスト項目を定義している。一方、確認できた実テストは次の領域に偏っている。

- 充実: result capture、Markdown fence、packet selection、review limits、dependency / packaging policy
- 部分的: BazaarClient、workspace roots、workflow bridge、revisionInfo parser
- 不足: direct command、workflowRegisterBridge、MCP tool list/call/error、reviewResultValidationCommand、reviewResultsStore、workflowStepCompletion、record / triage / summary

#### 代表的な不足

| 仕様項目 | 現状評価 | コメント |
| --- | --- | --- |
| BZR-UT-001 `--no-aliases` 強制 | Partial | `cat` の option separator は確認しているが、仕様にある `root` / `log` / `diffRevision` / `diffRange` / `status` 横断検証は不足。 |
| BZR-UT-002 / 003 exit code | Missing | diff exit code 1 許可、非 diff exit code 1 error の単体テストが見当たらない。 |
| BZR-UT-005 unsafe relative path | Missing | `validateRelativePath()` の `..` / absolute / empty の直接テストが見当たらない。 |
| BZR-UT-006-008 textEncoding | Missing | repository text file の UTF-8 policy test はあるが、Bazaar stdout decode の UTF-8 / Shift-JIS / auto fallback 直接テストは見当たらない。 |
| BZR-UT-015-017 direct review commands | Missing | Bob 拡張なし / workflow-register 有無による分岐の command-level test が見当たらない。 |
| BZR-UT-018-020 workflowRegisterBridge | Missing | initial target / root priority / capture options の直接テストが見当たらない。 |
| BZR-UT-021 workflowBridge | Partial | 英語見出し fixture のみで、実 GUI の日本語 metadata section と不整合。 |
| BZR-UT-028-029 reviewResultValidationCommand | Missing | active selection / full text report / summary の command test が見当たらない。 |
| BZR-UT-030-031 ReviewResultsStore | Missing | latest / id 指定取得の単体テストが見当たらない。 |
| BZR-UT-032-034 MCP Server | Partial | version / source layout は確認しているが、JSON-RPC initialize / tools/list / tools/call / `isError` 変換は不足。 |
| BZR-UT-035 WorkflowStepCompletion | Missing | success / warning fallback の直接テストが見当たらない。 |
| BZR-UT-036 Workflow template | Partial | sandbox script / layout test はあるが、template schema 要素の網羅 assertion は不足。 |

#### 推奨修正

- `unit-test-spec-ja.md` の各 BZR-UT ID に対応する actual test 名を追記する。
- 仕様書にあるが未実装のテストは `TODO` ではなく backlog issue 化する。
- まず High finding を守る regression test から追加する。

---

### BBR-REV-010: real-machine-test-spec が実装済み command / MCP / record 機能を十分に覆っていない

- 重要度: Medium
- 観点: 仕様に対するテストの存在と整合性
- 該当箇所:
  - `docs/real-machine-test-spec-ja.md`
  - `package.json` command contribution
  - `src/mcp/*`
  - `src/records/*`

#### 内容

real-machine-test-spec は VS Code / IBM Bob / workflow-register / Bazaar CLI / Webview を含む結合確認として有用だが、現行実装の全 command / MCP / records までは覆っていない。

不足が目立つ領域:

- MCP `tools/list` の実確認
- MCP readonly tool の happy path / invalid cwd / invalid args
- MCP write tool disabled-by-default の確認
- saved review result の latest / id 取得 tool
- record campaign 初期化、record 作成、triage draft、triage validation、summary 生成
- invalid review-result から record 作成しない / quality gate が false になること
- workflow context の `changedFiles` が GUI 生成 packet から取れること

#### 推奨修正

- real-machine-test-spec に RT-020 以降として MCP と records の結合テストを追加する。
- GUI 生成 packet -> Bob context -> collectReviewContext -> loadReviewRules -> output capture までの smoke test で、`reviewContext.changedFiles` が空でないことを明示する。

---

### BBR-REV-011: custom JSON Schema validation は draft 2020-12 全体ではなく subset

- 重要度: Low-Medium
- 観点: コーディング / ドキュメント整合性
- 該当箇所:
  - `src/projectRules/defaults.ts:70-157`
  - `src/projectRules/schemaValidator.ts:5-134`

#### 内容

default schema は `$schema: https://json-schema.org/draft/2020-12/schema` を名乗る。一方、実装の `validateJsonAgainstSchema()` は local `$ref`、`enum`、`type`、`minLength`、`minimum`、`properties`、`required`、`additionalProperties`、`items` 程度の subset validator である。

現行 default schema には十分だが、ユーザーが project-specific schema を拡張して `oneOf`、`anyOf`、`pattern`、`format`、`const`、`minItems`、`dependentRequired` などを使った場合、 silently ignored になる可能性がある。

#### 推奨修正

- README / design に「サポートする JSON Schema subset」を明記する。
- 本当に draft 2020-12 互換を期待するなら Ajv 等の採用を検討する。
- subset の未対応 keyword が schema に含まれる場合に warning を返す実装も有効。

---

### BBR-REV-012: MCP server は allowed roots 未設定時に cwd を無制限に許可する

- 重要度: Low-Medium
- 観点: セキュリティ hardening
- 該当箇所:
  - `src/mcp/server.ts:67-80`
  - `src/mcp/mcpConfig.ts:35-44`

#### 内容

通常の `configureMcp()` 経路では `BOB_BAZAAR_ALLOWED_ROOTS` が設定される。しかし server 単体起動や古い `.bob/mcp.json` では allowed roots が空になり得る。その場合 `assertAllowedCwd()` は `cwd` をそのまま許可する。

#### 推奨修正

- allowed roots が空の場合は既定拒否にし、明示的に `BOB_BAZAAR_ALLOW_UNRESTRICTED_CWD=1` のような opt-in を要求する。
- 少なくとも README / MCP 設定 docs に、manual 起動時は `BOB_BAZAAR_ALLOWED_ROOTS` 必須と明記する。

---

### BBR-REV-013: review record の campaignId / reviewId path segment は cross-platform safe とは限らない

- 重要度: Low
- 観点: コーディング
- 該当箇所:
  - `src/records/reviewRecordPaths.ts:6-12`, `65-72`

#### 内容

`safePathSegment()` は slash と `.` / `..` を拒否するが、Windows で問題になり得る `:`、`*`、`?`、`"`、`<`、`>`、`|` や reserved device name までは拒否しない。

#### 推奨修正

- review-result artifact と同様に安全な filename sanitization / whitelist を導入する。
- Windows reserved name の negative test を追加する。

---

### BBR-REV-014: ドキュメント番号・章構成に古い編集痕がある

- 重要度: Low
- 観点: ドキュメント整合性
- 該当箇所:
  - `docs/basic-design-ja.md`
  - `docs/detailed-design-ja.md`

#### 内容

`basic-design-ja.md` は section 16 の後に 18 へ飛ぶ。`detailed-design-ja.md` は section 21 の後に 25 へ飛ぶ。内容理解を直接壊すものではないが、設計書が機能追加・リファクタのたびに追従されていない兆候である。

#### 推奨修正

- docs 整理時に章番号を振り直す。
- 「設計書の source path が現存するか」を確認する軽量 docs lint を検討する。

---

### BBR-REV-015: version 文字列の重複管理が残る

- 重要度: Low
- 観点: コーディング / 保守性
- 該当箇所:
  - `src/mcp/server.ts:10`
  - `src/projectRules/resultCaptureCore.ts:233-243`
  - `test/mcpServerVersion.test.js:10-16`
  - `test/resultCaptureCore.test.js:54-84`

#### 内容

MCP server version は package version と一致することがテストされている。一方、review-result artifact metadata の `producer_version` も hard-coded `0.3.0` であり、テストも固定値を期待している。将来 package version だけ更新した場合、metadata の version drift が起きやすい。

#### 推奨修正

- version を package.json から build-time / runtime に読み込む、または single source を置く。
- resultCaptureCore の metadata version も package version と一致するテストへ変更する。

## 3. ドキュメント整合性レビュー

### 3.1 README.md

良い点:

- 拡張の責務、Bob core 非改変、Bazaar alias 問題、`--no-aliases` 強制、optional companion extension が説明されている。
- 現行の source layout に近い「現在の実装分割」が書かれている。
- 生成物、VSIX policy、Trusted Workspace、CLI 前提が書かれている。

要修正:

- range review でも追加ファイル本文が含まれるように読めるが、direct `reviewRange()` は現状含めない。
- MCP `project_rules_init` は既定無効の write tool であることを明記する。
- records 系 command の使い方、生成物、quality gate の意味を追加する。

### 3.2 docs/README-ja.md / basic-design-ja.md / detailed-design-ja.md

要修正:

- 旧 source path を現行 subdirectory layout に更新する。
- record / triage / campaign summary の設計章を追加する。
- MCP write tool の有効化条件を追加する。
- direct command と GUI command の packet 内容差分を明示する。
- workflow context parser が依存する metadata section 仕様を明文化する。

### 3.3 unit-test-spec-ja.md

良い点:

- Bazaar CLI wrapper、workspace、packet、workflow、project rules、capture、MCP まで網羅意図が明確。
- 外部依存を mock / stub 化する方針が適切。

要修正:

- 実テストと BZR-UT ID の対応を追記する。
- 未実装テストを明示する。
- record / triage / summary 系の BZR-UT を追加する。
- BBR-REV-001 から BBR-REV-006 の regression test を追加する。

### 3.4 real-machine-test-spec-ja.md

良い点:

- Windows / VS Code / IBM Bob / workflow-register / Bazaar CLI / multi-root を含む実機観点がある。
- GUI、direct command、capture の基本 smoke が書かれている。

要修正:

- MCP tool 実行、write tool disabled-by-default、allowed roots、invalid cwd を追加する。
- record / triage / summary 操作を追加する。
- GUI 生成 packet から workflow context に changed files が入ることを追加する。
- `.bob-review-records` の成果物検証を追加する。

## 4. 実テスト確認メモ

確認できた主なテストファイル:

- `test/bazaarClient.test.js`
- `test/reviewLimits.test.js`
- `test/markdownFence.test.js`
- `test/workflowBridge.test.js`
- `test/resultCaptureCore.test.js`
- `test/reviewPacketSelection.test.js`
- `test/workspaceRoots.test.js`
- `test/mcpServerVersion.test.js`
- `test/extensionEncoding.test.js`
- `test/mcpSourceLayout.test.js`
- `test/integrationSandboxScript.test.js`
- `test/dependencyPolicy.test.js`

良い回帰網:

- Markdown fence injection への耐性。
- local path redaction。
- result capture の JSON 抽出、validation、保存、backup、metadata、markdown recovery。
- workflow packet URI selection。
- dependency / package / source layout policy。
- template refresh confirmation の存在確認。

不足している回帰網:

- direct command の VS Code / Bob / workflow-register 分岐。
- Webview message invalid mode。
- GUI metadata section と workflowBridge の round-trip。
- range review の added file contents。
- MCP JSON-RPC の実 call。
- MCP write tool disabled/enabled。
- review result validation command。
- review results store。
- review record / triage / summary。
- `textEncoding.ts` の Shift-JIS / CP932 decode。

## 5. 優先修正ロードマップ

### Phase 1: workflow correctness を守る

1. `workflowBridge` が GUI 生成 metadata を解析できるようにする。
2. `reviewRange()` を `prepareTarget()` 経路へ寄せる。
3. `mode` whitelist validation を追加する。
4. 上記 3 点の単体テストを追加する。

### Phase 2: root / MCP 境界を固める

1. explicit root の marker / workspace containment 検証を追加する。
2. MCP allowed roots 未設定時を既定拒否、または明示 opt-in にする。
3. MCP write tool disabled-by-default の docs と tests を追加する。

### Phase 3: records と docs を整える

1. record / triage / summary の設計書と単体テスト仕様を追加する。
2. `createReviewRecord()` の quality gate を実検証ベースにする。
3. docs の旧 source path と章番号を更新する。

### Phase 4: テスト仕様と実テストを同期する

1. `unit-test-spec-ja.md` に actual test 名 / status を追記する。
2. Missing の BZR-UT を backlog 化し、CI で順次追加する。
3. real-machine-test-spec に MCP / records / workflow context のケースを追加する。

## 6. 結論

この拡張は、Bazaar alias 問題・Bob workflow 連携・review-result capture という難しい境界を扱っている割に、実装分割と安全策はよくできている。ただし、GUI packet と workflow parser の見出し不一致、direct range packet の仕様逸脱、target mode / explicit root の検証不足は、実運用でレビュー品質や対象範囲に影響し得る。

最優先では、workflow context の round-trip と range packet の内容を仕様どおりにそろえ、その後に MCP / records / docs / テスト仕様の同期を進めるのがよい。
