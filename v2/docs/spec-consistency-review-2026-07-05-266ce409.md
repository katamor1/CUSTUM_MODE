# 仕様整合レビュー（GitHub 全体）

## メタ情報

- Repository: `katamor1/bob_builtin_analyze`
- 対象 TOP: `266ce4090f6313c1eb1df4360f4bc19344a6f710`
- 対象 commit message: `Exclude extension docs from VSIX packages`
- レビュー種別: GitHub 上の静的な仕様整合レビュー
- レビュー作成日: 2026-07-05
- レビュー結果ブランチ: `docs/spec-consistency-review-266ce409`

## レビュー範囲

主に次を横断して、仕様・契約・実装入口・配布ポリシーの整合を確認した。

- `extensions/README.md`
- `extensions/*/README.md`
- `extensions/*/package.json`
- `extensions/*/.vscodeignore`
- `extensions/*/src/extension*.ts`
- `extensions/*/src/**/workflow*`
- `.bob/workflows/code-consistency-review/WORKFLOW.md`
- `docs/workflow-action-contracts-ja.md`
- `docs/artifact-metadata-contract-ja.md`
- `docs/workflows/code-consistency-review/README.md`
- `scripts/check-vsix-policy.js`

今回のレビューでは GitHub 上のファイル照合を行い、`npm test`、`npm run compile`、`npm run package` は実行していない。

## 総評

3 拡張構成、成果物 metadata、VSIX 同梱除外ポリシーはかなり整理されている。特に TOP commit で追加された `docs/**` の VSIX 除外は、各 `.vscodeignore`、README、package policy script の方向性が揃っており、配布物サイズ・開発文書分離の観点では整合している。

一方で、`contract` と名付けて固定 ID / 固定 API の正本にしている文書に、実装とズレている箇所が残っている。影響が大きいのは `workflow-register` の public API と `bob-code-consistency-review` の action provider 一覧で、将来のリファクタリング時に「契約上守るべき ID / signature」が曖昧になるリスクがある。

## 指摘一覧

| ID | 重要度 | 対象 | 概要 |
| --- | --- | --- | --- |
| F-01 | High | `docs/workflow-action-contracts-ja.md` / `workflow-register` | public API contract が実装と不一致 |
| F-02 | High | `docs/workflow-action-contracts-ja.md` / `bob-code-consistency-review` | action provider contract の一覧が実装より少ない |
| F-03 | Medium | 各拡張 README / `package.json` | Command Palette / 設定一覧が manifest と同期していない |
| F-04 | Medium | `docs/workflows/code-consistency-review/README.md` | 実装分割状況の説明が古い |
| F-05 | Medium / 要判断 | `.bob/workflows/code-consistency-review/WORKFLOW.md` | `workspaceRequired: false` と `requires.workspace: true` が同居 |
| F-06 | Low | workflow-register docs | workflow 探索範囲の表現が文書間で微妙に異なる |

---

## F-01: `workflow-register` public API contract が実装と不一致

### 対象

- `docs/workflow-action-contracts-ja.md`
- `extensions/workflow-register/src/extension.ts`
- `extensions/workflow-register/docs/detailed-design-ja.md`
- `extensions/workflow-register/README.md`

### 内容

`docs/workflow-action-contracts-ja.md` は `workflow-register` の公開 API contract を固定する文書だが、実装の `WorkflowRegisterApi` と一致していない。

実装側 `extensions/workflow-register/src/extension.ts` の `WorkflowRegisterApi` は、概ね次を公開している。

```ts
registerActionProvider(provider)
registerAgentProvider(provider)
registerResultSink(type, handler)
listWorkflows()
runWorkflow(workflowId?, inputs?)
runWorkflowStep(workflowId?, stepId?, inputs?)
runNextStep(runId?)
approveBranchCheckpoint(runId?)
abortBranchCheckpoint(runId?)
inspectBranching(runId?)
```

一方、`docs/workflow-action-contracts-ja.md` では次のようなズレがある。

- `registerResultSink(sink)` と書かれているが、実装は `registerResultSink(type, handler)`。
- `runWorkflowStep(runId, stepId, inputs)` と書かれているが、実装は `runWorkflowStep(workflowId?, stepId?, inputs?)`。
- `runNextStep(runId, inputs)` と書かれているが、実装は `runNextStep(runId?)`。
- `listWorkflows()` が contract 表にない。
- `approveBranchCheckpoint()`、`abortBranchCheckpoint()`、`inspectBranching()` が contract 表にない。

`extensions/workflow-register/docs/detailed-design-ja.md` の API snippet も `approveBranchCheckpoint()`、`abortBranchCheckpoint()`、`inspectBranching()` を含んでいないため、こちらも実装に追従しきれていない。

### 影響

- companion extension から public API を使う場合、contract 文書だけを見ると誤った引数で実装を呼ぶ可能性がある。
- branch checkpoint 系 API が contract に載っていないため、互換性維持対象かどうかが曖昧になる。
- `contract` 文書が正本として機能しなくなる。

### 推奨対応

1. `docs/workflow-action-contracts-ja.md` の public API 表を実装に合わせて更新する。
2. `extensions/workflow-register/docs/detailed-design-ja.md` の API snippet も同じ内容に更新する。
3. 可能なら、`WorkflowRegisterApi` の exported interface と `docs/workflow-action-contracts-ja.md` の API 表を突き合わせる drift test を追加する。

---

## F-02: `bob-code-consistency-review` action provider contract の一覧が実装より少ない

### 対象

- `docs/workflow-action-contracts-ja.md`
- `extensions/bob-code-consistency-review/src/workflowProviderRegistration.ts`
- `.bob/workflows/code-consistency-review/WORKFLOW.md`
- `extensions/bob-code-consistency-review/package.json`

### 内容

`docs/workflow-action-contracts-ja.md` の `bob-code-consistency-review providers` では、次の 9 provider が contract として列挙されている。

```text
bobCodeConsistency.prepareAiTraceabilityDraft
bobCodeConsistency.applyAiTraceabilityDraft
bobCodeConsistency.openTraceabilityPrep
bobCodeConsistency.validateTraceabilityCatalog
bobCodeConsistency.createReviewInputFromTraceability
bobCodeConsistency.preprocess
bobCodeConsistency.captureBobOutput
bobCodeConsistency.validateOutput
bobCodeConsistency.triage
```

これは `.bob/workflows/code-consistency-review/WORKFLOW.md` の現在の guardrails / workflow steps とは一致している。

ただし、実装側 `extensions/bob-code-consistency-review/src/workflowProviderRegistration.ts` は、上記に加えて次の provider も `workflow-register` へ登録している。

```text
bobCodeConsistency.initializeWorkspace
bobCodeConsistency.createReviewInput
bobCodeConsistency.prepareAiReviewInputDraft
bobCodeConsistency.applyAiReviewInputDraft
bobCodeConsistency.repairReviewInput
bobCodeConsistency.explainReviewInputDiagnostics
```

つまり、実装上は 15 provider が登録されているが、contract 文書では 9 provider だけが固定 ID として扱われている。

### 影響

- contract 文書に載っていない provider ID が、将来の整理で誤って rename / 削除されるリスクがある。
- workflow author が contract 文書を見ても、利用可能な provider の全体像を把握できない。
- 「現在の workflow が使う provider」と「拡張が公開する provider」が混ざって見え、互換性境界が曖昧になる。

### 推奨対応

次のいずれかに統一する。

1. 実装で登録している 15 provider すべてを `docs/workflow-action-contracts-ja.md` に追記し、`workflow-core` / `authoring-helper` / `diagnostic-helper` のように分類する。
2. contract 対象を 9 provider に限定する方針なら、残り 6 provider は `internal / unstable` と明記する。
3. provider ID 一覧を実装から抽出し、contract 文書との差分を検出する drift test を追加する。

---

## F-03: Command Palette / 設定一覧が manifest と同期していない

### 対象

- `extensions/README.md`
- `extensions/workflow-register/README.md`
- `extensions/workflow-register/docs/detailed-design-ja.md`
- `extensions/bob-bazaar-review/README.md`
- `extensions/bob-code-consistency-review/README.md`
- `extensions/*/package.json`
- `extensions/*/src/extension*.ts`

### 内容

`extensions/README.md` は、各拡張 README に Command Palette のコマンド一覧を書く方針を定めている。また、Command Palette 表示名は `category: title` の完成形で記載する方針になっている。

ただし、各 README の表と `package.json` / `registerCommand` 実装に差分がある。

#### `bob-code-consistency-review`

`package.json` と `src/extension.ts` は次の GUI / wizard command を公開している。

```text
bobCodeConsistency.openReviewWizard
bobCodeConsistency.openResultCaptureGui
bobCodeConsistency.openHumanTriageGui
```

しかし `extensions/bob-code-consistency-review/README.md` の Command Palette 表は `initializeWorkspace` 以降から始まっており、上記 3 command が載っていない。

また、設定一覧にも次の manifest 設定が載っていない。

```text
bobCodeConsistency.maxDocumentBytes
bobCodeConsistency.maxWorkbookSheets
bobCodeConsistency.maxRowsPerSheet
bobCodeConsistency.maxExcerptBytesPerDocument
bobCodeConsistency.maxRawDiffBytes
bobCodeConsistency.maxBobInputBytes
```

#### `bob-bazaar-review`

`package.json` と `src/extension.ts` は次を公開している。

```text
bobBazaar.openResultCaptureGui
bobBazaar.openHumanTriageGui
```

しかし `extensions/bob-bazaar-review/README.md` の Command Palette 表には、この 2 command が載っていない。

#### `workflow-register`

`package.json` と `src/extensionWithAuthoring.ts` は、Run Control、Operation Hub、`bobProcess.*`、`bobTemplate.*` を含む多数の command を Command Palette へ出している。

一方、`extensions/workflow-register/README.md` の実行・運用表は主要 workflow 操作に寄っており、次のような公開 command を網羅していない。

```text
workflowRegister.openOperationHub
workflowRegister.refreshRunsView
workflowRegister.pauseCurrentRun
workflowRegister.pauseAfterCurrentStep
workflowRegister.pauseBeforeNextAiCall
workflowRegister.resumePausedRun
workflowRegister.inspectRunControl
bobProcess.*
bobTemplate.*
```

`extensions/workflow-register/docs/detailed-design-ja.md` の Command entry 表には `bobTemplate.*` はあるが、実装で登録されている `bobProcess.*` が載っていない。

### 影響

- VS Code の Command Palette では見えるのに README では探せない command が発生する。
- ユーザー向け command と workflow / internal helper command の境界が曖昧になる。
- README 方針そのものと個別 README の実態がズレる。

### 推奨対応

1. 各拡張 README に `package.json` の `contributes.commands` と一致する一覧を追加する。
2. ユーザーに直接案内しない command は `内部 / workflow 連携用 / advanced` と明記する。
3. `package.json` の `contributes.commands` から README 用 Markdown を生成する script、または差分を検出する test を追加する。
4. `bob-code-consistency-review` の設定表に size / limit 系設定も追記する。

---

## F-04: `docs/workflows/code-consistency-review/README.md` の実装分割状況が古い

### 対象

- `docs/workflows/code-consistency-review/README.md`
- `extensions/bob-code-consistency-review/README.md`
- `extensions/bob-code-consistency-review/src/extension.ts`

### 内容

`docs/workflows/code-consistency-review/README.md` の「現在の runtime モジュール分割」では、`src/extension.ts` に「まだ分離していない command handler 群」が残っている説明や、今後の分割候補として `traceabilityCommands.ts`、`reviewInputCommands.ts`、`reviewExecutionCommands.ts` が挙がっている。

しかし現行実装では、`src/extension.ts` はすでに次を import して command 登録 / provider mapping の composition root に近い役割へ寄っている。

```text
src/commands/reviewInputCommands.ts
src/traceabilityCommands.ts
src/reviewExecutionCommands.ts
```

`extensions/bob-code-consistency-review/README.md` の「現在の実装分割」はこの状態に近く、`docs/workflows/code-consistency-review/README.md` 側だけが古い状態を残している。

### 影響

- 実装理解の入口として `docs/workflows/code-consistency-review/README.md` を読んだ場合、現在のファイル構成と作業候補を誤認する。
- 既に完了した分割を「今後の候補」として再度実施しようとする可能性がある。

### 推奨対応

1. `docs/workflows/code-consistency-review/README.md` の module split section を `extensions/bob-code-consistency-review/README.md` と同期する。
2. 今後の分割候補は、現行の composition root / command option helper / webview / core pipeline の観点で書き直す。

---

## F-05: `workspaceRequired: false` と `requires.workspace: true` が同居している

### 対象

- `.bob/workflows/code-consistency-review/WORKFLOW.md`

### 内容

`.bob/workflows/code-consistency-review/WORKFLOW.md` では次の指定が同居している。

```yaml
workspaceRequired: false
requires:
  workspace: true
```

この workflow は文書候補収集、traceability catalog、review-input 生成、review-package 生成を行うため、実行時には workspace が必要に見える。一方、`workspaceRequired: false` は Bob UI 上の表示条件や有効条件として読むと、workspace なしでも起動可能に見える。

### 影響

- Bob UI / standalone runner / preflight のどの段階で workspace 必須と扱うのかが読み手に伝わりにくい。
- workspace なしで workflow が見えるが、実行時 preflight で止まるような UX になる可能性がある。

### 推奨対応

方針を明確にする。

- workspace が常に必要なら、`workspaceRequired: true` へ変更する。
- Bob UI には見せたいが実行時 preflight で止める設計なら、`workspaceRequired: false` を維持する理由を workflow コメントまたは仕様文書に追記する。

---

## F-06: workflow 探索範囲の表現が文書間で微妙に異なる

### 対象

- `extensions/workflow-register/README.md`
- `extensions/workflow-register/docs/detailed-design-ja.md`
- `extensions/README.md`

### 内容

`extensions/workflow-register/README.md` と `extensions/README.md` では、読み込み対象を主に次のように説明している。

```text
.bob/workflows/*/WORKFLOW.md
```

一方、`extensions/workflow-register/docs/detailed-design-ja.md` では次のように、より広い探索を示している。

```text
**/.bob/workflows/*/WORKFLOW.md
```

さらに detailed design では direct candidate、child candidate、fallback candidate による root 解決も説明している。

### 影響

- multi-root workspace や nested `.bob` の扱いを確認したい利用者・保守者が、README と詳細設計のどちらを正とするか迷う。

### 推奨対応

1. canonical な探索仕様を `workflow-register` README に短く追記する。
2. `.bob/workflows/*/WORKFLOW.md` は「各 resolved Bob root から見た相対パターン」として表現するなど、詳細設計と矛盾しない書き方に揃える。

---

## 整合確認できた点

### P-01: VSIX から開発用 `docs/**` を除外する方針は揃っている

TOP commit の目的である「extension docs を VSIX package から除外する」方針は、主要ファイル間で整合している。

- `extensions/workflow-register/.vscodeignore` に `docs/**` がある。
- `extensions/bob-bazaar-review/.vscodeignore` に `docs/**` がある。
- `extensions/bob-code-consistency-review/.vscodeignore` に `docs/**` がある。
- 各拡張 README の VSIX サイズ節で、`out/**/*.map` と開発用 `docs/**` を同梱しない説明がある。
- `scripts/check-vsix-policy.js` で `extension/docs/` を forbidden entry として検出している。

このため、少なくとも静的な方針・policy script・README の観点では TOP commit の変更は整合している。

### P-02: 成果物 metadata contract は実装と概ね一致している

`docs/artifact-metadata-contract-ja.md` は次を定めている。

- `bob-code-consistency-review` は `.bob-review/review-package/manifest.yaml` の `artifact_metadata` に metadata を追加する。
- `bob-bazaar-review` は review-result JSON 本体ではなく `.artifact-metadata.json` sidecar に metadata を保存する。

実装側も次のようになっている。

- `extensions/bob-code-consistency-review/src/core/reviewPackageBuilder.ts` は `manifest.yaml` に `artifact_metadata` を書き込む。
- `extensions/bob-bazaar-review/src/projectRules/resultCaptureArtifacts.ts` は `.bob/review/results/<review_id>.artifact-metadata.json` を保存する。

### P-03: `bob-bazaar-review` の任意連携方針は manifest と README で一致している

`bob-bazaar-review` は README で `IBM.bob-code` と `workflow-register` を任意連携として説明しており、`package.json` でも必須 `extensionDependencies` を持たない。実装も workflow provider 登録を retry / optional にしており、この方針は整合している。

### P-04: `bob-code-consistency-review` の必須依存は manifest と README で一致している

`bob-code-consistency-review` は `package.json` で次を `extensionDependencies` に持つ。

```json
[
  "IBM.bob-code",
  "local.workflow-register"
]
```

README でも導入順として `IBM.bob-code`、`workflow-register`、`bob-code-consistency-review` を案内しているため、依存関係の説明は整合している。

### P-05: code-consistency workflow の入口は traceability-first 仕様と一致している

`docs/workflows/code-consistency-review/README.md` は、現行 workflow が `review-input.yaml` 完成済みだけを入口にせず、文書候補収集、traceability AI draft、人間承認、accepted item から `review-input.yaml` 生成へ進む流れを説明している。

`.bob/workflows/code-consistency-review/WORKFLOW.md` も `requires.files` で `review-input.yaml` を要求せず、次の flow を実装している。

```text
prepareAiTraceabilityDraft
-> agent generated proposed-only draft
-> applyAiTraceabilityDraft
-> openTraceabilityPrep
-> validateTraceabilityCatalog
-> createReviewInputFromTraceability
-> preprocess
-> Bob agent review
-> captureBobOutput
-> validateOutput
-> triage
-> handoff
```

この点は仕様と workflow 定義が揃っている。

## 優先対応案

1. `docs/workflow-action-contracts-ja.md` を最優先で更新し、`workflow-register` API と `bob-code-consistency-review` provider 一覧を実装と一致させる。
2. contract drift を防ぐ test / script を追加する。
   - `WorkflowRegisterApi` exported interface vs contract 表
   - `registerActionProvider({ id })` 一覧 vs contract 表
   - `package.json contributes.commands` vs README Command Palette 表
3. 各 README の Command Palette / 設定一覧を manifest から再同期する。
4. `docs/workflows/code-consistency-review/README.md` の module split section を現行実装へ更新する。
5. `.bob/workflows/code-consistency-review/WORKFLOW.md` の `workspaceRequired` 方針を決め、値または説明を揃える。
6. workflow 探索範囲の canonical wording を `workflow-register` README と detailed design で統一する。

## 未実施事項

- `npm run compile` / `npm test` / `npm run package` / `npm run package:policy` は実行していない。
- 実機 VS Code / Bob IDE 上の Command Palette 表示確認は行っていない。
- `bob2/` 配下の同梱・展開済み外部拡張は、今回の仕様整合レビューの主対象外とした。
