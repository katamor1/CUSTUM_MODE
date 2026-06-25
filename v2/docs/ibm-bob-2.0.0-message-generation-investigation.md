# IBM Bob 2.0.0 メッセージ生成方式 調査メモ

調査日: 2026-06-25  
対象リポジトリ: `katamor1/bob_builtin_analyze`  
参照資料リポジトリ: `katamor1/project`

## 1. 結論

`katamor1/bob_builtin_analyze` は、調査時点では空リポジトリであり、VSCode 拡張機能としての `package.json`、`src/extension.ts`、コマンド登録、WebView、チャット参加者、または IBM Bob 用メッセージ生成処理の実装は確認できなかった。

そのため、本メモでは IBM Bob 2.0.0 の既存ドキュメントと mode pack 実装を読み、VSCode 拡張 `bob_builtin_analyze` で実現すべきメッセージ生成方式を整理する。

要点は次の通り。

1. IBM Bob 2.0.0 は `.bob/` を直接編集する構造ではなく、`ibm-bob/mode-pack` を source of truth として扱う。
2. `modes/custom_modes.source.yaml` に定義された mode 情報を installer が `.bob/custom_modes.yaml` と `.bob/rules-{slug}/` に変換する。
3. ユーザー入力は、そのまま下流処理に渡さず、JSON artifact の段階列に正規化してから dispatch する。
4. VSCode 拡張側で作るべき「メッセージ」は、自然文プロンプトの長文合成ではなく、`entry_route_decision`、`entry_request_packet`、`session_scope_gate`、`entry_dispatch_packet`、`entry_response` のような構造化 JSON message である。
5. 生成・レビュー・適用境界は source-free / no-real-apply を既定にし、raw source、raw patch、DOCX本文、絶対パスをユーザー向け・品質集約向け message に混ぜない。

## 2. 調査範囲

### 2.1 `katamor1/bob_builtin_analyze`

GitHub 上の対象リポジトリは存在するが、調査時点では空である。README も存在しなかった。

確認したが見つからなかったもの:

- `README.md`
- `package.json`
- `src/extension.ts`
- `src/**/*.ts`
- VSCode command 登録
- chat participant / language model API 呼び出し
- IBM Bob 連携用の message builder 実装

このため、既存実装の逆解析ではなく、IBM Bob 2.0.0 資料から VSCode 拡張で実装すべき構造を導出した。

### 2.2 `katamor1/project` 側の参照資料

主に次を参照した。

- `ibm-bob/mode-pack/README.md`
- `docs/current-program-spec/bob-mode-pack-spec.md`
- `ibm-bob/mode-pack/modes/custom_modes.source.yaml`
- `ibm-bob/mode-pack/scripts/install_mode_pack.py`
- `ibm-bob/mode-pack/routing/stage-flow.json`
- `ibm-bob/mode-pack/routing/direct-mode-flow.json`
- `ibm-bob/mode-pack/mode-catalog.md`
- `ibm-bob/mode-pack/route-harness.md`
- `.copilot/routing/entry/ibmbob-entry-flow.yaml`
- `.copilot/prompts/entry/*.md`
- `.copilot/schemas/entry-*.schema.json`
- `docs/copilot-studio/custom-engine-bridge/entry-flow.md`
- `docs/copilot-studio/custom-engine-bridge/response-shaping.md`

## 3. IBM Bob 2.0.0 の構造

### 3.1 mode pack が正本

IBM Bob 2.0.0 の mode pack は、`ibm-bob/mode-pack` を source of truth とする。repo 直下の `.bob/` は source ではなく generated output である。

installer は workspace に以下を生成する。

- `.bob/custom_modes.yaml`
- `.bob/rules-{slug}/`
- `.bob/ibm-bob/stage-flow.json`
- `.bob/ibm-bob/references/**`
- `.bob/ibm-bob/profiles/*.json`

VSCode 拡張側では、`.bob/custom_modes.yaml` を手で作るのではなく、正本ファイルを読み、必要なら installer 相当の生成結果を参照する設計が望ましい。

### 3.2 9 個の canonical mode

IBM Bob 2.0.0 の converted plugin route は、次の 9 mode に集約されている。

| mode | 役割 |
| --- | --- |
| `ibmbob-route-orchestrator` | route 入口、scope、route selection、human checkpoint |
| `ibmbob-requirements-base-sync` | 要件/PDF/RequirementIR から基本設計更新計画を作る |
| `ibmbob-detail-design-author` | copied workspace evidence から詳細設計 draft を作る |
| `ibmbob-cross-stage-reviewer` | typed IR consistency と source-free bundle validation |
| `ibmbob-design-code-planner` | 詳細設計から source change candidate と ledger を作る |
| `ibmbob-feature-test-sync` | 基本設計と機能テスト仕様の同期 |
| `ibmbob-spec-code-sync` | 詳細設計、単体テスト仕様、C/C++ copied workspace の triad 同期 |
| `ibmbob-review-state-closer` | sidecar overlay/ledger、stale hash、closure gate |
| `ibmbob-verification-reporter` | check_all、route validation、verification package、run summary |

`modes/custom_modes.source.yaml` では、各 mode が次の属性を持つ。

- `slug`
- `name`
- `description`
- `roleDefinition`
- `whenToUse`
- `customInstructions`
- `permissions`
- `ruleDir`

VSCode 拡張で LLM に渡す system/developer message を組み立てる場合、この mode 定義が message template の中心になる。

### 3.3 installer の変換内容

`install_mode_pack.py` は、`modes/custom_modes.source.yaml` を読み、各 mode を `.bob/custom_modes.yaml` の `customModes` に変換する。

変換時には次を行う。

1. `slug/name/description/roleDefinition/whenToUse/customInstructions` を `customModes` に出力する。
2. `permissions` を Bob の `groups` 表現に変換する。
3. `ruleDir` に対応する `rules/{ruleDir}` を `.bob/rules-{slug}/` にコピーする。
4. shared rule を各 rule bundle に追加する。
5. reference path を `.bob/ibm-bob/references/...` に rewrite する。
6. `routing/stage-flow.json` を `.bob/ibm-bob/stage-flow.json` にコピーする。
7. workspace profile を `.bob/ibm-bob/profiles/` にコピーする。

VSCode 拡張側で message を作る場合も、この変換結果と同じ情報を使う必要がある。特に `customInstructions` に書かれた Read First の reference は、単なる説明ではなく、mode 実行前に注入すべき context pointer とみなす。

## 4. route / message の流れ

### 4.1 copied-workspace route

`stage-flow.json` は、entry mode、review mode、stage order、review result ごとの遷移を定義する。

主な構造:

- `entry_mode`: `ibmbob-route-orchestrator`
- `review_mode`: `ibmbob-cross-stage-reviewer`
- `stage_order`:
  - `route_intake`
  - `requirements_base_sync`
  - `detail_design`
  - `cross_stage_review`
  - `code_change`
  - `unit_test_pack`
  - `unit_test_run`
  - `functional_test_pack`
  - `spec_code_sync`
  - `review_state_closure`
  - `verification_report`

review 付き stage では、`on_pass`、`on_revise`、`on_block` により次 mode が決まる。`on_block` は `human_checkpoint` に止める。

VSCode 拡張の message builder は、ユーザー要求から直接 detail/design/code 生成 prompt を作るのではなく、まず `ibmbob-route-orchestrator` に相当する route decision message を作り、stage と next_agent を固定する必要がある。

### 4.2 direct-mode route

`direct-mode-flow.json` は manual pilot flow と gate rule を定義する。

manual pilot flow は次の単位で表現される。

- `requirements_to_base`
- `base_to_detail_to_code`
- `detail_unit_source_sync`
- `base_feature_test_sync`
- `route_closure`

gate rule は次を含む。

- source-free が必要な mode
- copied workspace が必要な mode
- real apply を既定で許可しない mode

VSCode 拡張は、ワークスペースや source-free bundle が足りない場合、処理を進める message ではなく checkpoint message を返すべきである。

## 5. Entry bridge の message pipeline

IBM Bob 2.0.0 の entry bridge は、ユーザー chat request をそのまま runtime に渡さず、明示的な JSON artifact pipeline に分解している。

標準フロー:

1. `ibmbob-entry-router`
2. `ibmbob-intent-packet-builder`
3. `ibmbob-identity-scope-guard`
4. `ibmbob-dispatch-packet-author`
5. `ibmbob-runtime-orchestrator`
6. `K*` または `P*`
7. `ibmbob-entry-response-shaper`
8. `ibmbob-entry-eval-monitor`

VSCode 拡張での message 作成も、この pipeline をそのまま内部状態機械として扱うのが自然である。

### 5.1 `entry_route_decision`

入口 router は、`chat_request`、`conversation_context`、`copilot_surface` を入力に取り、request を次のいずれかへ分類する。

- `generation`
- `diff`
- `review`
- `eval`
- `checkpoint`

この段階では runtime 本文や SDLC 本文を作らない。

VSCode 拡張で作る message 例:

```json
{
  "artifact_type": "entry_route_decision",
  "required_inputs": ["chat_request", "conversation_context", "vscode_workspace_context"],
  "next_agent": "ibmbob-intent-packet-builder",
  "entry_route_decision": {
    "request_id": "BRREQ-...",
    "request_type": "generation",
    "requested_lane": "design",
    "next_agent": "ibmbob-intent-packet-builder"
  }
}
```

### 5.2 `entry_request_packet`

intent packet builder は、ユーザーの自然文を `entry_request_packet` に正規化する。

必須項目:

- `request_id`
- `user_intent`
- `requested_outcome`
- `requested_lane`
- `locale`
- `conversation_context_ref`

VSCode 拡張では、エディタ選択範囲、開いているファイル、ワークスペース root、Git branch、対象成果物などを `conversation_context_ref` または別の context packet として参照化する。本文を丸ごと message に埋め込むのではなく、参照 ID と必要最小の summary を渡す。

### 5.3 `session_scope_gate`

identity/scope guard は、principal、tenant、allowed scope を確認し、OK の場合は `session_scope_context`、NG の場合は `entry_human_checkpoint` を返す。

VSCode 拡張の場合、少なくとも次を gate に含める。

- workspace trust
- 対象 workspace root
- Git repository / branch
- allowed file globs
- source-free bundle の有無
- copied workspace の有無
- real apply を許可する明示操作の有無

不明または危険な場合は、処理を進めるのではなく checkpoint response にする。

### 5.4 `entry_dispatch_packet`

dispatch packet author は、`entry_request_packet` と `session_scope_context` から runtime へ渡す dispatch contract を固定する。

必須項目:

- `entry_request_ref`
- `session_scope_context_ref`
- `runtime_target`
- `runtime_task_type`
- `callback_contract`
- `next_agent`

`callback_contract.response_agent` は `ibmbob-entry-response-shaper` 固定であり、runtime 後の返答形式をここで固定する。

VSCode 拡張では、この packet を LLM 呼び出しの user message または tool call payload として使う。自然文プロンプトではなく、構造化 JSON と reference path の組み合わせで渡す。

### 5.5 `entry_response`

response shaper は、runtime / SDLC 結果をユーザー向けの短い日本語応答に整形する。

response mode は次の 4 種類。

- `answer`
- `abstain`
- `handoff`
- `checkpoint`

日本語出力ルールは次の順序である。

1. 何が分かったか
2. 何が足りないか
3. 次に何をするか

VSCode 拡張の UI では、最終 response をそのまま表示し、詳細な route artifact は Output Channel、Markdown preview、または `.bob/` / `artifacts/` 配下のファイルとして参照できるようにする。

## 6. VSCode 拡張 `bob_builtin_analyze` での実装方針

現状の target repo は空なので、次の責務を持つ最小構成から実装するのがよい。

### 6.1 推奨ディレクトリ構成

```text
bob_builtin_analyze/
  package.json
  tsconfig.json
  src/
    extension.ts
    bob/
      modePackLoader.ts
      messageBuilder.ts
      routeEngine.ts
      schemaValidator.ts
      responseShaper.ts
      workspaceContext.ts
  docs/
    ibm-bob-2.0.0-message-generation-investigation.md
```

### 6.2 `modePackLoader.ts`

責務:

- `ibm-bob/mode-pack/modes/custom_modes.source.yaml` または generated `.bob/custom_modes.yaml` を読む。
- mode の `slug`、`roleDefinition`、`whenToUse`、`customInstructions`、`groups` を取得する。
- `ruleDir` に対応する `.bob/rules-{slug}/` を読み、mode message に追加する。
- `stage-flow.json` / `direct-mode-flow.json` を読み、route 候補を作る。

### 6.3 `messageBuilder.ts`

責務:

- ユーザー入力と VSCode workspace context から `entry_route_decision` を作る。
- route decision を `entry_request_packet` に変換する。
- workspace trust / allowed scope / copied workspace / source-free bundle を見て `session_scope_gate` を作る。
- dispatch 可能なら `entry_dispatch_packet` を作る。
- mode 実行時の LLM message を、次の順で組み立てる。

推奨 message 順序:

1. system: IBM Bob 共通境界。source-free、no-real-apply、raw source 禁止。
2. system/developer: mode の `roleDefinition`。
3. developer: mode の `customInstructions` と Read First reference。
4. developer: `.bob/rules-{slug}/` の rule bundle summary。
5. user: `entry_dispatch_packet` または stage handoff packet。
6. user: 必要な context reference、artifact hash、relative path、status。

### 6.4 `routeEngine.ts`

責務:

- `stage-flow.json` と `direct-mode-flow.json` に従って next_agent を決める。
- `pass` / `revise` / `block` によって遷移を変える。
- `human_checkpoint` の場合は LLM に続きを書かせず、checkpoint response を作る。
- route artifact に絶対パスや raw patch が混ざらないようにする。

### 6.5 `schemaValidator.ts`

責務:

- entry schema、dispatch schema、response schema を検証する。
- `additionalProperties: false` を尊重し、余計なフィールドを落とす。
- invalid な packet は LLM に渡さず checkpoint にする。

### 6.6 `responseShaper.ts`

責務:

- runtime 結果を `entry_response` schema に合わせる。
- `answer` / `abstain` / `handoff` / `checkpoint` のいずれかに正規化する。
- 日本語の短い応答を作る。
- 何が分かったか、何が足りないか、次に何をするか、の順序を守る。

## 7. message 作成の擬似コード

```ts
type BobMessage = {
  role: 'system' | 'developer' | 'user';
  content: string;
};

async function buildBobMessages(input: ChatInput, vscodeContext: WorkspaceContext): Promise<BobMessage[]> {
  const modePack = await loadModePack(vscodeContext.workspaceRoot);
  const routeDecision = buildEntryRouteDecision(input, vscodeContext);
  const requestPacket = buildEntryRequestPacket(routeDecision, input, vscodeContext);
  const scopeGate = buildSessionScopeGate(requestPacket, vscodeContext);

  if (scopeGate.human_checkpoint === 'required') {
    return buildCheckpointMessages(scopeGate);
  }

  const dispatchPacket = buildEntryDispatchPacket(requestPacket, scopeGate.session_scope_context);
  const nextMode = modePack.getMode(dispatchPacket.next_agent ?? dispatchPacket.runtime_target);
  const rules = await modePack.loadRules(nextMode.slug);

  return [
    {
      role: 'system',
      content: [
        'You are IBM Bob 2.0.0 running inside VSCode.',
        'Use source-free route artifacts by default.',
        'Do not include raw source, raw patch, DOCX body text, or absolute paths in user-facing output.',
        'Never perform real source or DOCX apply unless an explicit approved apply gate exists.'
      ].join('\n')
    },
    {
      role: 'developer',
      content: nextMode.roleDefinition
    },
    {
      role: 'developer',
      content: nextMode.customInstructions
    },
    {
      role: 'developer',
      content: summarizeRules(rules)
    },
    {
      role: 'user',
      content: JSON.stringify({ dispatchPacket, contextRefs: vscodeContext.safeRefs }, null, 2)
    }
  ];
}
```

## 8. 実装上の注意点

### 8.1 path は参照として扱う

IBM Bob 2.0.0 では generated route artifact に絶対パス、source snippet、raw patch body、DOCX本文、`candidate.patch` reference を混ぜない方針になっている。

VSCode 拡張でも、エディタの選択範囲やファイル本文を無制限に message へ埋め込むべきではない。まず relative path、hash、symbol、line range、summary へ変換する。

### 8.2 real apply は既定禁止

route harness は reviewer input を作るが、real source apply / real DOCX apply は行わない。VSCode 拡張の「修正を適用」系コマンドも、既定では apply-copy または patch preview に止めるべきである。

### 8.3 checkpoint を UI の正常系として扱う

identity、tenant、scope、workspace、source-free bundle が不足する場合、エラーではなく `checkpoint` response として返す。

### 8.4 message は mode ごとに薄くする

1 回の LLM 呼び出しに全 mode の説明を入れない。routeEngine が next_agent を決め、messageBuilder は対象 mode の role / instruction / rules / packet だけを渡す。

## 9. 受け入れ条件案

`bob_builtin_analyze` に VSCode 拡張実装を追加する場合、最低限の受け入れ条件は次の通り。

- `package.json` に VSCode command が登録されている。
- `src/extension.ts` が command を activate する。
- `messageBuilder.ts` が `entry_route_decision`、`entry_request_packet`、`entry_dispatch_packet` を生成できる。
- `schemaValidator.ts` が entry schema を検証できる。
- `routeEngine.ts` が `stage-flow.json` / `direct-mode-flow.json` 相当の next_agent を解決できる。
- source-free / no-real-apply の境界が system message と validation の両方に入っている。
- checkpoint response をユーザーに短い日本語で返せる。
- raw source、raw patch、DOCX本文、絶対パスを user-facing message に混ぜないテストがある。

## 10. 未確認事項

- `katamor1/bob_builtin_analyze` には調査時点で VSCode 拡張実装が存在しないため、実装済みコードの挙動は未確認。
- IBM Bob mode pack の最新 validator はこの調査内では実行していない。
- 実際の VSCode Language Model API / Chat Participant API を使うか、通常 command + WebView / Output Channel 構成にするかは未決定。
- `katamor1/project` の `.copilot/` 資料は Copilot Studio bridge 向けの設計も含むため、VSCode 拡張では `copilot_surface` を `vscode` または `vscode-extension` に読み替える必要がある。

## 11. 次の作業

1. `package.json` と `src/extension.ts` を追加する。
2. `modePackLoader.ts` で `.bob/custom_modes.yaml` / `ibm-bob/mode-pack` のどちらを正本にするかを選べるようにする。
3. `messageBuilder.ts` に entry pipeline の JSON 生成を実装する。
4. `schemaValidator.ts` に entry packet / dispatch packet / response の検証を実装する。
5. VSCode command から Markdown 調査結果または route decision preview を出せるようにする。
