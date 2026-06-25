はい。おすすめは **「Skill + Workflow + MCP + JSON結果」** の組み合わせです。
どれか1つに全部詰めるより、役割分担した方が保守しやすいです。

## 結論

| 機能                 | 置くべきもの                          | 理由                          |
| ------------------ | ------------------------------- | --------------------------- |
| **Skill**          | プロジェクト独自規約・レビュー観点・チェックリストの意味づけ  | 人間が読む規約をLLMに理解させる場所         |
| **Workflow**       | レビューの実行手順、入力、出力形式、合否判定フロー       | 毎回同じ流れでレビューさせる場所            |
| **MCP**            | Bazaar差分取得、規約ファイル取得、静的チェック、台帳参照 | 機械的・外部的に取得すべき情報を渡す場所        |
| **Command**        | 「このrevisionを規約付きレビューして」の入口      | VSCode/Bob IDE上の操作導線        |
| **Mode**           | 必要なら「厳格レビュー専用モード」               | レビュー時の権限・口調・禁止事項を固定する場所     |
| **JSON Schema**    | レビュー結果の正規化                      | 後工程で集計・再レビュー・Excel化しやすくする場所 |
| **Markdown `[x]`** | 人間向けサマリ表示                       | 読みやすいが、正本にはしない              |

なので、最適構成はこうです。

```text
Command
  -> Review Workflow
      -> MCPで差分・規約・関連資料を取得
      -> Skillで規約の読み方を注入
      -> Modeでレビュー姿勢・権限を固定
      -> JSONで結果を出力
      -> Markdownチェックリストを人間向けに生成
```

## どこに展開するべきか

### 1. 規約・チェックリスト本体は Skill に置く

プロジェクト独自のレビュー規約は **Skill** が一番向いています。

例えばこういうものです。

```text
.bob/skills/project-review-checklist/
  SKILL.md
  checklist.json
  examples/
    good-review-output.json
    bad-review-output.json
```

`SKILL.md` には、人間向けにこう書きます。

```md
# Project Review Checklist Skill

このSkillは、IBM-Bob系C/C++保守プロジェクトのコードレビューで使用する。

必ず以下を確認する。

1. 共有メモリIFへの影響
2. 外部I/F構造体の互換性
3. グローバル変数更新の排他・順序
4. RTスレッド内での禁止処理
5. 動的メモリ確保の有無
6. ファイルI/O、ログ出力、待ち処理の混入
7. エラー処理、タイムアウト、リトライ
8. 既存基本設計・詳細設計・単体テスト仕様との不整合
9. 境界値、NULL、配列範囲外
10. テスト追加要否

判断できない項目は pass にしてはいけない。
証跡不足の場合は unknown とする。
```

Skillに置くメリットは、規約の改定に強いことです。
レビューのたびにプロンプトへ長文コピペしなくて済みます。

### 2. 実行手順は Workflow に置く

「どの順番でレビューするか」は **Workflow** に置くのがよいです。

例:

```text
project-rule-review workflow

1. review target を受け取る
2. VCS差分を取得する
3. プロジェクト規約Skillを読み込む
4. checklist.jsonを読み込む
5. 変更ファイルごとに影響範囲を確認する
6. JSON schemaに従って結果を出す
7. Markdownサマリを作る
8. Findingsに変換する
```

Workflowは「作業の型」です。
Skillは「規約の中身」です。
この2つを分けるのが大事です。

### 3. Bazaar差分や規約ファイル取得は MCP に置く

Bazaarの revision 指定レビューは、すでに追加した `bob-bazaar-review` のMCP方式と相性が良いです。今回の拡張では、`bazaar_diff_revision`、`bazaar_diff_range`、`bazaar_cat_revision` などのread-only toolを出す構成にしています。

さらに、プロジェクト規約用MCPを足すならこうです。

```text
project_rules_get_checklist
project_rules_get_coding_standard
project_rules_get_design_docs
project_rules_get_test_policy
project_rules_validate_result_schema
```

MCPに置くべきなのは、LLMの記憶や自然文解釈に任せたくないものです。

たとえば:

```text
- Bazaar diff取得
- 特定revisionのファイル内容取得
- レビュー規約JSONの取得
- Excel/Markdown/JSON台帳の取得
- 禁止API一覧の取得
- 既存設計書との対応表取得
- JSON schema validation
```

MCPは **証跡取得・機械処理** の場所、と考えると分かりやすいです。

### 4. Command は入口だけにする

Commandにはロジックを詰めすぎない方がいいです。

良いCommand例:

```text
Bob Bazaar: Review Revision with Project Rules
Bob Bazaar: Review Revision Range with Project Rules
Bob Review: Run Project Checklist
```

Commandの責務はここまでです。

```text
1. revisionを入力させる
2. 対象workspaceを決める
3. review request packetを作る
4. Workflowに渡す
```

レビュー判断そのものはCommandに入れない方がいいです。

### 5. Mode は「厳格レビュー専用」が必要なら使う

Modeは、プロジェクトごとに乱立させるより、まずは1つだけ作るのがよいです。

```yaml
slug: project-rule-reviewer
name: Project Rule Reviewer
description: プロジェクト規約準拠レビュー専用モード
```

Modeに入れるべきもの:

```text
- 勝手に修正しない
- 不明点は unknown にする
- JSON schemaに必ず従う
- evidenceなしで pass にしない
- source変更系toolを使わない
- review / read / mcp のみ許可
```

つまりModeは、**レビュー時の人格・権限・禁止事項の固定** に使います。

規約本文をModeに大量に入れるのはおすすめしません。
規約はSkillに置く方がいいです。

## `[x]`チェックリスト vs JSON正規化

これは **JSONを正本、Markdownを表示用** にするのがベストです。

### NG寄り: Markdown `[x]` だけ

```md
- [x] NULLチェックされている
- [x] 排他制御に問題なし
- [ ] テストが追加されていない
```

これは見やすいですが、弱点があります。

```text
- 集計しにくい
- 判断根拠が曖昧になりやすい
- 「本当にチェックしたか」が追跡しにくい
- 後からExcel化・Redmine登録・品質メトリクス化しにくい
- LLMが雰囲気で[x]を付けがち
```

なので、`[x]` は最終表示だけにするべきです。

### 推奨: JSONを正本にする

例えばこうです。

```json
{
  "review_id": "BRR-20260626-001",
  "vcs": {
    "type": "bazaar",
    "repository": "legacy-control",
    "revision_mode": "single",
    "revision": "1234"
  },
  "checklist_results": [
    {
      "rule_id": "RT-001",
      "title": "RTスレッド内でI/Oを行っていない",
      "status": "fail",
      "severity": "error",
      "confidence": "high",
      "evidence": [
        {
          "file": "src/rt_control.c",
          "start_line": 245,
          "end_line": 251,
          "summary": "RT_CONTROL内でログ出力関数が追加されている"
        }
      ],
      "reason": "RTスレッドではI/O禁止の規約に違反する可能性が高い",
      "suggested_action": "TS_SERVICE側へログ出力を移動する"
    },
    {
      "rule_id": "IF-003",
      "title": "外部I/F構造体の互換性を維持している",
      "status": "unknown",
      "severity": "warning",
      "confidence": "medium",
      "evidence": [],
      "reason": "diff内に構造体利用箇所はあるが、対応するIF台帳が入力に含まれていない",
      "suggested_action": "IF構造体台帳を追加して再レビューする"
    }
  ],
  "findings": [
    {
      "id": "F-001",
      "rule_id": "RT-001",
      "severity": "error",
      "file": "src/rt_control.c",
      "start_line": 245,
      "end_line": 251,
      "title": "RTスレッド内にログ出力が追加されている",
      "description": "RT_CONTROL内でI/O相当の処理が追加されており、周期処理遅延の原因になる可能性がある。",
      "suggested_fix": "ログ出力要求を共有キューに積み、TS_SERVICEで出力する。"
    }
  ],
  "summary": {
    "pass": 18,
    "fail": 1,
    "unknown": 3,
    "not_applicable": 4
  }
}
```

この形にしておくと、後でこういうことができます。

```text
- Markdownチェック表を自動生成
- Bob Findingsに変換
- Excel集計
- Redmineチケット化
- レビュー未完了項目だけ再レビュー
- rule_id別に品質傾向を集計
```

## ステータス設計

`[x]` / `[ ]` の2値では足りません。
最低でもこの5値が必要です。

| status           | 意味                      |
| ---------------- | ----------------------- |
| `pass`           | 証跡ありで問題なし               |
| `fail`           | 規約違反または高リスク             |
| `unknown`        | 入力不足で判断不能               |
| `not_applicable` | 今回の変更には該当しない            |
| `blocked`        | 必要な差分・ファイル・規約を取得できず評価不能 |

Markdown表示にするときはこう変換します。

```text
[x] pass
[ ] fail
[?] unknown
[-] not_applicable
[!] blocked
```

表示例:

```md
## プロジェクト規約チェック結果

- [x] RT-001: RTスレッド内でI/Oを行っていない
- [ ] IF-003: 外部I/F構造体の互換性を維持している
  - severity: error
  - evidence: `src/if_table.c:120-135`
  - reason: 構造体末尾以外にメンバ追加がある
- [?] UT-004: 単体テスト仕様が更新されている
  - reason: テスト仕様ファイルが入力に含まれていない
- [-] UI-001: 画面文言変更時に翻訳台帳を更新している
```

## checklist.json の設計

規約を自然文だけで持つのではなく、`checklist.json` にしておくと強いです。

```json
{
  "version": "1.0.0",
  "project": "legacy-control",
  "rules": [
    {
      "id": "RT-001",
      "category": "realtime",
      "title": "RTスレッド内でI/Oを行っていない",
      "description": "RT_INPUT, RT_CONTROL, RT_OUTPUTではファイルI/O、標準出力、ログ出力、待ち処理を行わない。",
      "severity_on_fail": "error",
      "applies_when": [
        "changed_file_matches:src/rt_*.c",
        "diff_contains:RT_CONTROL",
        "diff_contains:RT_INPUT",
        "diff_contains:RT_OUTPUT"
      ],
      "evidence_required": true,
      "review_hint": "I/O関数、ログ関数、sleep/wait、mutex待ち、動的確保を重点確認する。"
    },
    {
      "id": "IF-001",
      "category": "external-interface",
      "title": "外部I/F構造体のサイズ・並び順を壊していない",
      "description": "PLC/モーション/センサIFに関わる構造体は互換性を維持する。",
      "severity_on_fail": "error",
      "applies_when": [
        "changed_file_matches:src/if/**",
        "diff_contains:struct"
      ],
      "evidence_required": true,
      "review_hint": "構造体メンバの追加、削除、型変更、順序変更、padding影響を確認する。"
    }
  ]
}
```

これをSkillが読む、またはMCPで取得する形にします。

## Bobへの依頼文はどう作るべきか

自然文だけで依頼するより、レビュー要求packetを作るのがよいです。

```json
{
  "task_type": "project_rule_code_review",
  "vcs": {
    "type": "bazaar",
    "revision": "1234"
  },
  "inputs": {
    "diff_tool": "bazaar_diff_revision",
    "checklist": ".bob/review/checklist.json",
    "skill": "project-review-checklist"
  },
  "output_contract": {
    "primary": "review_result_json",
    "secondary": "markdown_summary",
    "status_values": ["pass", "fail", "unknown", "not_applicable", "blocked"]
  },
  "rules": [
    "Do not mark a rule as pass without evidence.",
    "Use unknown when required files or documents are missing.",
    "Every fail must produce at least one finding.",
    "Every finding must reference a rule_id."
  ]
}
```

Bobにはこのpacketを渡して、

```text
この review request に従って、Bazaar revision 1234 をレビューしてください。
結果は review_result_json を正本として出し、その後に人間向けMarkdownサマリを出してください。
```

と依頼します。

## おすすめの実装構成

Bob本体を変更しない前提なら、次の構成が良いです。

```text
.bob/
  mcp.json
  review/
    checklist.json
    review-result.schema.json
  skills/
    project-review-checklist/
      SKILL.md
      examples/
        result-example.json
```

別拡張側:

```text
extensions/bob-bazaar-review/
  src/
    extension.ts
    bazaar.ts
    mcpConfig.ts
    reviewPacket.ts
    mcp/
      server.ts
    projectRules/
      checklistLoader.ts
      schemaValidator.ts
      markdownRenderer.ts
```

コマンド:

```text
Bob Bazaar: Configure Bazaar MCP for Bob
Bob Bazaar: Review Revision with Project Rules
Bob Bazaar: Review Range with Project Rules
Bob Bazaar: Validate Review Result JSON
```

MCP tools:

```text
bazaar_diff_revision
bazaar_diff_range
bazaar_cat_revision
project_rules_get_checklist
project_rules_get_schema
project_rules_render_markdown
project_rules_validate_review_result
```

## 最終的なおすすめ

一番バランスがよいのはこれです。

```text
Skill:
  規約の意味、レビュー観点、判断方針

Workflow:
  差分取得 → 規約読込 → レビュー → JSON検証 → Markdown生成

MCP:
  Bazaar操作、規約取得、schema validation、Markdown rendering

Command:
  revision/range指定の入口

Mode:
  厳格レビュー時だけ使用。read/mcp/review中心、edit/executeは制限

Output:
  正本はJSON
  人間向けはMarkdown [x]チェックリスト
```

つまり、**自然文リストに `[x]` を直接書かせるだけでは弱い** です。
`rule_id` 付きJSONを正本にし、そこから `[x]` 付きMarkdownを生成する構成にすると、Bobレビュー、品質集計、Redmine/Excel連携、再レビューに全部つながります。
