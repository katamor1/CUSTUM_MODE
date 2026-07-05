# Phase 0 基盤安定化・運用設計 CODEX向け設計・テスト計画

- 対象リポジトリ: `katamor1/bob_builtin_analyze`
- 対象ディレクトリ: `extensions/`
- 対象拡張機能: `workflow-register`, `bob-bazaar-review`, `bob-code-consistency-review`
- 対象フェーズ: Phase 0 基盤安定化・運用設計
- 作成日: 2026-07-04
- 想定読者: CODEX 実装エージェント、拡張機能オーナー、レビュー担当者

## 1. 目的

本書は、IBM Bob を使った開発工程運営基盤を 7 プロジェクトへ展開する前に、`extensions` 配下 3 拡張機能の安全性、運用品質、配布再現性を安定化するための CODEX 向け設計・テスト計画である。

Phase 0 では、新機能を広げる前に次を固める。

1. `workflow-register` を安全な workflow 実行基盤にする。
2. `bob-bazaar-review` の Bazaar / MCP / review packet 境界を安全にする。
3. `bob-code-consistency-review` の VCS revision と workspace path 境界を統一する。
4. 3 拡張の CI、VSIX package、lockfile、配布確認、運用注意点を標準化する。
5. UAT と次フェーズ開発で使えるテスト観点・成果物パス・受け入れ条件を固定する。

## 2. Phase 0 の完了定義

Phase 0 は、次の状態になったら完了とする。

| 区分 | 完了条件 |
|---|---|
| security | workflow command、MCP cwd、VCS revision、workspace path の境界が明示的に検証され、異常系テストがある。 |
| privacy | task snapshot の保存内容、既定値、redaction、`.gitignore`、運用注意点が明文化されている。 |
| build | 3 拡張それぞれで `npm install` または `npm ci`、`npm run compile`、`npm run test`、`npm run package` を再現できる。 |
| package | VSIX に含めるファイル、source map、依存関係、サイズ予算を確認できる。 |
| compatibility | 既存 command ID、action provider ID、workflow ID、schema version の互換性を壊さない。壊す場合は migration と release note を用意する。 |
| UAT readiness | Bazaar review UAT で使う workflow、成果物パス、review-result schema、運用手順が固定されている。 |

## 3. CODEX 実装原則

CODEX は、以下の制約を守って実装する。

### 3.1 変更単位

1 回の CODEX タスクでは、原則として 1 つの work package だけを実装する。たとえば `WR-01` と `CCR-02` を同時に変更しない。

例外は、テスト helper や共通 docs の小規模更新だけである。

### 3.2 互換性

次の識別子は外部連携に直結するため、原則として変更しない。

- VS Code command ID
- `workflow-register` action provider ID
- workflow `name` / `id`
- result sink type
- Bob に登録する source ID
- review-result schema の既存必須フィールド
- `review-input.yaml` / `bob-output.yaml` の既存 schema enum

やむを得ず変更する場合は、旧名 alias、migration、README 更新、テストを同時に追加する。

### 3.3 trusted workspace 前提

`.bob/workflows/*/WORKFLOW.md` はローカル自動化定義であり、信頼済み workspace でのみ実行する前提とする。ただし、Phase 0 では「信頼済みだから何でも実行できる」状態にはせず、command ID、path、cwd、revision を防御的に検証する。

### 3.4 read-only by default

VCS と MCP は読み取り専用を既定とする。書き込みは以下の明示された成果物領域に限定する。

```text
.bob/workflows/runs/
.bob/review/results/
.bob-review/
.bob-trace/
```

workspace 外への読み書きは、Phase 0 では原則禁止とする。将来必要になる場合は、明示 opt-in と監査ログを別フェーズで設計する。

### 3.5 テスト優先

各 work package は、少なくとも以下を持つ。

- 正常系 unit test
- 失敗すべき入力の unit test
- 既存互換性を守る regression test
- README または docs の更新

## 4. Work package 一覧

| ID | 対象 | 名称 | 優先度 | 主な成果物 |
|---|---|---|---:|---|
| P0-ALL-01 | all | CI / package / lockfile / VSIX 運用基盤 | 1 | CI workflow、lockfile 方針、package 確認手順 |
| P0-WR-01 | workflow-register | command guardrail 強化 | 1 | command ID allowlist / denylist、schema、engine tests |
| P0-WR-02 | workflow-register | task snapshot privacy 強化 | 1 | 既定値見直し、redaction、`.gitignore`、snapshot tests |
| P0-WR-03 | workflow-register | workflow authoring / builder 保存境界強化 | 2 | `.bob/workflows/*/WORKFLOW.md` 境界検証、builder tests |
| P0-BBR-01 | bob-bazaar-review | MCP allowed workspace root 強制 | 1 | MCP config env、server cwd validation、MCP tests |
| P0-BBR-02 | bob-bazaar-review | runtime config clamp と review packet identity | 2 | byte 上限 clamp、packet artifact path、ambiguity tests |
| P0-CCR-01 | bob-code-consistency-review | VCS revision validation 強化 | 1 | Git/Bazaar revision validator、option injection tests |
| P0-CCR-02 | bob-code-consistency-review | workspace path resolver 統一 | 1 | strict resolver、読み書き境界 tests |
| P0-OPS-01 | docs/templates | 運用設計・UAT 準備 | 2 | UAT template、metrics template、運用 README |

### 4.1 現行実装ステータス

本書作成後に Phase 0 相当の実装が進んでいるため、CODEX は次表を起点に「未実装の再実装」ではなく「証跡化、残件補強、最終検証」を行う。

| ID | 現行ステータス | 根拠 / CODEX の扱い |
|---|---|---|
| P0-ALL-01 | verified | `.github/workflows/extensions-quality.yml` が 3 拡張を matrix 相当に検証し、各拡張に `package-lock.json` と `npm ci` 前提の dependency policy がある。CODEX は package smoke と VSIX policy を最終確認する。 |
| P0-WR-01 | verified | `allowedCommandIds` / `deniedCommandIds` は parser、schema、engine tests に反映済み。`vscode.executeCommand` は command ID allowlist なしで fail closed になる。CODEX は互換 workflow の allowlist と regression を維持する。 |
| P0-WR-02 | verified | `taskSnapshots.includeMessages` 既定値は `false`、redaction / truncation / pruning / `.gitignore` helper の tests がある。CODEX は privacy docs へ運用注意を反映する。 |
| P0-WR-03 | remaining | `isWorkflowDocumentPath` による軽量判定はあるが、workspace root、予約名、trailing dot/space、symlink escape を含む保存先 validator としては不足する。CODEX は `workflowBuilderPanel.ts` の保存前チェックを共通 validator へ寄せる。 |
| P0-BBR-01 | verified | `BOB_BAZAAR_ALLOWED_ROOTS`、MCP allowed cwd validation、write tool default disable、`bzr --no-aliases` regression が実装済み。CODEX は package smoke と UAT 手順へ反映する。 |
| P0-BBR-02 | verified | `reviewLimits.ts` の clamp、packet selection の ambiguity handling、workflow state packet URI 優先が実装済み。CODEX は運用 docs で packet path の扱いを固定する。 |
| P0-CCR-01 | verified | Git revision は `git rev-parse --verify --end-of-options <rev>^{commit}` で SHA 解決し、Bazaar revision は option-like / unsafe 値を拒否する tests がある。CODEX は既存正常 fixture を維持する。 |
| P0-CCR-02 | partial | workspace containment helper と複数の path boundary tests はあるが、kind ごとの許可領域、absolute path 拒否、symlink escape 検出が未統一。CODEX は kind-aware resolver を追加し、preprocess / capture / triage / traceability へ適用する。 |
| P0-OPS-01 | remaining | `docs/ops/`、`docs/uat/`、`docs/metrics/` の Phase 0 運用資産が未整備。CODEX は UAT、security/privacy、VSIX release、metrics の 4 文書を追加する。 |

### 4.2 現行 baseline

分離 worktree で作業を開始する前に、次の baseline を確認する。

| 拡張 | baseline command | 期待結果 |
|---|---|---|
| `workflow-register` | `npm.cmd test` | 247 tests, 0 failures |
| `bob-bazaar-review` | `npm.cmd test` | 103 tests, 0 failures |
| `bob-code-consistency-review` | `npm.cmd test` | 91 tests, 0 failures |

新規 worktree では `node_modules` が存在しないため、初回は各拡張で `npm.cmd ci` を実行してから baseline を確認する。

## 5. P0-ALL-01: CI / package / lockfile / VSIX 運用基盤

### 5.1 背景

3 拡張は拡張機能ディレクトリごとに `npm install`、`npm run compile`、`npm run test`、`npm run package` を実行する方針である。Phase 0 ではこの手順を CI と配布前チェックに固定する。

### 5.2 設計

`.github/workflows/extensions-ci.yml` を追加し、以下の matrix で検証する。

```yaml
strategy:
  fail-fast: false
  matrix:
    extension:
      - extensions/workflow-register
      - extensions/bob-bazaar-review
      - extensions/bob-code-consistency-review
```

各 job の基本手順は次の通り。

1. checkout
2. Node.js setup
3. dependency install
   - `package-lock.json` がある場合は `npm ci`
   - lockfile 未整備の拡張では、Phase 0 の移行期間のみ `npm install`
4. `npm run compile`
5. `npm run test`
6. `npm run package`
7. VSIX artifact upload
8. package 内容確認

### 5.3 lockfile 方針

Phase 0 完了時点では、3 拡張すべてに lockfile を置くことを推奨する。

| 拡張 | 方針 |
|---|---|
| `workflow-register` | `package-lock.json` を追加し、CI を `npm ci` に固定する。 |
| `bob-bazaar-review` | 実行時 dependency が少ない場合でも dev dependency 再現性のため lockfile を追加する。 |
| `bob-code-consistency-review` | 既存 lockfile を維持し、`npm ci` を標準にする。 |

### 5.4 VSIX package 方針

各拡張で `.vscodeignore` を確認し、以下を原則として除外する。

```gitignore
src/**
test/**
*.ts
out/**/*.map
coverage/**
.nyc_output/**
```

ただし source map を障害解析に使う運用にする場合は、VSIX size budget に含め、機密情報が含まれないことを確認する。

### 5.5 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| CI matrix | 3 拡張で compile / test / package を実行する。 | すべて成功する。 |
| clean install | 新規 checkout から依存 install を実行する。 | lockfile がある拡張は `npm ci` で成功する。 |
| VSIX listing | package 後に VSIX 内容を確認する。 | `src/**`, `test/**`, 不要な `.map` が含まれない。 |
| artifact budget | VSIX サイズを記録する。 | 予算超過時に warning または fail にできる。 |

### 5.6 受け入れ条件

- CI が main branch と PR で実行される。
- 3 拡張の package artifact を取得できる。
- 失敗時に、どの拡張の compile / test / package が落ちたか分かる。
- lockfile 未整備の拡張が残る場合は、移行 TODO と期限を docs に残す。

## 6. P0-WR-01: `workflow-register` command guardrail 強化

### 6.1 背景

`workflow-register` は command step から action provider を実行できる。`vscode.executeCommand` provider を使う場合、実際の VS Code command ID は `args[0]` に入る。Phase 0 では、provider ID だけではなく、実 command ID まで検証する。

### 6.2 現状の問題

現状の guardrail が provider ID のみを見ている場合、workflow が `vscode.executeCommand` を許可すると、YAML の `args[0]` 次第で想定外の VS Code command を呼べる可能性がある。

### 6.3 設計

#### 6.3.1 effective command の導入

command step 実行前に、次の構造を作る。

```ts
type EffectiveCommandTarget = {
  providerId: string
  commandId?: string
  rawArgs: unknown[]
}
```

`providerId === "vscode.executeCommand"` の場合は、render 後の `args[0]` が string であることを検証し、`commandId` として扱う。

#### 6.3.2 guardrails schema 拡張

既存の `guardrails.allowedCommands` / `guardrails.deniedCommands` は provider ID 用として維持し、次を追加する。

```yaml
guardrails:
  allowedCommands:
    - vscode.executeCommand
  allowedCommandIds:
    - bobBazaar.collectReviewContext
    - bobBazaar.loadReviewRules
  deniedCommandIds:
    - workbench.action.closeWindow
```

判定順序は次の通り。

1. provider ID が `deniedCommands` に含まれる場合は拒否。
2. command ID が `deniedCommandIds` に含まれる場合は拒否。
3. `allowedCommands` がある場合、provider ID が含まれなければ拒否。
4. `providerId === "vscode.executeCommand"` の場合、`allowedCommandIds` が存在しなければ拒否。
5. `allowedCommandIds` がある場合、command ID が含まれなければ拒否。

#### 6.3.3 互換性

既存 workflow との互換性のため、Phase 0 では次の移行策を用意する。

- `vscode.executeCommand` を使う既存 workflow に `allowedCommandIds` を追加する。
- 既存 workflow が `allowedCommandIds` なしで失敗する場合、diagnostics に修正方法を表示する。
- README と workflow authoring guide に migration 例を追加する。

### 6.4 テスト計画

| レイヤー | テスト | 期待結果 |
|---|---|---|
| parser / validator | `allowedCommandIds` と `deniedCommandIds` を含む YAML を読み込む。 | schema validation が通る。 |
| engine | `vscode.executeCommand` + 許可 command ID を実行する。 | 実行成功し、従来と同じ resultKey に保存される。 |
| engine | `vscode.executeCommand` + 未許可 command ID を実行する。 | command step が失敗し、実 command ID を含むエラーを返す。 |
| engine | `deniedCommandIds` に一致する command ID を実行する。 | `allowedCommandIds` に含まれていても拒否する。 |
| regression | provider ID だけの custom action provider を実行する。 | `allowedCommands` の既存挙動が維持される。 |
| diagnostics | `allowedCommandIds` なしの `vscode.executeCommand` workflow を検証する。 | 修正方法が分かる warning / error を表示する。 |

### 6.5 受け入れ条件

- `vscode.executeCommand` は exact command ID allowlist がない限り実行されない。
- 既存の `bobBazaar.collectReviewContext`, `bobBazaar.loadReviewRules`, `bobBazaar.captureReviewResult` を使う workflow は、allowlist 追加後に成功する。
- テストに「許可」「拒否」「deny 優先」「移行 diagnostics」が含まれる。

## 7. P0-WR-02: task snapshot privacy 強化

### 7.1 背景

`workflow-register` は Bob UI 実行時に task snapshot を `.bob/workflows/runs/<runId>/task-snapshots` へ保存できる。snapshot は障害解析に有用だが、Bob chat message、コード断片、文書抜粋、社内情報が残る可能性がある。

### 7.2 設計

#### 7.2.1 既定値

Phase 0 では次を推奨既定値とする。

```json
{
  "workflowRegister.taskSnapshots.enabled": true,
  "workflowRegister.taskSnapshots.includeMessages": false,
  "workflowRegister.taskSnapshots.includeMetadata": false,
  "workflowRegister.taskSnapshots.redact": true
}
```

既存設定との互換性が問題になる場合は、設定変更を release note に明記する。

#### 7.2.2 redaction

snapshot 保存前に、少なくとも以下を redaction 対象にする。

- `password`, `passwd`, `secret`, `token`, `api_key`, `apikey`, `authorization`
- access token らしい長いランダム文字列
- PEM block
- `.env` 形式の key-value

redaction は過検出してよい。snapshot は診断補助であり、完全な会話保存を目的にしない。

#### 7.2.3 `.gitignore` 推奨

docs に次を追記する。

```gitignore
.bob/workflows/runs/**/task-snapshots/
.bob/workflows/runs/**/latest.json
.bob-review/bob-output/
.bob-review/review-package/
.bob-trace/ai-traceability-draft/
```

#### 7.2.4 診断情報の分離

機密混入リスクが低い run state と、Bob message を含み得る task snapshot を分ける。

- `run.json`: workflow state, step status, artifact path, error summary
- `task-snapshots/*.json`: Bob task message / metadata / export 等の optional 診断情報

### 7.3 テスト計画

| レイヤー | テスト | 期待結果 |
|---|---|---|
| config | `includeMessages` 未設定で snapshot を保存する。 | messages が保存されない。 |
| config | `includeMessages: true` で snapshot を保存する。 | messages が保存されるが redaction 済み。 |
| redaction | token / password / PEM を含む payload を保存する。 | secret 値が `[REDACTED]` になる。 |
| max bytes | 大きな messages を渡す。 | maxBytes 内に収まり、truncated warning が入る。 |
| prune | maxPerRun を超えて保存する。 | 古い snapshot が削除される。 |
| docs | `.gitignore` 例を確認する。 | 誤コミットしやすい生成物が除外対象になっている。 |

### 7.4 受け入れ条件

- 既定設定で Bob chat message が snapshot に残らない。
- opt-in した場合でも redaction が働く。
- README または docs に privacy 注意点と `.gitignore` 例がある。
- snapshot 保存の unit test が secret 混入を検出できる。

## 8. P0-WR-03: workflow authoring / builder 保存境界強化

### 8.1 背景

`workflow-register` は GUI Builder や AI 改善で `WORKFLOW.md` を作成・編集できる。edit mode でも保存先を `.bob/workflows/*/WORKFLOW.md` に限定する必要がある。

### 8.2 設計

#### 8.2.1 保存先 validator

共通 helper を追加する。

```ts
type WorkflowFileValidationResult =
  | { ok: true; workflowName: string; path: string }
  | { ok: false; reason: string }
```

検証ルール:

- workspace root 内である。
- 相対 path が `.bob/workflows/<name>/WORKFLOW.md` に一致する。
- `<name>` は `workflow-register/v1` の `name` ルールを満たす。
- Windows 予約名、trailing dot、trailing space を拒否する。
- symlink escape を考慮し、可能なら realpath で workspace 内判定する。

#### 8.2.2 AI 改善適用時の backup

AI 改善を適用する場合は、既存ファイルを `.bak-<timestamp>` に退避する。ただし backup も `.bob/workflows/<name>/` 配下に限定する。

### 8.3 テスト計画

| テスト | 入力 | 期待結果 |
|---|---|---|
| valid | `.bob/workflows/sample/WORKFLOW.md` | 保存許可 |
| escape | `../outside/WORKFLOW.md` | 拒否 |
| wrong folder | `.bob/not-workflows/sample/WORKFLOW.md` | 拒否 |
| wrong filename | `.bob/workflows/sample/OTHER.md` | 拒否 |
| reserved | `.bob/workflows/CON/WORKFLOW.md` | Windows 互換のため拒否 |
| trailing dot | `.bob/workflows/sample./WORKFLOW.md` | 拒否 |
| backup | valid workflow の AI 改善適用 | 同一 workflow folder に backup 作成 |

### 8.4 受け入れ条件

- GUI Builder、AI 改善、template 作成のすべてで同じ保存先 validator を使う。
- workspace 外、`.bob/workflows` 外、予約名が拒否される。
- 拒否時のエラーは、ユーザーが修正できる具体的な内容になっている。

## 9. P0-BBR-01: `bob-bazaar-review` MCP allowed workspace root 強制

### 9.1 背景

`bob-bazaar-review` の MCP server は Bazaar 操作を読み取り専用で公開する。読み取り専用でも、任意 `cwd` を受け取ると Bob / LLM 経由で想定外の Bazaar repo や `.bob/review` を読める可能性がある。

### 9.2 設計

#### 9.2.1 `.bob/mcp.json` に allowed root を渡す

`bobBazaar.configureMcp` は、workspace root を MCP server の環境変数へ渡す。

```json
{
  "mcpServers": {
    "bazaar": {
      "command": "<node executable>",
      "args": ["<extension>/out/mcp/server.js"],
      "env": {
        "BZR_PATH": "bzr",
        "BOB_BAZAAR_ALLOWED_ROOTS": "<workspace-root>"
      },
      "disabled": false
    }
  }
}
```

複数 root workspace を将来扱う場合は path delimiter 区切りにする。ただし Phase 0 では単一 workspace root を基本にする。

#### 9.2.2 server 側 cwd validation

MCP tool は実行前に cwd を正規化し、allowed root 配下であることを確認する。

検証ルール:

- cwd 未指定時は allowed root を使う。
- cwd 指定時は realpath / normalize 後に allowed root 配下か確認する。
- allowed root 外なら tool error にする。
- `project_rules_init` など書き込みを伴う tool も同じ制限を使う。

#### 9.2.3 Bazaar alias 対策の維持

Bazaar CLI は引き続き `bzr --no-aliases <command>` 形式で実行する。Phase 0 の変更で alias 対策を壊さない。

### 9.3 テスト計画

| レイヤー | テスト | 期待結果 |
|---|---|---|
| MCP config | `configureMcp` を実行する。 | `.bob/mcp.json` に `BOB_BAZAAR_ALLOWED_ROOTS` が入る。 |
| MCP server | cwd 未指定で `bazaar_root` を呼ぶ。 | allowed root で実行される。 |
| MCP server | allowed root 配下 cwd で `bazaar_log` を呼ぶ。 | 実行される。 |
| MCP server | allowed root 外 cwd で `bazaar_log` を呼ぶ。 | 拒否され、Bazaar CLI は起動しない。 |
| MCP server | allowed root 外 cwd で `project_rules_init` を呼ぶ。 | 拒否され、ファイルは作られない。 |
| regression | `bzr` 実行引数を検査する。 | `--no-aliases` が常に付く。 |

### 9.4 受け入れ条件

- MCP server が allowed root 外の cwd を拒否する。
- MCP config 生成時に allowed root が明示される。
- 読み取り専用 tool と project rules tool の両方で同じ cwd validation を使う。
- test double を使い、拒否時に Bazaar CLI が呼ばれないことを確認する。

## 10. P0-BBR-02: runtime config clamp と review packet identity

### 10.1 背景

`bob-bazaar-review` は diff や追加ファイル本文を review packet に含める。設定値が極端だと memory pressure や空 packet の原因になる。また `collectReviewContext` が開いている document から marker 検索する運用だけだと、複数 packet が開いているときに誤対象を拾う可能性がある。

### 10.2 設計

#### 10.2.1 config clamp

設定 getter で runtime clamp を行う。

| 設定 | 最小 | 最大 | 不正値時 |
|---|---:|---:|---|
| `bobBazaar.maxDiffBytes` | 4096 | 5242880 | default に戻し warning |
| `bobBazaar.maxAddedFileContentBytes` | 0 | 1048576 | default に戻し warning |

`NaN`, `Infinity`, 負数、文字列は拒否する。

#### 10.2.2 review packet identity

review packet 生成時に、packet artifact を workspace 内に保存できるようにする。

候補:

```text
.bob/review/packets/<review_id>.md
```

workflow 実行時は、`collectReviewContext` に `packetPath` を渡せるようにする。

優先順位:

1. workflow input / action args の `packetPath`
2. latest generated packet state
3. active editor fallback
4. open documents marker search fallback

複数候補がある場合は、黙って選ばず ambiguity error にする。

### 10.3 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| clamp high | `maxDiffBytes` に極端な大値を設定 | 最大値に clamp される。 |
| clamp invalid | `maxAddedFileContentBytes` に `NaN` 相当 | default に戻る。 |
| packetPath | workflow args から packetPath を渡す。 | 指定 packet を読み込む。 |
| ambiguity | 複数 packet document が開いている。 | ambiguity error になり、古い packet を勝手に使わない。 |
| fallback | active editor に packet がある。 | 既存 fallback が動く。 |

### 10.4 受け入れ条件

- 設定値は runtime で安全範囲に収まる。
- workflow から明示 `packetPath` で context 収集できる。
- 複数 packet 候補時に誤対象を自動選択しない。

## 11. P0-CCR-01: `bob-code-consistency-review` VCS revision validation 強化

### 11.1 背景

`bob-code-consistency-review` は Git / Bazaar の base / head / revision を CLI args に渡す。`execFile` により shell injection は避けられるが、revision 値を option として解釈される形で渡すと予期しない動作につながる可能性がある。

### 11.2 設計

#### 11.2.1 Git revision resolver

Git revision は、diff へ直接渡す前に SHA へ解決する。

```bash
git rev-parse --verify --end-of-options <rev>^{commit}
```

設計方針:

- `--end-of-options` を使う。
- 解決結果は full SHA として保持する。
- base / head の両方を解決してから diff に渡す。
- branch name や tag name は許可してよいが、必ず SHA に解決する。
- `--help`, `--output=...` など option injection になる値は拒否されることをテストする。

#### 11.2.2 Bazaar revision validator

Bazaar revision は `bob-bazaar-review` と同等の validator を共有、または同等仕様で実装する。

許可例:

```text
1
123
revid:xxx
last:1
tag:release-1.0.0
```

拒否例:

```text
--help
--output=/tmp/x
; rm -rf /
../outside
```

実際の Bazaar revision grammar に完全対応するより、Phase 0 では安全側に倒す。

### 11.3 テスト計画

| レイヤー | テスト | 期待結果 |
|---|---|---|
| Git resolver | `HEAD` を解決する。 | full SHA が返る。 |
| Git resolver | branch 名を解決する。 | full SHA が返る。 |
| Git resolver | `--help` を渡す。 | 拒否され、diff は実行されない。 |
| Git resolver | 存在しない revision を渡す。 | 分かりやすい validation error。 |
| Bazaar validator | `123` を渡す。 | 許可。 |
| Bazaar validator | `--output=x` を渡す。 | 拒否。 |
| pipeline | review-input.yaml の base/head から diff 生成する。 | 解決済み revision を使う。 |

### 11.4 受け入れ条件

- Git diff / Bazaar diff の前に revision validation が必ず実行される。
- option injection 文字列が拒否される。
- validation error は `review-input.yaml` のどの項目が悪いか分かる。
- 既存の正常系 fixture が壊れない。

## 12. P0-CCR-02: workspace path resolver 統一

### 12.1 背景

`bob-code-consistency-review` は `review-input.yaml`、文書、diff fixture、Bob output、triage 出力など複数種類の path を扱う。absolute path を許容する箇所が分散すると、workflow args や hand-written input から workspace 外を読んだり書いたりできる可能性がある。

### 12.2 設計

#### 12.2.1 strict resolver

共通 helper を導入する。

```ts
type WorkspacePathKind =
  | "input"
  | "document"
  | "reviewPackageOut"
  | "bobOutputOut"
  | "triageOut"
  | "traceabilityCatalog"
  | "temp"

type ResolveWorkspacePathOptions = {
  root: string
  path: string
  kind: WorkspacePathKind
  mustExist?: boolean
  allowCreate?: boolean
}
```

原則:

- absolute path は拒否する。
- `..` による workspace escape を拒否する。
- realpath で symlink escape を検出できる場合は拒否する。
- 書き込み先は `.bob-review`, `.bob-trace`, `.bob/workflows/runs` 等の明示領域に限定する。
- 文書読み取りは workspace 内のみ許可する。

#### 12.2.2 path kind ごとの許可領域

| kind | 許可領域 | 書き込み |
|---|---|---|
| `input` | workspace root 配下 | read |
| `document` | workspace root 配下 | read |
| `reviewPackageOut` | `.bob-review/review-package` 配下 | write |
| `bobOutputOut` | `.bob-review/bob-output` 配下 | write |
| `triageOut` | `.bob-review/human-triage` 配下 | write |
| `traceabilityCatalog` | `.bob-trace` 配下 | read/write |
| `temp` | `.bob-review/tmp` 配下 | write |

### 12.3 テスト計画

| テスト | path | kind | 期待結果 |
|---|---|---|---|
| relative document | `docs/spec.md` | document | 許可 |
| absolute document | `/tmp/spec.md` | document | 拒否 |
| parent escape | `../secret.md` | document | 拒否 |
| package out | `.bob-review/review-package/manifest.yaml` | reviewPackageOut | 許可 |
| wrong out | `docs/out.yaml` | bobOutputOut | 拒否 |
| trace catalog | `.bob-trace/traceability-catalog.json` | traceabilityCatalog | 許可 |
| symlink escape | workspace 内 symlink -> 外部 | document | 可能なら拒否 |

### 12.4 受け入れ条件

- path 解決 helper が 1 箇所に集約される。
- review-input builder、pipeline、Bob output capture、triage、traceability が同じ helper を使う。
- workspace 外読み書きの異常系テストがある。
- 既存の relative path 利用は壊れない。

## 13. P0-OPS-01: 運用設計・UAT 準備

### 13.1 目的

Phase 0 の開発結果を、実案件 UAT で使える運用資産に落とし込む。

### 13.2 追加・更新する docs 候補

| path | 内容 |
|---|---|
| `docs/uat/bazaar-review-uat-plan-ja.md` | Bazaar review UAT の手順、対象、記録方法、合否条件。 |
| `docs/ops/bob-workflow-security-privacy-ja.md` | workflow command、MCP、snapshot、成果物共有範囲の注意点。 |
| `docs/ops/extensions-vsix-release-checklist-ja.md` | VSIX build、install、version、rollback、known issues。 |
| `docs/metrics/bob-workflow-metrics-ja.md` | workflow 実行回数、schema 検証成功率、採用指摘率などの定義。 |
| `.gitignore` または docs template | `.bob` / `.bob-review` / `.bob-trace` の推奨除外。 |

### 13.3 UAT 記録項目

Bazaar review UAT では、最低限次を記録する。

| 区分 | 項目 |
|---|---|
| 対象 | project, repository, revision/range, changed files |
| 実行 | workflow id, run id, operator, started_at, finished_at |
| 成果物 | review packet path, review-result json, markdown report |
| 品質 | schema validation result, checklist pass/fail/unknown/blocked |
| 人間判断 | accepted findings, rejected findings, needs investigation |
| 運用 | failure step, retry count, manual gate wait, issue memo |
| privacy | snapshot enabled, includeMessages, external sharing allowed |

### 13.4 受け入れ条件

- UAT 担当者が docs だけで Bazaar review を実行・記録できる。
- Phase 0 の security / privacy 設定が UAT 手順に反映されている。
- UAT 結果を次フェーズの改善 backlog に変換できる形式になっている。

## 14. 全体テスト戦略

### 14.1 テスト層

| 層 | 目的 | 実行者 | 実行タイミング |
|---|---|---|---|
| unit | parser、validator、resolver、redaction、config clamp を高速検証する。 | CODEX / CI | 各 commit |
| integration | VS Code command、workflow action provider、MCP server、VCS CLI wrapper の境界を検証する。 | CODEX / 開発者 | work package 完了時 |
| package smoke | VSIX build と clean install を検証する。 | CI / 開発者 | release candidate |
| manual UAT | Bob IDE / VS Code 上で実 workflow を実行する。 | UAT 担当 | Phase 0 完了判定 |

### 14.2 共通 negative tests

Phase 0 では、正常系だけでなく「拒否されるべき入力」を必ずテストする。

| 観点 | 拒否されるべき入力 |
|---|---|
| command | `vscode.executeCommand` で allowlist にない command ID |
| command | denylist にある command ID |
| snapshot | secret を含む payload の未 redaction 保存 |
| workflow path | `.bob/workflows` 外の保存先 |
| MCP cwd | allowed root 外の cwd |
| Bazaar config | 極端な byte limit |
| Git revision | `--help`, `--output=...`, 存在しない rev |
| workspace path | absolute path, `../`, symlink escape |

### 14.3 手動 UAT シナリオ

| ID | シナリオ | 期待結果 |
|---|---|---|
| UAT-P0-01 | 3 拡張を clean profile に VSIX install する。 | activation error が出ない。 |
| UAT-P0-02 | Bazaar workspace で `.bob` 初期化を行う。 | workflow、review schema、MCP config が作成される。 |
| UAT-P0-03 | `bazaar-project-rule-review` を許可済み command ID で実行する。 | context 収集、rules 読み込み、Bob 分析、result capture が進む。 |
| UAT-P0-04 | allowlist なしの危険 command workflow を実行する。 | 実行前に拒否される。 |
| UAT-P0-05 | task snapshot 既定値で workflow を実行する。 | Bob message が snapshot に保存されない。 |
| UAT-P0-06 | MCP tool に workspace 外 cwd を渡す。 | tool error になり Bazaar CLI は実行されない。 |
| UAT-P0-07 | Git review-input に `--help` を入れる。 | validation error になり diff は実行されない。 |
| UAT-P0-08 | `review-input.yaml` に workspace 外 path を入れる。 | validation error になり読み取りされない。 |

## 15. CODEX への作業指示テンプレート

各 work package を CODEX に渡すときは、次の形式を使う。

```text
対象: <work package ID>
目的: <1文で目的>
変更対象:
- <path 1>
- <path 2>

制約:
- 既存 command ID / provider ID は変更しない。
- 既存正常系テストを壊さない。
- workspace 外読み書きは追加しない。
- README/docs とテストを同時に更新する。

実装内容:
1. <実装ステップ>
2. <実装ステップ>
3. <実装ステップ>

テスト:
- npm run compile
- npm run test
- 追加する異常系テスト: <list>

完了条件:
- <受け入れ条件>
```

## 16. 推奨実装順

Phase 0 は、以下の順で進める。

1. `P0-ALL-01`: CI / package / lockfile / VSIX 運用基盤
2. `P0-WR-01`: command guardrail 強化
3. `P0-WR-02`: task snapshot privacy 強化
4. `P0-WR-03`: workflow authoring / builder 保存境界強化
5. `P0-BBR-01`: MCP allowed workspace root 強制
6. `P0-BBR-02`: config clamp と review packet identity
7. `P0-CCR-02`: workspace path resolver 統一
8. `P0-CCR-01`: VCS revision validation 強化
9. `P0-OPS-01`: UAT / 運用 docs 整備

`CCR-02` を `CCR-01` より先にする理由は、revision validation の error report や review-input validation が path resolver と同じ診断基盤を使いやすいためである。

## 17. CODEX レビュー観点

CODEX が実装後に自己点検すべき観点は次の通り。

| 観点 | 確認内容 |
|---|---|
| boundary | 外部入力、workspace path、cwd、revision、command ID を実行前に検証しているか。 |
| fail closed | 設定不備や validation 不能時に安全側で失敗するか。 |
| diagnosability | 拒否理由がユーザーと開発者に分かるか。 |
| compatibility | 既存 workflow、command、provider、schema を壊していないか。 |
| testability | pure helper と VS Code 依存層が分かれ、unit test しやすいか。 |
| privacy | Bob message、文書抜粋、secret が不用意に永続化されないか。 |
| package | VSIX に不要な source、test、map、大容量 fixture が入らないか。 |

## 18. Phase 0 で実装しないこと

以下は Phase 0 の範囲外とする。

- Git project rule review の本格実装
- Java / C# / SQL の詳細解析 adapter 実装
- workflow catalog の大量追加
- 7 プロジェクト全体への横展開
- Bob 出力品質の大規模評価
- traceability sidecar の機能拡張
- MCP による書き込み系 VCS 操作

これらは Phase 1 以降で、Phase 0 の安全基盤が完了してから扱う。

## 19. 参照資料

- `docs/extensions-review-2026-07-04-14afe83c.md`
- `docs/extensions-maintainability-review-2026-07-04-14afe83c.md`
- `extensions/README.md`
- `extensions/workflow-register/README.md`
- `extensions/bob-bazaar-review/README.md`
- `extensions/bob-code-consistency-review/README.md`
- `docs/workflow-authoring-guide-ja.md`
- `docs/workflows/code-consistency-review/README.md`

## 20. 推奨コミット

```text
docs: add phase 0 Codex design and test plan
```
