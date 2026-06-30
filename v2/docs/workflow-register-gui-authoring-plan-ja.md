# workflow-register GUI ワークフロー作成機能 仕様・検討事項・実装計画

## 1. 背景と目的

`workflow-register` は、`.bob/workflows/*/WORKFLOW.md` を読み込み、IBM Bob のワークフローソースとして登録する基盤拡張である。現在は `Create Workflow from Template`、`Design Workflow with AI`、`Improve Workflow with AI`、`Validate Current Workflow` などにより、テンプレート生成、AI 下書き、検証、改善を支援している。

一方で、新しいワークフローを人間が設計するには、YAML front matter、`steps`、`inputs`、`preflight`、`guardrails`、`artifacts`、`completion` の関係を理解する必要がある。特に step の追加・削除・並べ替え、`resultKey` と `includeState` の接続、`command` step の provider / args、`result` step の sink、select input の options などは、テキスト編集だけではミスが起きやすい。

この計画では、GUI ベースで `WORKFLOW.md` を作成・編集できる機能を `workflow-register` に追加するための仕様と実装方針を整理する。

## 2. ゴール

### 2.1 利用者向けゴール

- ワークフロー作成に慣れていない利用者でも、画面上のフォームとステップ一覧から `WORKFLOW.md` を作成できる。
- step の追加、削除、複製、並べ替えを安全に行える。
- 必須項目、任意項目、固定値、選択値、自由記入項目の違いが画面上で分かる。
- `resultKey` / `includeState` / `artifacts.producedBy` のような参照関係を候補選択で扱える。
- 生成前に構造エラーを検出し、修正すべき箇所へ移動できる。
- AI に目的・現状・診断結果を渡して、step 分割や prompt をブラッシュアップできる。

### 2.2 実装向けゴール

- 既存の `workflow-register/v1` スキーマ、バリデータ、Markdown 生成ロジックを再利用する。
- GUI 専用の中間モデル `WorkflowAuthoringModel` を定義し、既存の `WorkflowDesignDraft` / `WORKFLOW.md` へ変換する。
- 既存コマンドを壊さず、段階的に `Create Workflow from Template` の上位機能として追加する。
- 最初は新規作成 MVP、次に既存 `WORKFLOW.md` 編集、最後に AI 連携と高度な診断 UX へ拡張する。

## 3. 非ゴール

- Bob 本体の Workflow UI を置き換えない。
- すべての YAML 表現を GUI で完全編集可能にしない。初期版では主要フィールドを対象にし、未知フィールドは保持または詳細編集へ逃がす。
- AI に最終判断を委ねない。AI は下書き・改善案・説明を出すだけで、保存前の検証と人間確認を必須にする。
- 破壊的 command の安全性を AI だけで判定しない。`guardrails` と明示確認を優先する。

## 4. 現状整理

### 4.1 既存の作成機能

現在の `createWorkflowFromTemplate` は、次の順に QuickPick / InputBox で情報を集める。

1. workspace root を選ぶ。
2. template を選ぶ。
3. workflow name を入力する。
4. title を入力する。
5. description を入力する。
6. `createWorkflowMarkdown` で Markdown を生成する。
7. `validateWorkflowText` で検証する。
8. `.bob/workflows/<name>/WORKFLOW.md` に保存して開く。

これは最短導線として有効だが、step や inputs の詳細設計は生成後に手編集する必要がある。

### 4.2 既存の AI 補助

既存の AI 補助は次を提供している。

- `Design Workflow with AI`: goal と preferred template から `WorkflowDesignDraft` を受け取り、`WORKFLOW.md` を生成する。
- `Improve Workflow with AI`: 現在の `WORKFLOW.md` と診断情報から修正案を作る。
- `Explain Workflow Diagnostics`: 診断結果の説明を作る。

GUI 作成機能では、これらを「新規作成フローの途中で呼べる補助」として組み込む。

### 4.3 既存スキーマ上の重要制約

`workflow-register/v1` では、トップレベル必須は `name` と `description` である。ただし GUI では利用者の迷いを減らすため、`schemaVersion`、`title`、`mode`、`workspaceRequired`、`steps` も実質的な推奨入力として扱う。

step は `id`、`title`、`type` が必須であり、`type` は `command`、`agent`、`manual`、`result` のいずれかである。さらに `command` step は `action` が必須、`result` step は `result` が必須である。

## 5. UI 全体像

### 5.1 推奨 UI 形式

VS Code Webview を使ったウィザード兼ビルダー形式を推奨する。

理由:

- QuickPick / InputBox だけでは step の増減・並べ替え・参照関係の編集が難しい。
- TreeView だけでは複数フィールドの編集や preview / diff 表示が弱い。
- Webview なら、左に step 一覧、右に詳細フォーム、下に検証結果と YAML preview を置ける。

### 5.2 画面構成

```text
+--------------------------------------------------------------+
| Bob Workflow Builder                                         |
+-------------------------+------------------------------------+
| 1. 基本情報             | 選択中セクションのフォーム          |
| 2. 入力値 inputs        |                                    |
| 3. 事前条件 preflight   | 必須/任意の説明、候補選択、入力欄   |
| 4. ステップ steps       |                                    |
|    [collect-context]    |                                    |
|    [analyze]            |                                    |
|    [write-report]       |                                    |
| 5. 成果物 artifacts     |                                    |
| 6. ガードレール         |                                    |
| 7. 完了設定 completion  |                                    |
+-------------------------+------------------------------------+
| Diagnostics | YAML Preview | AI Suggestions | Diff Preview      |
+--------------------------------------------------------------+
| [Validate] [AIで改善] [Preview] [Save WORKFLOW.md] [Cancel]   |
+--------------------------------------------------------------+
```

### 5.3 利用者導線

#### 導線 A: テンプレートから作る

1. `Bob ワークフロー: GUI で作成` を実行する。
2. workspace root を選ぶ。
3. テンプレートを選ぶ。
4. 基本情報を入力する。
5. GUI 上で step / inputs / artifacts を調整する。
6. Validate で検証する。
7. Preview / diff を確認する。
8. 保存する。

#### 導線 B: AI 下書きから作る

1. 目的文を入力する。
2. テンプレートを任意選択する。
3. AI が `WorkflowDesignDraft` を返す。
4. GUI に下書きを読み込む。
5. 人間が step、prompt、guardrails を調整する。
6. 検証して保存する。

#### 導線 C: 既存 `WORKFLOW.md` を編集する

1. `WORKFLOW.md` を開く。
2. `Bob ワークフロー: GUI で編集` を実行する。
3. front matter を解析して GUI モデルに変換する。
4. GUI で編集する。
5. 変更差分を確認し、backup を作って保存する。

初期 MVP は導線 A のみでよい。導線 B / C は後続フェーズに分ける。

## 6. STEP の増減・並べ替え仕様

### 6.1 step 一覧 UI

step は左ペインまたは中央ペインにカード一覧で表示する。

各カードに表示する情報:

- step number: 実行順
- `id`
- `title`
- `type`
- 必須/任意の状態
- 入力参照: `includeState`
- 出力: `resultKey` または `result.sinks`
- 診断バッジ: error / warning / info

### 6.2 追加

追加ボタンは次の 4 種類を明示する。

| ボタン | 生成される type | 初期値 |
| --- | --- | --- |
| `+ AI step` | `agent` | `id`, `title`, `prompt` を空または目的文から生成 |
| `+ Command step` | `command` | `action.provider = vscode.executeCommand`、`args[0]` 未入力 |
| `+ Manual step` | `manual` | 人間確認用 prompt を入力 |
| `+ Result step` | `result` | `result.source = state`、`sinks[0].type = file` を初期候補 |

追加位置は「末尾に追加」を既定とし、選択中 step の前後に追加するメニューも用意する。

### 6.3 削除

step 削除時は、参照影響を確認する。

削除対象が次に該当する場合は警告を出す。

- 他 step の `includeState` から参照される `resultKey` を持つ。
- `artifacts.producedBy` から参照されている。
- `completion` や `result.stateKey` から参照されている。

警告例:

```text
この step の resultKey 'reviewContext' は analyze.includeState で参照されています。
削除すると後続 step がエラーになります。
```

削除オプション:

- `削除して参照は残す`: 検証エラーとして残す。上級者向け。
- `削除して参照も外す`: `includeState` / `producedBy` から自動削除する。
- `キャンセル`

### 6.4 複製

step 複製時は `id` の衝突を避ける。

例:

- `analyze` → `analyze-2`
- `collect-context` → `collect-context-2`

`resultKey` も必要に応じて `analysisReport` → `analysisReport2` のように候補を出す。ただし勝手に後続参照を変更しない。

### 6.5 並べ替え

ドラッグ & ドロップ、または `上へ` / `下へ` ボタンを用意する。

並べ替え時の検証:

- `includeState` が、参照元 `resultKey` より前の step を参照していないか。
- `result.source: state` の `stateKey` が、前段 step の `resultKey` として存在するか。
- `artifacts.producedBy` が存在する step を参照しているか。

参照順が壊れる場合は、移動後に warning を表示する。初期版では移動自体は禁止せず、保存前検証で止める方式がよい。

## 7. 必須項目と任意項目の分類

### 7.1 トップレベル

| 項目 | GUI 上の扱い | 備考 |
| --- | --- | --- |
| `schemaVersion` | 固定・表示のみ | `workflow-register/v1` を固定値にする。 |
| `name` | 必須 | フォルダ名にも使う。正規化 preview を表示する。 |
| `description` | 必須 | Bob UI と診断レポートに出る。 |
| `title` | 推奨 | 未入力なら `name` から自動生成。 |
| `mode` | 固定または選択 | 初期値 `agent`。現状は詳細設定扱いでよい。 |
| `workspaceRequired` | 推奨 | 初期値 `true`。workspace 不要の workflow だけ false。 |
| `steps` | 推奨必須 | スキーマ上は任意でも、GUI では 1 件以上を推奨する。 |
| `inputs` | 任意 | 実行前入力が必要な場合だけ追加。 |
| `requires` | 任意 | workspace / Bob version / files 条件。 |
| `preflight` | 任意 | 実行前チェック。 |
| `guardrails` | 任意。ただし command step がある場合は推奨 | allowed / denied / approval。 |
| `artifacts` | 任意 | 成果物を保存・表示する場合。 |
| `completion` | 任意 | 完了表示、成果物表示、結果検証。 |

### 7.2 inputs

| 項目 | GUI 上の扱い | 備考 |
| --- | --- | --- |
| input id | 必須 | `inputs.<id>` のキー。英数字・記号の制約を GUI 側で寄せる。 |
| `type` | 必須・選択 | `string` / `number` / `boolean` / `select`。 |
| `title` | 任意だが推奨 | UI 表示名。 |
| `required` | 任意・boolean | checkbox。 |
| `requiredWhen` | 任意・自由記入 | 高度設定。 |
| `prompt` | 任意・boolean | 実行時入力対象にするか。 |
| `default` | 任意・型別入力 | type に応じて text / number / checkbox。 |
| `options` | `select` の場合は必須 | option list editor。 |

### 7.3 steps 共通

| 項目 | GUI 上の扱い | 備考 |
| --- | --- | --- |
| `id` | 必須 | 重複禁止。自動生成と手入力の両方を許す。 |
| `title` | 必須 | 人間向け表示。 |
| `type` | 必須・選択 | `command` / `agent` / `manual` / `result`。 |
| `required` | 任意・boolean | 失敗時に止める意図を明示。 |
| `resultKey` | 任意 | 後続 step で参照する場合に設定。 |
| `includeState` | 任意・候補選択 | それ以前の `resultKey` から複数選択。 |
| `maxResultBytes` | 任意・number | 大きな command 出力対策。 |
| `stateRequired` | 任意・boolean | state 参照必須化。 |

### 7.4 step type 別

#### agent step

| 項目 | GUI 上の扱い | 備考 |
| --- | --- | --- |
| `prompt` | 推奨必須 | 空でも schema 上は許容されるが、GUI では warning。 |
| `includeState` | 任意・候補選択 | 参照可能な `resultKey` のみ候補表示。 |
| `resultKey` | 任意 | 後続 result step に渡すなら推奨。 |

#### command step

| 項目 | GUI 上の扱い | 備考 |
| --- | --- | --- |
| `action.provider` | 必須・選択/自由記入 | 初期候補 `vscode.executeCommand`。登録済み provider を将来取得。 |
| `action.args` | 任意。ただし `vscode.executeCommand` では command ID 推奨必須 | args editor。先頭要素を command ID として強調。 |
| `sendResult` | 任意・boolean | Bob に結果を送るか。 |
| `completeOnSuccess` | 任意・boolean | 成功時完了。 |
| `resultKey` | 推奨 | 後続 AI step に渡すなら必須相当。 |

#### manual step

| 項目 | GUI 上の扱い | 備考 |
| --- | --- | --- |
| `prompt` | 推奨必須 | 人間が確認する内容。 |
| `required` | 任意・boolean | 重要確認なら true。 |

#### result step

| 項目 | GUI 上の扱い | 備考 |
| --- | --- | --- |
| `result.source` | 必須・選択 | `state` / `literal` / `agent`。 |
| `result.stateKey` | source が `state` の場合は推奨必須 | 既存 `resultKey` から選ぶ。 |
| `result.text` | source が `literal` の場合は推奨必須 | 自由記入。 |
| `result.sinks` | 必須・list | `file` / `command`。 |
| `sinks[].path` | sink が `file` の場合は推奨必須 | workspace 相対パス。 |
| `sinks[].command` | sink が `command` の場合は推奨必須 | command ID。 |

## 8. 固定値・選択値・自由記入項目の分類

### 8.1 固定値

| 項目 | 固定値 | 理由 |
| --- | --- | --- |
| `schemaVersion` | `workflow-register/v1` | 新規作成では legacy を作らない。 |
| 保存先 | `.bob/workflows/<name>/WORKFLOW.md` | 登録対象パターンに合わせる。 |
| 既定 `mode` | `agent` | 現行テンプレートと合わせる。 |
| 既定 `workspaceRequired` | `true` | workspace 操作が前提の workflow が多い。 |

### 8.2 選択値

| 項目 | 選択肢 |
| --- | --- |
| template | `simple-agent` / `command-then-agent` / `manual-checklist` / `input-driven-agent` / `preflight-files` / `artifact-output` / `guarded-command` / `review-workflow` |
| input type | `string` / `number` / `boolean` / `select` |
| step type | `command` / `agent` / `manual` / `result` |
| stepCompletion | `auto` / `manual` |
| stepMessage | `full` / `current` / `silent` / `step` |
| preflight failurePolicy | `stop` / `continue` / `warn` |
| result source | `state` / `literal` / `agent` |
| result sink type | `file` / `command` |
| completion visualization enabled | boolean |

### 8.3 候補選択 + 自由記入

| 項目 | 方針 |
| --- | --- |
| `action.provider` | `vscode.executeCommand` を既定候補にし、別拡張 provider は自由記入または API から候補取得。 |
| command ID | 既知の連携拡張 command を候補表示し、自由記入も許可。 |
| `includeState` | 前段 `resultKey` を候補表示。自由記入は詳細モードで許可。 |
| `result.stateKey` | 前段 `resultKey` を候補表示。 |
| `artifacts.producedBy` | step id を候補表示。 |
| file path | `.bob/artifacts/<name>-report.md` などを候補生成し、自由編集も許可。 |

### 8.4 自由記入

| 項目 | 補助 |
| --- | --- |
| `description` | 目的・入力・処理・出力を含めるガイドを表示。 |
| step `prompt` | AI に改善依頼できる。プレースホルダ候補を表示。 |
| manual step `prompt` | チェックリスト風の入力補助。 |
| guardrails approval message | 既定文を生成して編集可能。 |
| Markdown body | 初期版では自動生成 + 詳細編集。 |

## 9. ユーザー目線の UI 方針

### 9.1 迷わせない初期表示

初期表示では、次の 3 セクションだけを必須導線にする。

1. 基本情報
2. step 設計
3. 保存前検証

`inputs`、`preflight`、`guardrails`、`artifacts`、`completion` は「必要になったら追加」する折りたたみセクションにする。

### 9.2 step type 選択の説明

step type は技術名だけでなく、選ぶ基準を並べる。

```text
AI step: AI に分析・要約・生成をさせる
Command step: VS Code command / 別拡張で情報を集める
Manual step: 人間の確認を待つ
Result step: 結果をファイルや command に渡す
```

### 9.3 エラーは YAML 用語だけで出さない

悪い例:

```text
includeState references unknown resultKey
```

良い例:

```text
analyze step が reviewContext を参照していますが、前段 step に reviewContext を出力する resultKey がありません。
collect-context step に resultKey を追加するか、analyze.includeState から reviewContext を外してください。
```

内部診断メッセージは保持しつつ、GUI では説明文と修正候補を付ける。

### 9.4 保存前に必ず preview / diff

保存前に次を表示する。

- 保存先パス
- 生成される `WORKFLOW.md` preview
- validation 結果
- 既存ファイルがある場合は diff
- backup 作成有無

### 9.5 初心者モードと詳細モード

- 初心者モード: 主要項目だけ表示し、固定値・推奨値を使う。
- 詳細モード: schema 上の任意項目、unknown front matter、raw YAML editor を表示する。

初期実装では詳細モードを read-only preview にしてもよい。

## 10. AI ブラッシュアップ連携

### 10.1 AI 連携の位置づけ

AI は次の 4 箇所で使う。

1. 目的文から step 案を作る。
2. 選択中 step の prompt を改善する。
3. 診断結果を分かりやすく説明する。
4. 完成前レビューとして、抜け・過剰・危険な command を指摘する。

### 10.2 AI に渡す情報

新規設計時:

```json
{
  "kind": "designWorkflow",
  "payload": {
    "goal": "ユーザーが入力した目的",
    "preferredTemplate": "review-workflow",
    "workspaceHints": ["利用可能な連携拡張", "既存 .bob 構成", "想定成果物"]
  }
}
```

改善時:

```json
{
  "kind": "improveWorkflow",
  "payload": {
    "workflowText": "生成中の WORKFLOW.md",
    "repairContext": "validateWorkflowText の診断結果",
    "authoringModel": "GUI の中間モデル",
    "focus": "steps / prompt / guardrails / artifacts など"
  }
}
```

### 10.3 AI 出力の扱い

AI 出力は直接保存しない。

- `WorkflowDesignDraft` または `WorkflowAuthoringPatch` として受け取る。
- GUI 上に提案として表示する。
- 差分単位で `Apply` / `Reject` できるようにする。
- 適用後に必ず `validateWorkflowText` を通す。

### 10.4 AI に不向きな判断

次は AI に最終判断させない。

- command が本当に安全かどうかの最終承認。
- 破壊的操作を許可するかどうか。
- 社内規約・案件固有ルールの正当性判断。
- 生成成果物の正式承認。
- 秘密情報を外部 AI provider に送ってよいかの判断。

### 10.5 AI ブラッシュアップの UI

- `AIでstep案を作る`
- `選択中stepのpromptを改善`
- `診断結果を説明`
- `保存前レビュー`

AI 提案は右ペインに表示する。

```text
提案: analyze step の prompt に出力形式がありません。
変更案: 「結果は findings / rationale / nextActions に分けて出力してください」を追加します。
[適用] [編集して適用] [却下]
```

## 11. 内部モデル案

### 11.1 WorkflowAuthoringModel

```ts
export interface WorkflowAuthoringModel {
  metadata: WorkflowAuthoringMetadata
  inputs: WorkflowAuthoringInput[]
  requires?: WorkflowAuthoringRequires
  preflight: WorkflowAuthoringPreflight[]
  guardrails?: WorkflowAuthoringGuardrails
  steps: WorkflowAuthoringStep[]
  artifacts: WorkflowAuthoringArtifact[]
  completion?: WorkflowAuthoringCompletion
  body?: string
  unknownFrontMatter?: Record<string, unknown>
}
```

### 11.2 metadata

```ts
export interface WorkflowAuthoringMetadata {
  schemaVersion: "workflow-register/v1"
  name: string
  title?: string
  description: string
  mode: string
  workspaceRequired: boolean
  hidden?: boolean
}
```

### 11.3 step

```ts
export type WorkflowAuthoringStep =
  | WorkflowAuthoringAgentStep
  | WorkflowAuthoringCommandStep
  | WorkflowAuthoringManualStep
  | WorkflowAuthoringResultStep

export interface WorkflowAuthoringStepBase {
  id: string
  title: string
  type: "agent" | "command" | "manual" | "result"
  required?: boolean
  resultKey?: string
  includeState?: string[]
  maxResultBytes?: number
  stateRequired?: boolean
}
```

### 11.4 変換レイヤ

実装では次の変換を分離する。

```text
Webview form state
  -> WorkflowAuthoringModel
  -> WorkflowDesignDraft または WorkflowDefinition
  -> WORKFLOW.md
  -> validateWorkflowText
```

既存 `WorkflowDesignDraft` は AI provider との境界として残す。GUI 全項目を表現するには不足があるため、GUI 内部ではより詳細な `WorkflowAuthoringModel` を持つ。

## 12. コマンド追加案

`package.json` に次の command を追加する。

| command | title | 用途 |
| --- | --- | --- |
| `workflowRegister.openWorkflowBuilder` | `Bob ワークフロー: GUI で作成` | 新規作成 GUI を開く。 |
| `workflowRegister.editWorkflowInBuilder` | `Bob ワークフロー: GUI で編集` | 現在の `WORKFLOW.md` を GUI で編集する。後続フェーズ。 |
| `workflowRegister.reviewWorkflowDraftWithAi` | `Bob ワークフロー: 下書きを AI でレビュー` | GUI 上の下書きに対する AI レビュー。後続フェーズ。 |

初期 MVP では `openWorkflowBuilder` のみ追加する。

## 13. ファイル構成案

```text
extensions/workflow-register/src/
  commands/
    openWorkflowBuilder.ts
    editWorkflowInBuilder.ts                 # 後続
  core/
    workflowAuthoringModel.ts
    workflowAuthoringDefaults.ts
    workflowAuthoringValidation.ts
    workflowAuthoringSerializer.ts
    workflowAuthoringAi.ts
  webview/
    workflowBuilderPanel.ts
    workflowBuilderMessages.ts
    workflowBuilderHtml.ts
    media/
      workflowBuilder.css
      workflowBuilder.js
  test/
    workflowAuthoringSerializer.test.ts
    workflowAuthoringValidation.test.ts
    workflowBuilderMessages.test.ts
```

Webview のフロントエンドは、初期版では依存を増やさず plain TypeScript / HTML / CSS で実装する。状態管理が複雑になった段階で軽量 UI ライブラリ導入を検討する。

## 14. 実装フェーズ

### Phase 0: 仕様固定と既存資産の整理

- `workflow-register/v1` の GUI 対象フィールドを確定する。
- 既存 `workflowScaffold`、`workflowDesignDraft`、`workflowDesignBuilder`、`workflowValidator` の責務を確認する。
- GUI で扱わない任意フィールドの扱いを決める。
- command / agent / result / manual のサンプル workflow をテストデータ化する。

成果物:

- 本計画書
- GUI 対象フィールド表
- MVP 対象外フィールド一覧

### Phase 1: 新規作成 MVP

対象:

- `openWorkflowBuilder`
- Webview panel
- 基本情報入力
- template 選択
- step 追加・削除・並べ替え
- agent / manual / command / result の主要項目編集
- YAML preview
- `validateWorkflowText` 実行
- `.bob/workflows/<name>/WORKFLOW.md` 保存

この段階では AI 連携なしでもよい。

完了条件:

- GUI だけで `simple-agent` 相当を作成できる。
- GUI だけで `command-then-agent` 相当を作成できる。
- GUI だけで `artifact-output` 相当を作成できる。
- 保存前 validation error がある場合は保存を止める。

### Phase 2: 参照関係と診断 UX 強化

対象:

- `resultKey` 候補から `includeState` を選べる。
- step 削除時の参照影響を表示する。
- step 並べ替え時の参照順 warning を表示する。
- `artifacts.producedBy` を step id 候補から選べる。
- diagnostics クリックで該当フォーム項目へ移動する。

完了条件:

- `includeState references unknown resultKey` を GUI 上で再現・修正できる。
- `Artifact ... unknown producedBy step` を GUI 上で再現・修正できる。
- select input の options 未設定を GUI 上で修正できる。

### Phase 3: AI 下書き・改善連携

対象:

- GUI から `designWorkflow` を呼び、返却された `WorkflowDesignDraft` を読み込む。
- 選択中 step の prompt 改善を AI に依頼する。
- 保存前レビューを AI に依頼する。
- AI 提案を差分単位で apply / reject できる。

完了条件:

- goal から step 案を生成し、人間が GUI で修正して保存できる。
- AI が出した不正な draft は保存されず、診断が表示される。
- AI 提案適用後に validation が必ず走る。

### Phase 4: 既存 workflow 編集

対象:

- 開いている `WORKFLOW.md` を GUI に読み込む。
- unknown front matter を保持する。
- 編集後に diff preview を表示する。
- backup 作成後に保存する。

完了条件:

- 既存テンプレート由来の workflow を読み込み、編集、保存できる。
- GUI 未対応フィールドを不用意に消さない。
- 失敗時に元ファイルを保持できる。

### Phase 5: 連携拡張の provider 候補表示

対象:

- `registerActionProvider` 済み provider の一覧を取得する API を検討する。
- `bob-bazaar-review` などの command 候補を表示する。
- provider ごとの args schema を将来拡張できるようにする。

完了条件:

- `vscode.executeCommand` 以外の provider を GUI で選びやすくなる。
- 連携拡張が自分の command / args 入力支援を提供できる。

## 15. テスト計画

### 15.1 単体テスト

- `WorkflowAuthoringModel` から `WORKFLOW.md` への変換。
- `WORKFLOW.md` から `WorkflowAuthoringModel` への読み戻し。Phase 4。
- step id 重複検出。
- input id 重複検出。
- select input options 未設定検出。
- command step action 未設定検出。
- result step result 未設定検出。
- `includeState` の参照順検証。
- `artifacts.producedBy` の参照検証。

### 15.2 Webview message テスト

- add step
- delete step
- duplicate step
- reorder step
- update field
- validate draft
- save draft
- apply AI suggestion
- reject AI suggestion

### 15.3 スモークテスト

- 新規 `simple-agent` を作成して validation OK。
- 新規 `command-then-agent` を作成して validation OK。
- 新規 `artifact-output` を作成して validation OK。
- 不正な `includeState` を作って diagnostics 表示。
- 不正な select input を作って diagnostics 表示。

## 16. リスクと対策

| リスク | 影響 | 対策 |
| --- | --- | --- |
| GUI と schema の二重管理 | schema 更新時にズレる | schema 由来の選択肢・必須情報をできるだけ共通化する。 |
| Webview 実装が大きくなる | 保守難度が上がる | MVP は plain TS で小さく作り、状態モデルを core に逃がす。 |
| AI 出力が不正 | 壊れた workflow が保存される | AI 出力は必ず builder / validator を通す。直接保存しない。 |
| 既存 workflow の未知フィールドを消す | 互換性低下 | Phase 4 では unknownFrontMatter を保持する。初期は新規作成限定。 |
| command の安全性誤認 | 破壊的操作の混入 | guardrails 入力を command step 追加時に促す。deniedCommands を推奨。 |
| 大きな結果を Bob に渡す | 実行失敗・遅延 | `maxResultBytes` と artifacts 出力を UI で促す。 |

## 17. MVP の推奨仕様

最初に実装する範囲は次に絞る。

- 新規作成のみ。
- template 選択あり。
- 基本情報: `name`、`title`、`description`、`workspaceRequired`。
- inputs: `string`、`boolean`、`select`。`number` は同時対応してもよい。
- steps: 4 type すべて追加可能。
- command step: `vscode.executeCommand` を主対象にし、command ID と args を編集可能。
- agent/manual prompt editor。
- result step: file sink のみを最初に優先。command sink は後続でもよい。
- artifacts: id / path / producedBy。
- guardrails: allowedCommands / deniedCommands。
- YAML preview と validation。
- 保存前 preview。

MVP でやらないこと:

- 既存 workflow の GUI 編集。
- provider 別 args schema。
- 複雑な `requiredWhen` UI。
- raw YAML 双方向編集。
- AI 提案の部分適用 UI。

## 18. 実装順序の詳細

1. `WorkflowAuthoringModel` と serializer を追加する。
2. 既存テンプレートから `WorkflowAuthoringModel` を作る defaults を追加する。
3. `WorkflowAuthoringModel` から `WORKFLOW.md` を生成し、既存 validator で検証する単体テストを作る。
4. `openWorkflowBuilder` command を `package.json` と `extensionWithAuthoring.ts` に登録する。
5. Webview panel を開き、初期 model を表示する。
6. Webview message handler で model 更新、validate、preview、save を実装する。
7. step add/delete/reorder を実装する。
8. 参照候補の計算を core 関数として実装する。
9. エラー表示と該当項目への移動を実装する。
10. AI 連携を追加する。
11. 既存 workflow 編集を追加する。

## 19. 画面文言案

### 19.1 基本情報

```text
ワークフロー名
保存先フォルダにも使われる安定 ID です。英数字、`.`、`_`、`-` を使用できます。
```

```text
説明
Bob の一覧や診断レポートに表示されます。入力、処理、出力が分かる 1〜2 文にしてください。
```

### 19.2 step 追加

```text
どの種類の step を追加しますか？
AI step: AI に分析・要約・生成をさせる
Command step: VS Code command や別拡張で情報を集める
Manual step: 人間の確認を待つ
Result step: 結果をファイルや command に渡す
```

### 19.3 保存前

```text
保存前の検証で 2 件のエラーがあります。エラーを修正するまで保存できません。
```

```text
既存の WORKFLOW.md が存在します。上書き前に backup を作成します。
```

## 20. まとめ

GUI 作成機能は、既存のテンプレート作成機能を単にフォーム化するだけでなく、step 間の参照、必須項目、成果物、guardrails、AI 改善を一つの設計体験にまとめる位置づけにする。

実装上は、まず新規作成 MVP に限定し、`WorkflowAuthoringModel` と serializer / validator 連携を固める。その後、参照診断、AI 提案、既存 workflow 編集、連携拡張 provider 候補表示へ進めるのが安全である。
