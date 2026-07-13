# Bob Evidence Scope Phase 3 実装記録

- 実装日: 2026-07-12
- 対象: `extensions/bob-code-consistency-review`
- ブランチ: `codex/execute-shared-plan-6a53743e`
- Pull Request: #72
- test-only commit: `916d0df9a0d579f3b2ea28f1976c3b2b11c5db8f`
- GREEN implementation anchor: `0962c4af7d9cec69673117fd3e8c3e970bf3598e`

## 1. 実装範囲

Phase 3 では、project 固有の整合規約を workspace-local rule pack として read-only に読み込み、Evidence Scope の規約選択へ適用し、review package に provenance を残す経路を実装した。

設定入口は `review-input.yaml` の次の項目である。

```yaml
bob_options:
  evidence_scope_rule_pack_path: .bob/evidence-scope/project-rules.yaml
```

許可する file extension は `.json`、`.yaml`、`.yml` である。

## 2. Rule-pack loader

`src/evidenceScope/projectRulePackLoader.ts` は次を担当する。

- workspace-relative path の正規化
- absolute path、`..`、control character、empty segment の拒否
- workspace 外 path および symlink escape の拒否
- mode `r` による read-only open
- 読込前後の `maxDocumentBytes` 検査
- exact raw bytes の SHA-256 計算
- configured text encoding による decode
- YAML/JSON parse
- `schema_version: 1` の AJV validation
- authoritative pack 内の invalid rule / duplicate ID の拒否

source file は変更しない。raw rule-pack body は review package に copy しない。report と manifest には ID、version、source path、content hash のみを保存する。

## 3. Rule-pack schema

次の runtime schema と documentation mirror を追加した。

- `extensions/bob-code-consistency-review/resources/schemas/evidence-scope-rule-pack.schema.json`
- `docs/workflows/code-consistency-review/schemas/evidence-scope-rule-pack.schema.json`

両 file は byte-identical である。schema は次を要求する。

```yaml
schema_version: 1
rule_pack:
  id: payment-review
  version: "2026.07"
rules: []
```

rule は `id`、`title`、`evaluation: local|ai` を必須とし、`estimated_tokens`、`priority`、structured `applies_when` を任意で持つ。rule は最大 500 件である。

review-input runtime schema と mirror には `bob_options.evidence_scope_rule_pack_path` を追加した。unknown `bob_options` は引き続き拒否する。

## 4. Exact-byte SHA-256

parse 前の exact raw `Buffer` を SHA-256 し、次の形式で保持する。

```text
sha256:<64 lowercase hex>
```

文字コード変換や YAML normalization 後ではなく raw bytes を hash するため、comment、line ending、encoding を含む source revision の変更を stale input として検出できる。

## 5. Rule merge

`mergeProjectRules(projectRules, inlineRules)` を追加した。project rule pack を authoritative とする。

- project rule を先に登録する
- inline rule の新規 ID は追加する
- inline rule が project rule ID と重複した場合は project rule を保持する
- duplicate は deterministic warning として返す

```text
duplicate inline evidence scope rule <id>; project rule pack entry retained.
```

final rule と warning は ID 順に安定化する。

## 6. Pipeline 接続

`buildReviewContextBudget` を async 化し、workspace root と text encoding を受け取るようにした。処理順は次のとおり。

1. project rule pack の load・validation
2. inline rule の parse
3. authoritative merge
4. Evidence Scope 選定
5. warning の sort・deduplicate
6. provenance 付き context-budget artifact の生成

`preprocessReview` は adapter を `await` する。公開 input/result shape は変更していない。

## 7. Artifact provenance

`context-budget-report.json` は、rule pack がある場合に次を含む。

```json
{
  "rule_source": ".bob/evidence-scope/project-rules.yaml",
  "rule_pack": {
    "schema_version": 1,
    "id": "payment-review",
    "version": "2026.07",
    "source_path": ".bob/evidence-scope/project-rules.yaml",
    "content_hash": "sha256:..."
  }
}
```

report には raw rule-pack body、raw source、raw diff、document text、code-slice Markdown を格納しない。

## 8. Manifest と stale input

`manifest.yaml` は次を記録する。

```yaml
inputs:
  project_rule_pack: .bob/evidence-scope/project-rules.yaml
  project_rule_pack_id: payment-review
  project_rule_pack_version: "2026.07"
  project_rule_pack_hash: sha256:...
```

`artifact_metadata.input_hash` の入力には rule-pack content hash を含める。review input と immutable Git revision が同一でも rule-pack bytes が変われば、report hash と manifest input hash が変わる。

## 9. Security・privacy boundary

- workspace-local path のみ
- symlink escape を拒否
- read-only open
- normalized size limit
- source file を変更しない
- credentials を保存しない
- raw pack を generated package に copy しない
- provenance のみを report/manifest に記録
- no new npm dependency

## 10. 非対象と次段階

Phase 3 では、workspace 外 rule pack、UNC credential、rule pack 書換え、raw pack copy、repository-wide symbol index、producer 横断 ledger は実装しない。

Phase 4 は repository-wide symbol/reference index contract を追加し、変更 file 外の caller、callee、type/global access、関連 test を bounded depth で選定する。
