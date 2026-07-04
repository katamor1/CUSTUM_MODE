# workflow-register 入力プロンプト / reviewed step 回帰修正メモ

## 背景

`code-consistency-review` を Bob Todo から step 実行すると、次の症状が発生した。

- `VCS` などの workflow input が複数回表示される。
- `default: ""` の任意入力をキャンセルすると、同じ入力が再度表示される。
- 1つ目の Todo が進んだ後、次の Todo を実行すると `Step '...' cannot run before previous step '...' is completed.` で失敗する。
- Bob task export 上では、会話メッセージが開始メッセージだけなのに、Todo 状態だけがほぼすべて `done` になる。

## 原因

### default input が resolved に入らない

`collectWorkflowInputsWithResolver` は `provided` だけを resolved input として開始していた。

そのため、`default: git` のような select input も prompt 対象になっていた。

### 空文字 default が missing 扱いになる

`vcsRoot` のような任意入力は `default: ""` を持つ。

これを resolved に入れても、`isMissing("")` が true のため prompt 対象に戻ってしまう。

### reviewed step が ordered single-step 実行をブロックする

`stepReview.pauseAfter: everyStep` の workflow では、step 実行後に run step status が `reviewing` になる。

Bob Todo から次 step を実行すると ordered single-step guard が前 step を completed ではないと判定し、次 step を拒否していた。

### engine step UI と prompt 内 Todo list が二重化する

`stepExecution.mode: engineSteps` の workflow は、Bob Workflow API の step として engine step を1件ずつ公開する。

しかし最初の step message が `<workflow_todos>` 全件を含めていたため、Bob 側にも別の Todo list を作らせていた。これにより Bob UI の Todo 状態と workflow engine の run state がずれていた。

## 修正

- input default を prompt 前に resolved input へ展開する。
- number / boolean default は input type に合わせて変換する。
- `default: ""` の任意入力は「空欄として確定済み」と扱い、同一 input 収集中は再プロンプトしない。
- 任意入力キャンセルも同じく skipped optional として扱う。
- ordered single-step 実行で前段 step が `reviewing` の場合は、次 step 実行を明示的な承認として扱い、前段 step を `completed` へ進める。
- `engineSteps` 表示モードでは、最初の step message に `<workflow_todos>` 全件を含めず、現在 step の `<workflow_step>` だけを渡す。

## テスト

- default 付き input は prompt なしで resolved される。
- `default: ""` の任意 input は再プロンプトされない。
- 任意 input のキャンセルは再プロンプトされない。
- required input のキャンセルは従来通り input 収集をキャンセルする。
- `reviewing` の前段 step がある状態で次の ordered single-step を実行すると、前段 step が completed / accepted になり、次 step が実行される。
- `engineSteps` 表示モードの first step message では、重複 Todo list を生成しない。
