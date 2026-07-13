# `bob-evidence-scope` ドメイン契約（Phase 1–3）

## 目的

`bob-evidence-scope` は、レビュー対象の巨大なコード・文書・規約を無条件に AI へ渡すのではなく、今回の変更に必要な evidence を決定論的に選び、採用・除外理由と概算 token 量を残すためのドメイン境界です。

Phase 1 は選定ドメインと serializer、Phase 2 は既存 `preprocessReview` と review-package への接続、Phase 3 は workspace-local project rule pack の read-only 読込、schema/version 検証、SHA-256 provenance と stale-input 連携を実装します。現時点では `bob-code-consistency-review` 内の独立モジュールですが、public API と pipeline adapter を分離しているため、複数 workflow から独立利用する段階で別 VSIX へ切り出せます。

## 公開 API

`src/evidenceScope/index.ts` は次を明示 export します。

- `buildEvidenceScope(request)`
- `buildReviewEvidenceScope(codeAnalysis, documents, options)`
- `buildReviewContextBudget(input)`
- `planContextBudget(items, policy)`
- `selectApplicableRules(rules, symbols)`
- `parseProjectRules(value)`
- `loadProjectRulePack(input)`
- `mergeProjectRules(projectRules, inlineRules)`
- `InMemoryDocumentEvidenceAdapter`
- `createContextBudgetArtifact(scope, metadata)`

`export *` は使いません。公開面を明示し、将来の VSIX 分離時に互換性を管理しやすくします。

## Change Scope Engine

入力の `changedSymbolIds` を必須 seed とし、resolved dependency edge を breadth-first で展開します。`maxDependencyDepth` が `NaN` や無限値の場合は 0 として扱い、変更 symbol 以外を展開しません。

| 深さ | 優先度 | 代表例 |
| --- | --- | --- |
| 0 | `required` | 変更 symbol、公開 interface 変更 |
| 1 | `high` | 直接 caller/callee、直接 read/write/type dependency |
| 2 以上 | `medium` | 2-hop 以降の影響候補 |
| 非関連 | `low` | raw diff 全文など、変更との関連を証明できない候補 |

incoming と outgoing の両方向を impact として扱います。`resolution: "unknown"` の edge は展開しませんが、`unknownImpact` に source、edge kind、reason、target hint を残します。

## Project Rule Pack Engine

### 設定入口

Phase 3 では project 共通 rule を workspace-local file に置けます。

```yaml
bob_options:
  evidence_scope_rule_pack_path: .bob/evidence-scope/project-rules.yaml
  evidence_scope_rules:
    - id: review-specific-check
      title: Review-specific check
      evaluation: local
  evidence_scope_include_low_priority: false
```

`evidence_scope_rule_pack_path` は `.json`、`.yaml`、`.yml` の workspace-relative path だけを受け付けます。絶対 path、`..`、control character、workspace 外を指す symlink は拒否します。

### Rule pack v1

```yaml
schema_version: 1
rule_pack:
  id: payment-review
  version: "2026.07"
  description: Payment project review policy
rules:
  - id: public-api-compatibility
    title: Public API compatibility
    evaluation: ai
    estimated_tokens: 120
    priority: required
    applies_when:
      paths:
        - src/public/**
      languages:
        - cpp
      symbol_kinds:
        - function
      risk_tags:
        - compatibility
      interface_change: true
```

runtime schema と `docs/workflows/.../schemas/` の mirror は byte-identical です。`schema_version` は `1` のみ、`rule_pack.id` と `rule_pack.version` は必須です。rule は `id`、`title`、`evaluation: local|ai` を必須とし、`estimated_tokens`、`priority`、machine-readable `applies_when` を任意で持ちます。

authoritative な project rule pack に schema error、invalid rule、duplicate ID がある場合は preprocessing を停止します。review-local の `evidence_scope_rules` は Phase 2 と同じく invalid entry を warning として除外します。

### Read-only・size・hash 境界

`loadProjectRulePack` は次を実施します。

1. path を `/` 形式へ正規化する。
2. realpath を含めて workspace 内であることを確認する。
3. file を mode `r` で開く。
4. 読込前後に `maxDocumentBytes` を超えていないことを確認する。
5. exact raw bytes を SHA-256 し、`sha256:<64 hex>` として保持する。
6. 設定された文字コードで decode し、YAML/JSON parse と v1 schema validation を行う。
7. file を変更、copy、package 化しない。

資格情報、UNC 認証情報、raw rule-pack body は生成 artifact に保存しません。

### Rule merge precedence

project rule pack が authoritative です。

- project rules を先に登録する。
- inline rule の新しい ID は追加する。
- inline rule が project ID を再利用した場合、project rule を維持する。
- duplicate inline ID は次の deterministic warning にする。

```text
duplicate inline evidence scope rule <id>; project rule pack entry retained.
```

最終 rule と warning は ID 順に安定化します。

### Applicability

`applies_when` に指定した次元はすべて一致する必要があります。各配列内は OR、異なる次元間は AND です。

- `paths`: `/` 正規化後の `*` / `**` glob
- `languages`
- `symbol_kinds`
- `risk_tags`
- `interface_change`

`evaluation: local` の rule は token cost 0、`evaluation: ai` は `estimated_tokens` を budget へ加算します。

## Document Evidence adapter

ドメインは文書ファイルを直接読みません。`DocumentEvidenceAdapter` は、symbol ID、risk tag、rule ID、keyword に対して `DocumentEvidenceUnit[]` を返します。unit は raw 文書ではなく、安定 ID、source path、locator、content hash、概算 token 数を持ちます。

参照実装の `InMemoryDocumentEvidenceAdapter` は symbol link を最優先し、risk/rule tag、keyword の順で加点します。同一 ID は最上位候補だけを残します。

将来 UNC / AD file-server adapter を実装するときも、adapter 境界の外側で Trusted Workspace、UNC root allowlist、Windows の既存認証、read-only、raw document 非保存を強制します。

## Context budget policy

`planContextBudget` は `required -> high -> medium -> low`、同一優先度では ID の昇順で処理します。

- `required` は budget 超過でも採用する。
- `high` / `medium` は残量に収まる場合だけ採用する。
- `low` は `includeLowPriority: true` を明示しない限り除外する。
- 除外理由は `token-budget` または `low-priority-policy`。
- duplicate は `kind:id` で統合し、理由を重複排除する。

既存 analyzer から変換する evidence 見積りは `ceil(text.length / 4)`、pipeline budget は `max(1, floor(maxBobInputBytes / 4))` です。課金 token や特定 model tokenizer と同一とは扱いません。

## Pipeline adapter

`buildReviewContextBudget` は async function です。検証済み `ReviewInput`、immutable SHA を持つ `DiffSummary`、文書 evidence、code analysis、workspace root、encoding、正規化済み limits を受け取ります。

処理順は次です。

1. configured project rule pack を read-only load・validate する。
2. inline `evidence_scope_rules` を parse する。
3. project-authoritative precedence で rule を merge する。
4. review ID、ticket ID、review focus、title、purpose から document keyword を作る。
5. `analysis_options.max_call_depth` で dependency depth を決める。未指定時は 1。
6. `maxBobInputBytes` から scope budget を算出する。
7. `buildReviewEvidenceScope` を実行する。
8. parser、merge、scope warning を sort・deduplicate する。
9. `createContextBudgetArtifact` で report object を作る。

`preprocessReview` は scope warning を既存の diff/document/code/traceability/package warning とともに返します。public input/result shape は変えません。

## `context-budget-report.json` 契約

project rule pack がある場合、report は provenance を含みます。

```json
{
  "schema_version": 1,
  "selection_policy": "bob-evidence-scope-v1",
  "scope_fingerprint": "scope-1234abcd",
  "source_revision": "<40-char-sha>..<40-char-sha>",
  "token_estimation": "ceil(text.length / 4); budget=floor(maxBobInputBytes / 4)",
  "rule_source": ".bob/evidence-scope/project-rules.yaml",
  "rule_pack": {
    "schema_version": 1,
    "id": "payment-review",
    "version": "2026.07",
    "source_path": ".bob/evidence-scope/project-rules.yaml",
    "content_hash": "sha256:..."
  },
  "selected_code": [],
  "applicable_rules": [],
  "selected_documents": [],
  "unknown_impact": [],
  "budget": {
    "budgetTokens": 524288,
    "selectedTokens": 0,
    "requiredTokens": 0,
    "overBudget": false,
    "selected": [],
    "excluded": []
  },
  "warnings": []
}
```

report は raw source body、raw diff、document text、code-slice Markdown、raw rule-pack body を複製しません。

## Managed output、manifest、stale 判定

`context-budget-report.json` は managed output です。package 再生成時に stale copy を消し、現在の artifact がある場合だけ書き直します。

rule pack がある場合、`manifest.yaml` は次を記録します。

```yaml
inputs:
  context_budget_report: .bob-review/review-package/context-budget-report.json
  project_rule_pack: .bob/evidence-scope/project-rules.yaml
  project_rule_pack_id: payment-review
  project_rule_pack_version: "2026.07"
  project_rule_pack_hash: sha256:...
```

`artifact_metadata.input_hash` は従来の normalized review input と immutable diff に加え、`rule_pack.content_hash` を含みます。review input と Git revision が同じでも rule-pack bytes が変われば input hash が変わるため、future ledger は過去 artifact を stale と判定できます。

rule pack が未設定の場合は、project provenance 行を出力せず、空の rule-pack hash input を使います。

## Determinism と security

同じ logical input と同じ rule-pack bytes について、rule、symbol、edge、document candidate の配列順が変わっても selection、warning、unknown impact、scope fingerprint、rule-pack provenance は安定します。

VCS ref は report 生成前に 40 桁 commit SHA へ解決します。rule-pack `content_hash` は exact raw bytes の SHA-256 です。scope fingerprint の FNV-1a は selection 比較用であり、security checksum には使いません。

## Phase 4 境界

次の実装単位では、repository 全体の symbol/reference edge を再利用可能な index contract として追加し、変更 file 外の caller/callee/type/global/test impact を bounded depth で選定できるようにします。

Phase 3 は次を行いません。

- workspace 外 rule pack の探索
- UNC/AD credential 管理
- rule pack の書換えや raw copy
- repository-wide persistent symbol index
- producer 横断 artifact ledger
- stale artifact の ledger 伝播


## Repository index producer と Artifact Ledger（Phase 5–Final）

Phase 5 は immutable Git blob から repository-symbol-index v1 を生成する built-in producer と、source body を含まない file-fragment cache を追加します。`repository_symbol_index_mode: build` の場合、producer は tracked blob の object ID と option identity で fragment を再利用し、全 fragment の reference を毎回再リンクした後、同じ preprocessing 内で Phase 4 consumer に再検証させます。

Final phase は `.bob-review/artifact-ledger.json` に repository index、project rule pack、review package の metadata-only dependency graph を保存します。record は stable ID、kind、producer、workspace-relative path、exact SHA-256、input hash、source revision、dependency IDs、`fresh|stale|missing` status、stable stale reason のみを保持します。raw source、raw diff、document text、rule-pack/index/package body、credential、environment value は保存しません。

`preprocessReview` は二段階 checkpoint を実行します。上流 checkpoint は package 生成前に index/rule-pack の変更または消失を記録し、旧 review package へ stale state を伝播します。package 生成に失敗してもその stale state は残ります。final checkpoint は package 成功後に managed output の canonical exact-byte hash と manifest と共有する input hash を記録し、現在の package を fresh に戻します。

公開 API は `produceRepositorySymbolIndex`、`reconcileArtifactLedger`、`loadArtifactLedger`、`writeArtifactLedger`、`updateArtifactLedger` と関連型を明示 export します。consume-only、index 未設定、external producer、Bazaar review の既存契約は維持します。
