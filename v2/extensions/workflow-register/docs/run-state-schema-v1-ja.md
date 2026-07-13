# Workflow Run State Schema v1

## 1. 目的

`workflow-register` が正本として保存する `.bob/workflows/runs/<runId>/run.json` に、ファイル自身のschema versionを付与する。

この契約は、次の事故を防ぐためのものである。

- 新しい拡張が作成したrunを、古い拡張が旧形式として上書きする。
- 過去のunversioned runを、根拠を残さず暗黙変換する。
- 破損したrun 1件のために、run一覧や診断全体が開けなくなる。
- migration途中の失敗で、元のrun stateを復元できなくなる。

## 2. Current schema

現在の書き込み可能なversionは次である。

```json
{
  "schemaVersion": "workflow-register/run-state/v1",
  "runId": "20260712T000000Z-example-0123456789ab",
  "workflowId": "workflow-register.example",
  "workflowName": "example",
  "status": "paused",
  "inputs": {},
  "state": {},
  "steps": [],
  "createdAt": "2026-07-12T00:00:00.000Z",
  "updatedAt": "2026-07-12T00:01:00.000Z"
}
```

新規runと通常の保存では、`schemaVersion`を必ず`workflow-register/run-state/v1`として永続化する。

## 3. Version negotiation

| 保存値 | 読み込み | 書き込み | recovery |
| --- | --- | --- | --- |
| field省略 | historical v0としてmigration | migration後のみ可 | migration後のみ可 |
| `workflow-register/run-state/v1` | currentとして読み込み | 可 | 可 |
| `workflow-register/run-state/v2`以降 | stable coreを検証してread-onlyで読み込み | 不可 | 不可 |
| 他product/version family | error | 不可 | 不可 |
| non-string | error | 不可 | 不可 |

future versionは、`runId`、workflow identity、status、inputs、state、steps、timestampsなどのstable coreを検証できる場合だけ一覧・診断へ表示する。未知fieldは保持するが、保存や実行再開には使わない。

## 4. Historical v0 migration

`schemaVersion`が存在しないrunはhistorical v0として扱う。

読み込み時の順序は次のとおり。

1. `run.json`をcontained/direct-file規則で読み取る。
2. JSONとstable coreを検証する。
3. 元のbyte列を`run-state-v0.backup.json`へcreate-onceで保存する。
4. current schemaを加えたv1 documentをatomic replaceする。
5. migration diagnosticを記録する。

migrationは`updatedAt`を変更しない。読み込みによるmigrationを、業務上のrun更新として扱わないためである。

### Backup contract

保存場所:

```text
.bob/workflows/runs/<runId>/run-state-v0.backup.json
```

規則:

- 元の`run.json`のbyte列とfinal newlineをそのまま保存する。
- 既存backupと内容が同じ場合はidempotent successとする。
- 既存backupと内容が異なる場合はmigrationを停止する。
- 既存backupを置換しない。
- symlink、junction、workspace外解決、run directory aliasを拒否する。
- 一時ファイルは成功・失敗のいずれでも可能な限りcleanupする。

backup作成後にv1置換が失敗した場合、次回読み込みはmatching backupを確認してmigrationを再開できる。

## 5. Validation boundary

codecは少なくとも次を検証する。

- documentがobjectであること。
- `runId`、`workflowId`、`workflowName`がnon-empty stringであること。
- directoryのrun IDとdocumentの`runId`が一致すること。
- `status`が既知のrun statusであること。
- `inputs`と`state`がobjectであること。
- `state` valueがstringであること。
- `steps`がarrayであること。
- 各stepの`id`、`title`、`type`、`status`が既知契約に一致すること。
- `createdAt`と`updatedAt`がnon-empty stringであること。

codecはfield typeを黙ってcoerceしない。

## 6. Invalid document isolation

`loadRun(runId)`は、指定runのinvalid JSON、shape error、schema error、migration conflictをcallerへ返す。

`listRuns()`は各runを独立して読み込む。invalid runは返却一覧から除外し、他のvalid runを継続して返す。

隔離した事実は`FileRunStateStore.getLoadDiagnostics()`で取得できる。

```ts
interface RunStateLoadDiagnostic {
  runId: string
  severity: "info" | "warning" | "error"
  code: "migrated" | "read-only" | "invalid"
  message: string
}
```

diagnosticはrun ID、severity、code、messageの順で決定的にsortする。

## 7. Diagnostics

`Bob Workflow: 診断を確認`は、通常のrun diagnosticsに次を追加する。

- run state schema version
- future-version runのread-only表示
- migrated / read-only / invalid run document diagnostics
- run document diagnostic件数

invalid runは通常run一覧には含めないが、診断sectionにはrun IDと失敗理由を表示する。

## 8. Write safety

書き込み前には`prepareWorkflowRunStateForWrite()`を通す。

- field省略のin-memory runはcurrent versionを付与する。
- exact current versionは書き込み可能である。
- future version、foreign version、non-string versionは拒否する。
- 書き込み成功後にだけcallerの`schemaVersion`と`updatedAt`を更新する。

future versionは`findRecoverableRun()`の候補にしない。

## 9. Compatibility

この変更はworkflow definitionの`schemaVersion`とは別契約である。

| 対象 | 例 |
| --- | --- |
| workflow definition schema | `workflow-register/v1` |
| run state schema | `workflow-register/run-state/v1` |
| Bob Todo projection schema | `workflow-register/bob-task-sync/v1` |

既存のworkflow ID、provider ID、command ID、run ID形式、artifact manifest、control.json、task snapshot形式は変更しない。

## 10. Release gate

次が完了するまでmerge / releaseしない。

1. codec、migration path、store integration、diagnosticsのfocused tests。
2. `npm.cmd test`。
3. dependency / architecture / source / schema / unused / audit gates。
4. VSIX package / package policy。
5. `git diff --check`。
6. Ubuntu / Windows GitHub Actions。
7. independent focused review。

GitHub-hosted runnerがstep開始前に失敗した場合、そのrunをtest failureまたはPASSへ読み替えない。