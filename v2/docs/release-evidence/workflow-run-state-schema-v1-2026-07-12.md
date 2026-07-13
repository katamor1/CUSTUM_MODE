# Workflow Run State Schema v1 証跡

## 1. 判定

| 項目 | 値 |
| --- | --- |
| 実施日 | 2026-07-12 |
| Repository | `katamor1/bob_builtin_analyze` |
| Base | `e78fb4f8ab7f2747776097d09a2262638f1840a8` |
| Branch | `agent/workflow-run-state-schema-v1-20260712` |
| Draft PR | `#71` |
| Current schema | `workflow-register/run-state/v1` |
| コード実装 | 実装済み、隔離ハーネス確認済み |
| リポジトリfull suite | **未実行** |
| GitHub Actions | **BLOCKED — runner step開始前に失敗** |
| Merge / Release | **NO-GO** |

本変更は、`run.json`へ明示schema versionを導入し、unversioned historical runをbackup付きでmigrationし、future versionのdowngrade writeを禁止する。GitHub-hosted runnerがrepository step開始前に終了しているため、full suite、policy、packageがgreenであるとは主張しない。

## 2. 実装契約

| `run.json.schemaVersion` | Load | Save | Recovery |
| --- | --- | --- | --- |
| 省略 | historical v0としてmigration | migration後のみ可 | migration後のみ可 |
| `workflow-register/run-state/v1` | current | 可 | 可 |
| `workflow-register/run-state/v2`以降 | stable coreを検証してread-only | 不可 | 不可 |
| foreign / malformed / non-string | invalid diagnostic | 不可 | 不可 |

### Historical migration

1. contained/direct-file規則で`run.json`を読む。
2. JSON、schema discriminator、stable core、directory run IDを検証する。
3. 元byte列を`run-state-v0.backup.json`へcreate-onceで保存する。
4. current schemaを加えたv1 documentをatomic replaceする。
5. `updatedAt`は変更しない。
6. migration diagnosticを記録する。

matching backupはidempotentに再利用し、内容が異なるbackupは上書きせずmigrationを停止する。

## 3. 主な変更

### Runtime model / codec

- `WorkflowRunState.schemaVersion?: string`をtransition modelへ追加。
- `CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION`を追加。
- `decodeWorkflowRunState()`でunversioned/current/future/invalidを分類。
- stable core、run ID、status、step type/status、string state valueを検証。
- `prepareWorkflowRunStateForWrite()`でcurrent以外の明示versionを書き込み拒否。
- `isCurrentWorkflowRunState()`でrecovery boundaryを固定。

### Migration backup

- exact-byte backupを`run-state-v0.backup.json`へ保存。
- hard-link create-once publicationにより既存backupを置換しない。
- existing identical / conflicting / symlink targetを区別。
- path、directory、file identityをmigration I/Oの前後で検証。
- temporary-file verificationが失敗した場合もowned tempをcleanupする。

### Run store

- 新規runと通常saveにcurrent schemaを永続化。
- migrationはbackup成功後にのみ`run.json`を置換。
- future runはlist/inspection可能だがsave/recovery不可。
- invalid runは`listRuns()`から隔離し、valid runの一覧を継続。
- initial `run.json` missingだけを`undefined`として扱う。
- backup publication等の後続`ENOENT`はmissing runへ誤変換せず、error diagnosticとして保持。
- load diagnosticsを決定的にsort。

### Diagnostics / docs

- run state schemaとread-only状態をRun Diagnosticsへ表示。
- migrated / read-only / invalid document diagnosticsを専用sectionへ表示。
- `extensions/workflow-register/docs/run-state-schema-v1-ja.md`を追加。
- docs indexからschema文書へリンク。

## 4. TDD RED attempt

Production変更前のtest-only headは次である。

```text
958e67527b65475fb539549b1c62ca2b9b352adc
```

このheadで`extensions-quality` run `29183736708`が生成された。7 jobはすべて次の状態で終了した。

```text
status: completed
conclusion: failure
steps: null
logs_url: null
```

Job IDs:

- `86626071178` — bob-bazaar-review
- `86626071183` — Extension source metrics
- `86626071184` — workflow-register
- `86626071186` — Windows / bob-code-consistency-review
- `86626071190` — Windows / workflow-register
- `86626071192` — Windows / bob-bazaar-review
- `86626071199` — bob-code-consistency-review

したがって、test-first commitは作成したが、GitHub runner上でREDを実行・観測できていない。runner failureをRED、GREEN、またはrepository test failureへ読み替えない。

## 5. 最新GitHub Actions attempt

実装・review hardening・docsを含むhead `195457fbb9d24ece9b27df0369c612bbd7688a2a`で、`extensions-quality` run `29187476853`が生成された。

全7 jobが再び`steps: null`、`logs_url: null`で終了した。

- `86634643019` — workflow-register
- `86634643021` — Windows / bob-bazaar-review
- `86634643022` — Extension source metrics
- `86634643028` — Windows / workflow-register
- `86634643033` — bob-code-consistency-review
- `86634643035` — bob-bazaar-review
- `86634643038` — Windows / bob-code-consistency-review

checkout、Node setup、compile、test、policy、packageはいずれも開始していない。

## 6. Fresh isolated harness verification

GitHub connector環境にはprivate repositoryのlocal checkoutがないため、変更したcodec、backup、store、diagnosticsを同内容で隔離TypeScript projectへ配置した。`runStatePath`と周辺modelは最小stubであり、repository full graphや実contained-path implementationの代替ではない。

環境:

```text
Node.js v22.14.0
npm 10.9.2
TypeScript 5.9.3
```

実行:

```text
npm run compile
node --test test/runstate.test.js test/diagnostics.test.js
```

Fresh結果:

```text
TypeScript strict compile: exit 0
8 tests passed
0 failed
0 skipped
```

確認ケース:

1. unversioned/current/future codec routing。
2. exact-byte backup、timestamp保持、idempotent migration。
3. future versionのsave/recovery拒否。
4. invalid runをlistから隔離。
5. migration後続`ENOENT`をmissing runへ誤変換しない。
6. temporary-file verification failure後のtemp cleanup。
7. diagnosticsのschema/read-only表示。
8. invalid run document diagnostic sectionとsummary。

### 限界

隔離ハーネスは次を証明しない。

- repository全体のTypeScript compile。
- existing 654+ regressionとの互換性。
- 実`runStatePath.ts`とのcombined path/concurrency behavior。
- VS Code command / Operation Hub / Bob adapter integration。
- architecture/source/schema/dependency policy。
- VSIX contents、size、package policy。
- Ubuntu / Windows runner behavior。

## 7. Review hardening

静的レビューで次を修正した。

### Migration failureのENOENT誤判定

旧実装案は`loadRun()`全体を一つのcatchで囲み、任意の`ENOENT`をmissing runとして`undefined`へ変換していた。backup publicationやmigration replace中の`ENOENT`まで消えるため、initial `readContainedRunFile()`だけをmissing判定の対象へ分離した。

回帰テストは、backup publicationへsimulated `ENOENT`を注入し、rejectと`invalid` diagnostic、元`run.json`不変を要求する。

### Temporary file cleanup

旧実装案はtemp identity取得後だけcleanupしていた。temp write成功後、identity verificationで失敗するとtempが残る可能性があった。cleanup条件からidentity guardを外し、runs root identityが保たれている限りunique tempを削除する。

回帰テストはtemp fileの最初の`lstat`を失敗させ、owned `.tmp`が残らないことを確認する。

### Type-only imports

codec、store、backupのtype-only dependencyを明示し、runtime import surfaceを増やさないようにした。

## 8. Static review

確認事項:

- workflow definition schemaとrun state schemaを混同していない。
- v0 migrationはfield coercionを行わず、unknown optional fieldを保持する。
- future versionはstable core検証後にのみ返し、write/recoveryを拒否する。
- migration backupは既存fileを置換しない。
- backupと`run.json`の両方をworkspace-contained/direct-file規則で扱う。
- migrationは`updatedAt`を更新しない。
- save成功後にだけcaller objectのschema/timestampを更新する。
- invalid run 1件でvalid run一覧を失敗させない。
- diagnostic orderingは決定的である。

現時点のself-reviewでCritical findingは見つけていない。full suiteとindependent reviewerの代替ではない。

## 9. 未完了ゲート

次を完了するまでDraftを解除せず、merge / releaseしない。

1. repository checkout上のfocused codec / path / migration / diagnostics tests。
2. `npm.cmd test`。
3. dependency / architecture / source / schema / unused / audit gates。
4. VSIX `package` / `package:policy`とsize/hash記録。
5. `git diff --check`。
6. Ubuntu / Windows GitHub Actionsがrunner step開始からgreen。
7. independent focused diff review。
8. historical fixtureを含む実Extension Host smoke。

## 10. 次のアクション

Actionsの利用枠、billing、spending limit、GitHub-hosted runner許可設定を確認する。runner復旧後、PR #71の最新headで`extensions-quality`を再実行し、実test count、policy、package、VSIX hashを本証跡へ追記する。

PR #71がgreenになった後、immutable attempt/event log、process-crash journal/fsync、cross-process lockの順にreproducible runtimeを継続する。