# workflow-register skip 再開 Phase 1/2/3/4/5 設計

## 目的

複数 step の workflow で、既存 run の成果物を再利用し、途中 step から安全に開始できるようにする。

Phase 1 では、途中開始コマンド本体までは実装しない。先に「再利用できる成果物とは何か」を workflow 定義と実行結果に残せるようにし、後続 Phase の state hydration / startFromStep の土台を作る。

Phase 2 では、Phase 1 の manifest を core API として切り出し、artifact file から `run.state` を復元する state hydration 部品を追加する。

Phase 3 では、manifest / hydration を実際の command 導線へ接続し、既存 run の成果物から新しい run を seed して指定 step から開始できるようにする。

Phase 4 では、Phase 3 の command を Operation Hub / Runs View から見つけやすくし、再利用済み run と再利用可能 artifact manifest を UI で確認できるようにする。

Phase 5 では、manifest が無い古い Bob UI run を救済するため、task snapshot の `lastAssistantText` / `taskExport` から artifact file と artifact manifest を生成する fallback import を追加する。

## Phase 1 の範囲

Phase 1 で実施することは次の 3 点である。

1. skip 再開対象 workflow の opt-in metadata を定義する。
2. opt-in した workflow に対し、resultKey と artifact の対応を validator で確認する。
3. 実行時に `artifacts` から書き出した成果物を manifest に記録する。

## Phase 2 の範囲

Phase 2 で実施することは次の 3 点である。

1. artifact manifest の型、parse、serialize、互換性検証を `src/core/artifacts/artifactManifest.ts` に切り出す。
2. `src/core/artifacts/stateHydration.ts` に artifact file から `run.state` を復元する helper を追加する。
3. checksum、byte size、workspace-relative path、`workflowId`、`workflowDefinitionHash`、`inputsHash` を hydration 前に検証する。

## Phase 3 の範囲

Phase 3 で実施することは次の 4 点である。

1. `workflowRegister.startFromStepWithArtifacts` command を追加する。
2. workflow / start step / reuse 元 run を QuickPick で選び、target inputs と互換性のある manifest だけを候補にする。
3. 開始 step より前に生成される state key を artifact file から hydrate し、前段 step を `completed` として新 run を seed する。
4. seed 済み run を通常の `WorkflowEngine.resumeRun()` に渡し、開始 step から続行する。

## Phase 4 の範囲

Phase 4 で実施することは次の 4 点である。

1. Operation Hub の run card に artifact manifest の有無を badge 表示する。
2. artifact manifest を持つ run に「成果物から開始」ボタンを表示し、`workflowRegister.startFromStepWithArtifacts` を `workflowId + sourceRunId` で呼ぶ。
3. `workflow.artifactReuse` を持つ run を Operation Hub と Explorer の Runs View で reused run として表示する。
4. Operation Hub の auto refresh 対象に `artifacts/manifest.json` を追加し、manifest 生成後に画面へ反映する。

## Phase 5 の範囲

Phase 5 で実施することは次の 4 点である。

1. `workflowRegister.importArtifactsFromTaskSnapshots` command を追加する。
2. task snapshot の `lastAssistantText`、または `taskExport` 内の `resultText` / `artifactText` / `text` などから import 候補 text を抽出する。
3. workflow の `artifacts[].producedBy` と producing step の `resultKey` が一致する場合だけ artifact file を生成し、manifest entry の `source` を `task-snapshot` にする。
4. `run.state["workflow.taskSnapshotImport"]` に import provenance を保存し、以後は Phase 3/4 の start-from-artifacts 導線へ乗せる。

Phase 5 では次はまだ実施しない。

- Builder で file-bound skip resume artifact 定義を自動生成する。
- Bob Todo UI 内の todo item 表示そのものに reused/skipped marker を埋め込む。
- task snapshot import の内容差分を GUI で確認してから apply する画面。

## Opt-in metadata

既存 workflow の strict validation を壊さないため、Phase 1 は `x-skipResume.fileBound: true` を付けた workflow だけを対象にする。

```yaml
x-skipResume:
  fileBound: true
```

`x-` prefix は workflow-register v1 schema の拡張領域として扱う。GUI round-trip で未知 top-level field として保持しやすく、既存 workflow には影響しない。

## File-bound workflow 規約

`x-skipResume.fileBound: true` の workflow では、再利用したい step output を必ず `resultKey` と同名の `artifacts[].id` に結び付ける。

```yaml
x-skipResume:
  fileBound: true

steps:
  - id: collect-context
    title: Collect context
    type: agent
    prompt: Collect reusable context.
    resultKey: collectContext

artifacts:
  - id: collectContext
    producedBy: collect-context
    path: ".bob/workflows/runs/{{run.id}}/artifacts/collect-context/collectContext.md"
    schema: text/markdown
```

Validator は opt-in workflow に対して次を警告する。workspace strict validation では警告が error に昇格する。

- `resultKey` / manual form resultKey / manual approval resultKey に、同じ `id` かつ同じ `producedBy` の artifact がない。
- agent step に `resultKey` がない。
- result step に file sink がない。
- artifact に `producedBy` がない。
- artifact が producing step の resultKey と対応していない。
- artifact path に `{{run.id}}` または `{{runId}}` がない。

## Artifact manifest

`writeProducedArtifacts()` は、`artifacts` から実際にファイルを書いた場合、同じ run の artifact ディレクトリに manifest を書く。

```text
.bob/workflows/runs/<runId>/artifacts/manifest.json
```

形式は次の通り。

```json
{
  "schemaVersion": "workflow-register/artifact-manifest/v1",
  "workflowId": "workflow-register.example",
  "logicalWorkflowId": "example",
  "workflowDefinitionHash": "sha256:...",
  "workflowFile": ".bob/workflows/example/WORKFLOW.md",
  "runId": "20260708T...",
  "inputsHash": "sha256:...",
  "createdAt": "2026-07-08T00:00:00.000Z",
  "updatedAt": "2026-07-08T00:00:00.000Z",
  "artifacts": [
    {
      "id": "collectContext",
      "stateKey": "collectContext",
      "producedBy": "collect-context",
      "path": ".bob/workflows/runs/20260708T.../artifacts/collect-context/collectContext.md",
      "schema": "text/markdown",
      "sha256": "...",
      "bytes": 12345,
      "source": "workflow-artifact",
      "updatedAt": "2026-07-08T00:00:00.000Z"
    }
  ]
}
```

同じ内容は `run.state["workflow.artifactManifest"]` にも JSON 文字列として保存する。これにより、`run.json` だけを見ても、どの artifact がどの resultKey から生成されたか確認できる。

## State hydration

Phase 2 では、manifest から対象 state key を選び、artifact file を読み込んで `run.state` に復元する。

```ts
await hydrateWorkflowStateFromArtifacts({
  workflow,
  run,
  manifest,
  stateKeys: stateKeysRequiredByStep(workflow, "analyze"),
  readFile: (relativePath) => fs.readFile(path.join(workflowRoot, relativePath), "utf8")
})
```

Hydration は次を検証してから state を更新する。

- manifest の `workflowId` が対象 workflow と一致する。
- `workflowDefinitionHash` が一致する。ただし caller が明示的に mismatch を許可した場合は進められる。
- `inputsHash` が target run inputs と一致する。ただし caller が明示的に mismatch を許可した場合は進められる。
- artifact path が workspace-relative safe path である。
- artifact file の byte size と sha256 が manifest と一致する。

復元後は `run.state["workflow.artifactHydration"]` に provenance を保存する。

## Start from artifacts command

Phase 3 の command は次の ID で公開する。

```text
workflowRegister.startFromStepWithArtifacts
```

引数を渡さない場合、次を順に選択する。

1. workflow
2. start step
3. workflow inputs
4. reuse 元 run

引数で呼ぶ場合は次の形を想定する。

```ts
vscode.commands.executeCommand(
  "workflowRegister.startFromStepWithArtifacts",
  workflowId,
  stepId,
  sourceRunId,
  inputs
)
```

実行時の流れは次の通り。

1. target workflow と inputs を決める。
2. 同じ workspace root の run 一覧から artifact manifest を持つ run を探す。
3. manifest の `workflowId` / `workflowDefinitionHash` / `inputsHash` が target workflow と inputs に一致する run だけを候補にする。
4. 開始 step より前に生成される state key を artifact file から hydrate する。
5. 新規 run を作成し、開始 step より前の step を `completed` にする。
6. `run.state["workflow.artifactReuse"]` に reuse provenance を保存する。
7. `WorkflowEngine.resumeRun()` に渡し、開始 step から通常実行する。

## Task snapshot import command

Phase 5 の command は次の ID で公開する。

```text
workflowRegister.importArtifactsFromTaskSnapshots
```

引数なしの場合は run を選択し、引数ありの場合は対象 run id を渡す。

```ts
vscode.commands.executeCommand(
  "workflowRegister.importArtifactsFromTaskSnapshots",
  runId
)
```

実行時の流れは次の通り。

1. 対象 run と workflow definition を読む。
2. workflow の `artifacts` のうち `producedBy` を持つ artifact を見る。
3. producing step の `resultKey` / manual resultKey と artifact id が一致するものだけを import 対象にする。
4. 各 step の最新 task snapshot から `lastAssistantText` を優先して取得し、なければ `taskExport` 内の text-like field を探す。
5. artifact path を render し、workspace-relative safe path の場合だけ artifact file を書く。
6. manifest entry の `source` を `task-snapshot` として保存する。
7. `run.state["workflow.taskSnapshotImport"]` に import provenance を保存する。

`workflow.taskSnapshotImport` は次の形式で保存する。

```json
{
  "schemaVersion": "workflow-register/task-snapshot-import/v1",
  "sourceRunId": "20260708T...",
  "importedAt": "2026-07-08T00:00:00.000Z",
  "imported": [
    {
      "artifactId": "collectContext",
      "stateKey": "collectContext",
      "producedBy": "collect-context",
      "snapshotReason": "agent-output",
      "snapshotCreatedAt": "2026-07-08T00:00:00.000Z",
      "path": ".bob/workflows/runs/20260708T.../artifacts/collect-context/collectContext.md",
      "sha256": "...",
      "bytes": 12345
    }
  ]
}
```

## Operation Hub / Runs View

Phase 4 では Operation Hub の run card に次を表示する。

- `Reusable artifacts: N`: artifact manifest がある run。
- `Artifacts reused: N step(s), M state key(s)`: artifact reuse で作られた run。
- `成果物から開始`: artifact manifest がある run から新しい start-from-artifacts run を作る action。

Explorer の `Bob Workflow Runs` view でも、artifact manifest がある run は `artifacts`、reuse 済み run は `reused N` と表示し、tooltip に source run と start step を出す。

## Bob task export との関係

Bob task export / task snapshot は Phase 1/2/3/4/5 でも manifest の正本ではない。

Phase 5 では、artifact が存在しない古い run を救う明示 command の入力としてだけ使う。import 後は `.bob/workflows/runs/<runId>/artifacts/...` と `workflow.artifactManifest` が再開用の正本になり、以後の start-from-artifacts は task snapshot を直接読まない。

snapshot は最大サイズ制限や redaction により `lastAssistantText` / `taskExport` が省略・短縮される可能性がある。そのため import できない step は warning として report に残し、自動的に不完全な artifact を作らない。

## 後続 Phase への接続

Phase 6 以降では、Phase 5 の fallback import をさらに使いやすくするために次を追加する。

1. Builder で file-bound skip resume に必要な artifact 定義を自動生成する。
2. Bob Todo UI 内の todo item 表示そのものに reused/skipped marker を埋め込む。
3. task snapshot import の内容差分を GUI で確認してから apply する画面を追加する。
