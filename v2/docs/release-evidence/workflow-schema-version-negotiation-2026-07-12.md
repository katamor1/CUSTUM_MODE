# Workflow Schema Version Negotiation 証跡

## 1. 判定

| 項目 | 値 |
| --- | --- |
| 実施日 | 2026-07-12 |
| Repository | `katamor1/bob_builtin_analyze` |
| Base | `e78fb4f8ab7f2747776097d09a2262638f1840a8` |
| Branch | `agent/workflow-schema-version-negotiation-20260712` |
| Draft PR | `#70` |
| コード実装 | 完了（version resolver / parser routing / tests） |
| フルリポジトリ検証 | **未完了** |
| Merge / Release | **NO-GO** |

本変更は、未知・誤記・non-stringの明示 `schemaVersion` をlegacy workflowとして黙って解釈する経路を閉じる。GitHub-hosted runnerがrepository step開始前に失敗しているため、フルsuite、policy、packageをgreenと主張しない。

## 2. 実装契約

| `schemaVersion` | 結果 |
| --- | --- |
| 省略 | legacy parser |
| `legacy` | legacy parser |
| `workflow-register/v1` | v1 parser |
| その他のstring | unsupported-version error |
| null / number / boolean / sequence / mapping | non-string error |

明示値はtrim、case-fold、downgradeしない。unsupported documentはnormalized workflowを生成せず、loader / registrationへ進まない。

## 3. 変更

### Production

- `extensions/workflow-register/src/core/parser/workflowSchemaVersion.ts`
  - `resolveWorkflowSchemaVersion(value)`を追加。
  - known routeだけを返し、それ以外はstable errorをthrowする。
  - string表示に`JSON.stringify()`を使い、制御文字を1行のescaped diagnosticにする。
- `extensions/workflow-register/src/core/parser/parseWorkflowMarkdown.ts`
  - legacy/v1 parser dispatch前にresolverを呼ぶ。
  - legacy parserへのcatch-all fallbackを削除。

### Tests

- `extensions/workflow-register/test/workflowSchemaVersionNegotiation.test.js`
  - omitted / explicit legacy compatibility。
  - future version、case typo、control-character stringの拒否。
  - number、boolean、null、sequence、mappingの拒否。
  - compiler、current document、workspace validation、loader、registration parity。
  - runner / Bob source / workflow registrationが0件であること。
- `extensions/workflow-register/test/workflowSchemaVersionResolver.test.js`
  - exact known route。
  - empty、whitespace、case、leading/trailing whitespace、future versionを正規化しないこと。
  - non-string explicit valueをすべて拒否すること。

### Documentation

- authoring guideへversion negotiation tableを追加。
- `extensions/workflow-register/docs/schema-version-negotiation-ja.md`を追加。
- Superpowers design / implementation planを追加。

## 4. TDD RED 証跡

Production変更前のtest-only head:

```text
f04946bb9a0186ceeaecb34492d45256cf1aa64a
```

このheadで`extensions-quality` run `29182987946`が生成された。しかし7 jobすべてが次の状態で終了した。

```text
status: completed
conclusion: failure
steps: null
logs_url: null
```

Job IDs:

- `86623982532` — workflow-register
- `86623982533` — Windows / bob-bazaar-review
- `86623982535` — bob-code-consistency-review
- `86623982552` — Extension source metrics
- `86623982554` — Windows / bob-code-consistency-review
- `86623982557` — Windows / workflow-register
- `86623982558` — bob-bazaar-review

したがって、test-first commitは作成したが、runner上でREDを観測できていない。base実装が`workflow-register/v1`以外を無条件でlegacy parserへ送ることはsourceから確認できるが、これは実行済みREDの代替ではない。

## 5. 実装後CI attempt

Implementation head `160edb3ee7eab30e4cccd4ad739a6885fa25b358`で`extensions-quality` run `29183008286`が生成された。

このrunも7 jobすべて`steps: null`、`logs_url: null`で終了した。

Job IDs:

- `86624035693` — workflow-register
- `86624035695` — Extension source metrics
- `86624035696` — bob-bazaar-review
- `86624035701` — bob-code-consistency-review
- `86624035706` — Windows / workflow-register
- `86624035708` — Windows / bob-bazaar-review
- `86624035718` — Windows / bob-code-consistency-review

checkout、Node setup、compile、test、policy、packageはいずれも開始されていない。repository code failureやPASSへ読み替えない。

## 6. 隔離ハーネス検証

GitHub connector環境にはprivate repositoryのlocal checkoutが無いため、新規resolverと変更後`parseWorkflowMarkdown()`を同じ内容で隔離ハーネスへ配置し、最小stub parserと実`js-yaml@4.1.1`で実行した。

環境:

```text
Node.js v22.16.0
npm 10.9.2
TypeScript 5.8.3
js-yaml 4.1.1
```

実行結果:

```text
npm run compile: exit 0
parser routing harness: 3 passed / 0 failed
resolver exact-routing tests: 3 passed / 0 failed
node --check resolver.test.js: exit 0
```

確認した内容:

1. omitted / explicit legacy / exact v1 route。
2. control-characterを含むunsupported stringのescaped diagnostic。
3. non-string diagnostic。
4. empty、whitespace、case、leading/trailing whitespace、future versionの拒否。
5. null、number、boolean、array、objectの拒否。

この隔離ハーネスは新規ロジックのcompileとbehaviorを確認するが、repositoryのfull TypeScript graph、VS Code stubs、loader / registration integration、policy、VSIX packageを証明しない。

## 7. 静的レビュー

確認事項:

- v1 parserとlegacy parser本体は変更していない。
- resolverはknown route以外を返さない。
- explicit valueをtrimまたはcase-foldしない。
- `JSON.stringify()`によりstring内の改行をdiagnosticの実改行へ展開しない。
- resolverのroute typeはinternalで、unused public exportを増やさない。
- new sourceは既存parserから参照され、import cycleを作らない。
- `.vscodeignore`は`src/**`、`docs/**`、`test/**`を除外するため、配布物への直接混入はない。compiled JSの増分はpackage gateで再確認が必要である。

現時点のself-reviewではCritical / Important findingは見つけていない。ただし、独立レビューと実suiteの代替ではない。

## 8. 未完了ゲート

次を完了するまでdraftを解除せず、merge / releaseしない。

1. `npm.cmd run compile && node --test test/workflowSchemaVersionResolver.test.js test/workflowSchemaVersionNegotiation.test.js`。
2. `npm.cmd test`。
3. dependency / architecture / source / schema / unused / audit gates。
4. VSIX `package` / `package:policy`とsize/hash記録。
5. `git diff --check`。
6. GitHub Actions Ubuntu / Windows jobsがrunner step開始からgreen。
7. focused independent diff review。

## 9. 次のアクション

Actionsの利用枠、billing、spending limit、GitHub-hosted runner許可設定を確認する。runner復旧後、PR #70の最新headで`extensions-quality`を再実行し、job logsとtest countsを本証跡へ追記する。

このPRがgreenになった後、独立した次phaseとして`run.json` schema version、decoder、migration chain、historical fixtures、unknown-newer read-only protectionへ進む。
